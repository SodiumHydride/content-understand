import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'

let mainWindow: BrowserWindow | null = null
let sidecarProcess: ChildProcess | null = null

const SIDECAR_PORT = 17890
const SIDECAR_BASE = `http://127.0.0.1:${SIDECAR_PORT}`

function resolveSidecarCommand(): { cmd: string; args: string[]; cwd: string } | null {
  // dev: out/main → repo root; prod: out/main → repo root (same depth)
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
  sidecarProcess = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env },
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
    sidecarProcess.kill()
    sidecarProcess = null
  }
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

  startSidecar()

  ipcMain.handle('app:getSidecarBase', () => SIDECAR_BASE)

  ipcMain.handle('dialog:pickVault', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('shell:openPath', async (_, filePath: string) => {
    return shell.openPath(filePath)
  })

  ipcMain.handle('shell:showItemInFolder', async (_, filePath: string) => {
    shell.showItemInFolder(filePath)
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
