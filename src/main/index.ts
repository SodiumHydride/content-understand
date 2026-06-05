import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, type ChildProcess } from 'child_process'
import { copyFileSync, cpSync, existsSync, rmSync, statSync } from 'fs'
import { getAppDataPaths, sidecarEnv, type AppDataPaths } from './appPaths'

let mainWindow: BrowserWindow | null = null
let sidecarProcess: ChildProcess | null = null
let appPaths: AppDataPaths | null = null

// Must match SIDECAR_PORT in content_understand/defaults.py
const SIDECAR_PORT = 17890
const SIDECAR_BASE = `http://127.0.0.1:${SIDECAR_PORT}`

function resolveSidecarCommand(): { cmd: string; args: string[]; cwd: string } | null {
  const root = join(__dirname, '../..')
  const serverPy = join(root, 'sidecar', 'server.py')
  if (!existsSync(serverPy)) return null
  return {
    cmd: process.platform === 'win32' ? 'python' : 'python3',
    args: [serverPy, '--port', String(SIDECAR_PORT)],
    cwd: root
  }
}

function startSidecar(): void {
  const spec = resolveSidecarCommand()
  if (!spec) {
    console.warn('[main] sidecar/server.py not found — UI runs in demo mode')
    return
  }
  const paths = getAppDataPaths()
  appPaths = paths
  sidecarProcess = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: sidecarEnv(paths),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  sidecarProcess.stdout?.on('data', (d) => console.log('[sidecar]', d.toString()))
  sidecarProcess.stderr?.on('data', (d) => console.error('[sidecar]', d.toString()))
  sidecarProcess.on('exit', (code) => {
    console.log('[sidecar] exited', code)
    sidecarProcess = null
  })
}

function stopSidecar(): void {
  if (sidecarProcess) {
    // Send SIGTERM first so sidecar can gracefully stop llama-server
    sidecarProcess.kill('SIGTERM')
    const proc = sidecarProcess
    sidecarProcess = null
    // Force kill after 5s if it hasn't exited
    setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* already dead */ }
    }, 5000)
  }
}

function vaultRoot(): string {
  return appPaths?.vault ?? getAppDataPaths().vault
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: '#FFFCF9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.content-understand')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  appPaths = getAppDataPaths()
  startSidecar()

  ipcMain.handle('app:getSidecarBase', () => SIDECAR_BASE)
  ipcMain.handle('app:getPaths', () => appPaths ?? getAppDataPaths())

  ipcMain.handle('shell:openPath', async (_, filePath: string) => shell.openPath(filePath))

  ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('vault:openRoot', async () => shell.openPath(vaultRoot()))

  // Open the data folder in Finder/Explorer
  ipcMain.handle('app:openDataFolder', async () => {
    const paths = appPaths ?? getAppDataPaths()
    shell.openPath(paths.appData)
  })

  // Get total size of data folder in bytes
  ipcMain.handle('app:getDataSize', async () => {
    const paths = appPaths ?? getAppDataPaths()
    let total = 0
    const walk = (dir: string) => {
      try {
        for (const entry of require('fs').readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else total += statSync(full).size
        }
      } catch { /* ignore */ }
    }
    walk(paths.appData)
    return total
  })

  // Delete all data and quit
  ipcMain.handle('app:deleteAllData', async () => {
    const paths = appPaths ?? getAppDataPaths()
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Delete All & Quit', 'Cancel'],
      defaultId: 1,
      title: 'Delete All Data',
      message: 'This will permanently delete all notes, models, and settings.',
      detail: `Folder: ${paths.appData}\n\nThis cannot be undone.`
    })
    if (result.response !== 0) return { ok: false, canceled: true }
    stopSidecar()
    rmSync(paths.appData, { recursive: true, force: true })
    app.quit()
    return { ok: true }
  })

  ipcMain.handle('vault:exportNote', async (_, relPath: string) => {
    const src = join(vaultRoot(), relPath)
    if (!existsSync(src)) return { ok: false, error: 'not_found' }
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: relPath.split('/').pop() ?? 'note.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    copyFileSync(src, result.filePath)
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle('vault:exportAll', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Export wiki folder'
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
    const dest = join(result.filePaths[0], 'ContentUnderstand-wiki')
    cpSync(vaultRoot(), dest, { recursive: true })
    return { ok: true, path: dest }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopSidecar()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopSidecar())
