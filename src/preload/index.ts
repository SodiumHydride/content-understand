import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getSidecarBase: (): Promise<string> => ipcRenderer.invoke('app:getSidecarBase'),
  pickVault: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickVault'),
  openPath: (filePath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', filePath),
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItemInFolder', filePath)
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)

export type AppApi = typeof api
