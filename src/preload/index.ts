import { contextBridge, ipcRenderer } from 'electron'

export interface AppDataPaths {
  appData: string
  vault: string
  cache: string
  models: string
  exports: string
  runtime: string
}

const api = {
  getSidecarBase: (): Promise<string> => ipcRenderer.invoke('app:getSidecarBase'),
  getAppPaths: (): Promise<AppDataPaths> => ipcRenderer.invoke('app:getPaths'),
  openVaultRoot: (): Promise<string> => ipcRenderer.invoke('vault:openRoot'),
  exportNote: (
    relPath: string
  ): Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('vault:exportNote', relPath),
  exportVault: (): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('vault:exportAll'),
  openPath: (filePath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', filePath),
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItemInFolder', filePath),
  openDataFolder: (): Promise<void> => ipcRenderer.invoke('app:openDataFolder'),
  getDataSize: (): Promise<number> => ipcRenderer.invoke('app:getDataSize'),
  deleteAllData: (): Promise<{ ok: boolean; canceled?: boolean }> =>
    ipcRenderer.invoke('app:deleteAllData'),
  setTheme: (theme: 'light' | 'dark' | 'system'): Promise<void> =>
    ipcRenderer.invoke('app:setTheme', theme),
}

contextBridge.exposeInMainWorld('api', api)

export type AppApi = typeof api
