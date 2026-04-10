import { contextBridge, ipcRenderer } from 'electron'

import type { ElectronApi, TerminalDataEvent, TerminalExitEvent } from '../shared/contracts'

const api: ElectronApi = {
  workspace: {
    getConfig: () => ipcRenderer.invoke('workspace:get-config'),
    setPath: (workspacePath) => ipcRenderer.invoke('workspace:set-path', workspacePath),
    pickPath: () => ipcRenderer.invoke('workspace:pick-path'),
    selectProject: (projectPath) => ipcRenderer.invoke('workspace:select-project', projectPath),
    removeProject: (projectPath) => ipcRenderer.invoke('workspace:remove-project', projectPath)
  },
  worktrees: {
    list: () => ipcRenderer.invoke('worktrees:list'),
    create: (input) => ipcRenderer.invoke('worktrees:create', input),
    remove: (input) => ipcRenderer.invoke('worktrees:remove', input)
  },
  terminal: {
    createSession: (input) => ipcRenderer.invoke('terminal:create-session', input),
    write: (sessionId, data) => ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    close: (sessionId) => ipcRenderer.invoke('terminal:close', sessionId),
    onData: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => {
        listener(payload)
      }

      ipcRenderer.on('terminal:data', wrappedListener)
      return () => ipcRenderer.off('terminal:data', wrappedListener)
    },
    onExit: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => {
        listener(payload)
      }

      ipcRenderer.on('terminal:exit', wrappedListener)
      return () => ipcRenderer.off('terminal:exit', wrappedListener)
    }
  }
}

contextBridge.exposeInMainWorld('electree', api)
