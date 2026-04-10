import { contextBridge, ipcRenderer } from 'electron'

import type {
  ClaudeSessionInfo,
  ElectronApi,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalProcessEvent
} from '../shared/contracts'

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
    setActiveSession: (sessionId) => ipcRenderer.invoke('terminal:set-active-session', sessionId),
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
    },
    onProcessChange: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, payload: TerminalProcessEvent) => {
        listener(payload)
      }

      ipcRenderer.on('terminal:process-change', wrappedListener)
      return () => ipcRenderer.off('terminal:process-change', wrappedListener)
    },
    onControlInput: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, data: string) => {
        listener(data)
      }

      ipcRenderer.on('terminal:control-input', wrappedListener)
      return () => ipcRenderer.off('terminal:control-input', wrappedListener)
    }
  },
  claude: {
    onSessionChange: (listener) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        payload: ClaudeSessionInfo[]
      ) => {
        listener(payload)
      }

      ipcRenderer.on('claude:session-change', wrappedListener)
      return () => ipcRenderer.off('claude:session-change', wrappedListener)
    },
    isHooksEnabled: () => ipcRenderer.invoke('claude:is-hooks-enabled'),
    enableHooks: () => ipcRenderer.invoke('claude:enable-hooks'),
    disableHooks: () => ipcRenderer.invoke('claude:disable-hooks')
  }
}

contextBridge.exposeInMainWorld('electree', api)
