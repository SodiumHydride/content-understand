import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import { createServer } from 'net'
import { getAppDataPaths, sidecarEnv, type AppDataPaths } from './appPaths'

let mainWindow: BrowserWindow | null = null
let sidecarProcess: ChildProcess | null = null
let appPaths: AppDataPaths | null = null
let isQuitting = false

// Must match SIDECAR_PORT in content_understand/defaults.py
const SIDECAR_PORT = 17890
const SIDECAR_BASE = `http://127.0.0.1:${SIDECAR_PORT}`

// ---------------------------------------------------------------------------
// Single Instance Lock
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Focus the existing window when a second instance is launched
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// ---------------------------------------------------------------------------
// Port & Process Helpers
// ---------------------------------------------------------------------------

/** Check whether a local port is currently in use. */
function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close(() => resolve(false))
    })
    server.listen(port, '127.0.0.1')
  })
}

/** Try to gracefully stop any process bound to SIDECAR_PORT. */
async function killOccupyingProcess(): Promise<void> {
  console.log('[main] port %d is occupied — attempting cleanup', SIDECAR_PORT)

  // Try a polite DELETE /shutdown first (sidecar may support it)
  try {
    await fetch(`${SIDECAR_BASE}/shutdown`, { method: 'DELETE', signal: AbortSignal.timeout(3000) })
  } catch { /* expected if no such endpoint */ }

  // Give it a moment
  await sleep(3000)

  if (!(await isPortOccupied(SIDECAR_PORT))) {
    console.log('[main] port freed after graceful shutdown')
    return
  }

  // Force kill via lsof
  console.log('[main] port still occupied — force killing')
  try {
    const pids = execFileSync('lsof', ['-ti', `:${SIDECAR_PORT}`], { encoding: 'utf-8' }).trim()
    for (const pid of pids.split('\n').filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGKILL')
        console.log('[main] killed stale PID %s', pid)
      } catch { /* already gone */ }
    }
  } catch { /* lsof found nothing or lsof not available */ }

  await sleep(500)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Sidecar Lifecycle
// ---------------------------------------------------------------------------

function resolveSidecarCommand(): { cmd: string; args: string[]; cwd: string } | null {
  // 1. Packaged mode: use bundled PyInstaller binary
  if (!is.dev) {
    const resourcesPath = process.resourcesPath
    const sidecarBin = process.platform === 'win32'
      ? join(resourcesPath, 'sidecar', 'sidecar.exe')
      : join(resourcesPath, 'sidecar', 'sidecar')
    if (existsSync(sidecarBin)) {
      return {
        cmd: sidecarBin,
        args: ['--port', String(SIDECAR_PORT)],
        cwd: join(resourcesPath, 'sidecar')
      }
    }
    console.warn('[main] packaged mode but sidecar binary not found at', sidecarBin)
  }

  // 2. Dev mode: use Python interpreter
  const root = join(__dirname, '../..')
  const serverPy = join(root, 'sidecar', 'server.py')
  if (!existsSync(serverPy)) return null
  return {
    cmd: process.platform === 'win32' ? 'python' : 'python3',
    args: [serverPy, '--port', String(SIDECAR_PORT)],
    cwd: root
  }
}

/** Spawn a sidecar process and wire up logging. */
function spawnSidecar(spec: { cmd: string; args: string[]; cwd: string }, paths: AppDataPaths): ChildProcess {
  const proc = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: sidecarEnv(paths),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  proc.stdout?.on('data', (d) => console.log('[sidecar]', d.toString()))
  proc.stderr?.on('data', (d) => console.error('[sidecar]', d.toString()))
  proc.on('exit', (code) => {
    console.log('[sidecar] exited', code)
    if (sidecarProcess === proc) sidecarProcess = null
  })
  return proc
}

async function startSidecar(): Promise<void> {
  const spec = resolveSidecarCommand()
  if (!spec) {
    console.warn('[main] sidecar/server.py not found — UI runs in demo mode')
    return
  }

  // 1. Startup cleanup — make sure the port is free
  if (await isPortOccupied(SIDECAR_PORT)) {
    await killOccupyingProcess()
    if (await isPortOccupied(SIDECAR_PORT)) {
      console.error('[main] could not free port %d — starting sidecar will likely fail', SIDECAR_PORT)
    }
  }

  // 2. Spawn
  const paths = getAppDataPaths()
  appPaths = paths
  sidecarProcess = spawnSidecar(spec, paths)

  // 3. Health check — wait up to 15 s, retry once on failure
  let healthy = await waitForHealth(15_000)
  if (!healthy) {
    console.error('[main] sidecar did not become healthy — retrying once')
    stopSidecar()
    await sleep(500)
    sidecarProcess = spawnSidecar(spec, paths)
    healthy = await waitForHealth(15_000)
    if (!healthy) {
      console.error('[main] sidecar still unhealthy after retry — running in degraded mode')
    }
  }
}

/** Poll GET /health until it responds 200 or timeout is reached. */
async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SIDECAR_BASE}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        console.log('[main] sidecar is healthy')
        return true
      }
    } catch {
      // Not up yet
    }
    await sleep(1000)
  }
  return false
}

function stopSidecar(): void {
  if (sidecarProcess) {
    // Send SIGTERM first so sidecar can gracefully stop app Ollama
    sidecarProcess.kill('SIGTERM')
    const proc = sidecarProcess
    sidecarProcess = null
    // Force kill after 5s if it hasn't exited — but only if process is still alive
    // (avoids PID reuse risk where the PID was recycled by the OS)
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* already dead */
        }
      }
    }, 5000)
  }
}

// ---------------------------------------------------------------------------
// Window & App
// ---------------------------------------------------------------------------

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
      sandbox: true,
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

// ---------------------------------------------------------------------------
// App Bootstrap
// ---------------------------------------------------------------------------

// Only boot the app if we hold the single-instance lock
if (gotLock) {
  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('app.content-understand')
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    appPaths = getAppDataPaths()
    await startSidecar()

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
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else total += statSync(full).size
          }
        } catch {
          /* ignore */
        }
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

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        // macOS dock click: re-create window AND restart sidecar
        await startSidecar()
        createWindow()
      }
    })
  })

  // --- Graceful Shutdown Chain ---

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') {
      // macOS: keep app alive but free sidecar resources
      stopSidecar()
    } else {
      // Windows/Linux: full quit
      stopSidecar()
      app.quit()
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopSidecar()
  })

  app.on('will-quit', () => {
    // Backup — stopSidecar is idempotent, safe to call again
    stopSidecar()
  })
}

// OS signal handlers (covers unexpected termination, e.g. `kill`, Ctrl+C)
process.on('SIGTERM', () => {
  console.log('[main] SIGTERM received')
  stopSidecar()
  app.quit()
})

process.on('SIGINT', () => {
  console.log('[main] SIGINT received')
  stopSidecar()
  app.quit()
})
