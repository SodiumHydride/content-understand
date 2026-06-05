import { app } from 'electron'
import { mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'

export interface AppDataPaths {
  appData: string
  vault: string
  cache: string
  models: string
  exports: string
  runtime: string
}

/**
 * Data directory strategy:
 * - macOS: ~/Library/Application Support/ContentUnderstand/ (standard, safe)
 * - Windows: <exe-dir>/data/ (self-contained, delete folder = clean uninstall)
 */
function resolveAppDataRoot(): string {
  if (process.platform === 'win32') {
    // Windows: next to the executable — truly self-contained
    const exeDir = dirname(process.execPath)
    return join(exeDir, 'data')
  }
  // macOS / Linux: standard Application Support
  return join(app.getPath('userData'), 'ContentUnderstand')
}

export function getAppDataPaths(): AppDataPaths {
  const appData = resolveAppDataRoot()
  const paths: AppDataPaths = {
    appData,
    vault: join(appData, 'vault'),
    cache: join(appData, 'cache'),
    models: join(appData, 'models'),
    exports: join(appData, 'exports'),
    runtime: join(appData, 'runtime'),
  }
  for (const dir of Object.values(paths)) {
    mkdirSync(dir, { recursive: true })
  }
  for (const sub of ['video', 'image', 'audio', 'article', 'notes']) {
    mkdirSync(join(paths.vault, sub), { recursive: true })
  }
  mkdirSync(join(paths.vault, '.content-app'), { recursive: true })
  return paths
}

export function sidecarEnv(paths: AppDataPaths): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CONTENT_APP_DATA: paths.appData,
    CONTENT_VAULT: paths.vault,
    CONTENT_CACHE: paths.cache,
    CONTENT_MODELS: paths.models,
  }
}
