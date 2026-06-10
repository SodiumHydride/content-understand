import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { getAppDataPaths, sidecarEnv, type AppDataPaths } from './appPaths'

let mainWindow: BrowserWindow | null = null
let sidecarProcess: ChildProcess | null = null
let appPaths: AppDataPaths | null = null
let isQuitting = false
let sigkillTimer: ReturnType<typeof setTimeout> | null = null

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
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
    } catch {
      mainWindow = null
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

  // Force kill — platform-specific
  console.log('[main] port still occupied — force killing')
  try {
    if (process.platform === 'win32') {
      // Windows: use netstat to find PID, then taskkill
      const netstat = execFileSync('netstat', ['-ano'], { encoding: 'utf-8' })
      for (const line of netstat.split('\n')) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 5 && parts[0] === 'TCP' && parts[3] === 'LISTENING') {
          const local = parts[1]
          if (local.endsWith(`:${SIDECAR_PORT}`)) {
            const pid = parts[4]
            try {
              execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' })
              console.log('[main] killed stale PID %s', pid)
            } catch { /* already gone */ }
          }
        }
      }
    } else {
      const pids = execFileSync('lsof', ['-ti', `:${SIDECAR_PORT}`], { encoding: 'utf-8' }).trim()
      for (const pid of pids.split('\n').filter(Boolean)) {
        try {
          process.kill(Number(pid), 'SIGKILL')
          console.log('[main] killed stale PID %s', pid)
        } catch { /* already gone */ }
      }
    }
  } catch { /* no process found or command failed */ }

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

  let pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
  const venvPythonWin = join(root, '.venv', 'Scripts', 'python.exe')
  const venvPythonUnix = join(root, '.venv', 'bin', 'python')
  if (process.platform === 'win32' && existsSync(venvPythonWin)) {
    pythonCmd = venvPythonWin
  } else if (process.platform !== 'win32' && existsSync(venvPythonUnix)) {
    pythonCmd = venvPythonUnix
  }

  return {
    cmd: pythonCmd,
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
    await stopSidecar()
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

async function stopSidecar(): Promise<void> {
  if (!sidecarProcess) return

  // Clear any pending SIGKILL timer from a previous stopSidecar call
  if (sigkillTimer) {
    clearTimeout(sigkillTimer)
    sigkillTimer = null
  }

  const proc = sidecarProcess
  sidecarProcess = null

  if (process.platform === 'win32') {
    // Windows: process.kill('SIGTERM') is TerminateProcess (hard kill, no cleanup).
    // Use HTTP /shutdown so the sidecar can gracefully stop Ollama first.
    try {
      await fetch(`${SIDECAR_BASE}/shutdown`, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
    } catch { /* endpoint may not exist */ }
    // Wait for graceful exit
    await sleep(3000)
    if (proc.exitCode === null && !proc.killed) {
      try { execFileSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' }) } catch { /* gone */ }
    }
    // Verify sidecar port is released (ollama + llama-server killed via tree)
    for (let i = 0; i < 5; i++) {
      await sleep(500)
      try {
        await fetch(`${SIDECAR_BASE}/health`, { signal: AbortSignal.timeout(500) })
      } catch { break } // connection refused = process exited
    }
  } else {
    // Unix: SIGTERM gives sidecar a chance to run atexit cleanup
    proc.kill('SIGTERM')
    // Poll for exit every 500ms, up to 8 seconds
    for (let i = 0; i < 16; i++) {
      await sleep(500)
      if (proc.exitCode !== null) break
    }
    // If still alive after 8s, force kill
    if (proc.exitCode === null && !proc.killed) {
      try { proc.kill('SIGKILL') } catch { /* already dead */ }
    }
    // Give OS 2s to fully release the child
    await sleep(2000)
  }
}

// ---------------------------------------------------------------------------
// Window & App
// ---------------------------------------------------------------------------

function vaultRoot(): string {
  return appPaths?.vault ?? getAppDataPaths().vault
}

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

function getWindowStatePath(): string {
  const ad = appPaths?.appData ?? getAppDataPaths().appData
  return join(ad, 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const p = getWindowStatePath()
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf8'))
    }
  } catch { /* ignore */ }
  return { width: 1280, height: 820 }
}

function saveWindowState(state: WindowState): void {
  try {
    const p = getWindowStatePath()
    writeFileSync(p, JSON.stringify(state), 'utf8')
  } catch { /* ignore */ }
}

function createWindow(): void {
  let windowState = loadWindowState()

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
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

  if (windowState.isMaximized) {
    mainWindow.maximize()
  }

  const saveState = () => {
    if (!mainWindow) return
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      const bounds = mainWindow.getBounds()
      windowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y
      }
    }
    windowState.isMaximized = mainWindow.isMaximized()
    saveWindowState(windowState)
  }

  mainWindow.on('resize', saveState)
  mainWindow.on('move', saveState)
  mainWindow.on('close', saveState)

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

    ipcMain.handle('app:setTheme', (_, theme: 'light' | 'dark' | 'system') => {
      nativeTheme.themeSource = theme
    })

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
      const result = await dialog.showMessageBox(mainWindow as BrowserWindow, {
        type: 'warning',
        buttons: ['Delete All & Quit', 'Cancel'],
        defaultId: 1,
        title: 'Delete All Data',
        message: 'This will permanently delete all notes, models, and settings.',
        detail: `Folder: ${paths.appData}\n\nThis cannot be undone.`
      })
      if (result.response !== 0) return { ok: false, canceled: true }
      await stopSidecar()
      rmSync(paths.appData, { recursive: true, force: true })
      app.quit()
      return { ok: true }
    })

    ipcMain.handle('vault:exportNote', async (_, relPath: string) => {
      const src = join(vaultRoot(), relPath)
      if (!existsSync(src)) return { ok: false, error: 'not_found' }
      const result = await dialog.showSaveDialog(mainWindow as BrowserWindow, {
        defaultPath: relPath.split('/').pop() ?? 'note.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      copyFileSync(src, result.filePath)
      return { ok: true, path: result.filePath }
    })

    ipcMain.handle('vault:exportAll', async () => {
      const result = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
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
        // macOS dock click: re-create window; only restart sidecar if it died
        if (!sidecarProcess) {
          await startSidecar()
        }
        createWindow()
      }
    })
  })

  // --- Graceful Shutdown Chain ---

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async (e) => {
    if (!isQuitting) {
      e.preventDefault()
      isQuitting = true
      try {
        await stopSidecar()
      } catch (err) {
        console.error('[main] stopSidecar failed:', err)
      }
      app.quit()
    }
  })

  // will-quit: synchronous-only. before-quit already handled async cleanup.
  // If sidecar is still alive here, it will be orphaned and cleaned up on next launch.
}

// OS signal handlers (covers unexpected termination, e.g. `kill`, Ctrl+C)
const handleSignal = (sig: string): void => {
  console.log(`[main] ${sig} received`)
  if (!isQuitting) {
    isQuitting = true
    stopSidecar().catch(console.error).finally(() => process.exit(0))
  }
}

process.on('SIGTERM', () => handleSignal('SIGTERM'))
process.on('SIGINT', () => handleSignal('SIGINT'))
