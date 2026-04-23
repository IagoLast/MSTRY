import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type {
  ClaudeSessionInfo,
  CodingToolInfo,
  CodexSessionInfo,
  ElectronApi,
  GeminiSessionInfo,
  OpenCodeSessionInfo,
  PersistedTabState,
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
    removeProject: (projectPath) => ipcRenderer.invoke('workspace:remove-project', projectPath),
    reorderProjects: (orderedPaths) => ipcRenderer.invoke('workspace:reorder-projects', orderedPaths),
    setDefaultTabCommand: (command) => ipcRenderer.invoke('workspace:set-default-tab-command', command)
  },
  worktrees: {
    list: (input) => ipcRenderer.invoke('worktrees:list', input),
    create: (input) => ipcRenderer.invoke('worktrees:create', input),
    remove: (input) => ipcRenderer.invoke('worktrees:remove', input),
    checkoutMain: (input) => ipcRenderer.invoke('worktrees:checkout-main', input)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text)
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  terminal: {
    createSession: (input) => ipcRenderer.invoke('terminal:create-session', input),
    attachSession: (input) => ipcRenderer.invoke('terminal:attach-session', input),
    write: (sessionId, data) => ipcRenderer.invoke('terminal:write', sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    detach: (sessionId) => ipcRenderer.invoke('terminal:detach', sessionId),
    destroySession: (tmuxSessionName) =>
      ipcRenderer.invoke('terminal:destroy-session', tmuxSessionName),
    listTmuxSessions: () => ipcRenderer.invoke('terminal:list-tmux-sessions'),
    getPersistedTabs: () => ipcRenderer.invoke('terminal:get-persisted-tabs'),
    persistTabs: (state: PersistedTabState) =>
      ipcRenderer.invoke('terminal:persist-tabs', state),
    setActiveSession: (sessionId) => ipcRenderer.invoke('terminal:set-active-session', sessionId),
    writeToActiveSession: (data) => ipcRenderer.invoke('terminal:write-to-active-session', data),
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
    },
    toggleMouse: () => ipcRenderer.invoke('terminal:toggle-mouse'),
    getMouseMode: () => ipcRenderer.invoke('terminal:get-mouse-mode'),
    onMouseModeChanged: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, enabled: boolean) => {
        listener(enabled)
      }
      ipcRenderer.on('terminal:mouse-mode-changed', wrappedListener)
      return () => ipcRenderer.off('terminal:mouse-mode-changed', wrappedListener)
    }
  },
  claude: {
    onSessionChange: (listener) => {
      let receivedLiveUpdate = false
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        payload: ClaudeSessionInfo[]
      ) => {
        receivedLiveUpdate = true
        listener(payload)
      }

      ipcRenderer.on('claude:session-change', wrappedListener)
      void ipcRenderer
        .invoke('claude:get-sessions')
        .then((payload: ClaudeSessionInfo[]) => {
          if (!receivedLiveUpdate) {
            listener(payload)
          }
        })
        .catch(() => {})

      return () => ipcRenderer.off('claude:session-change', wrappedListener)
    },
    isHooksEnabled: () => ipcRenderer.invoke('claude:is-hooks-enabled'),
    enableHooks: () => ipcRenderer.invoke('claude:enable-hooks'),
    disableHooks: () => ipcRenderer.invoke('claude:disable-hooks')
  },
  cli: {
    isInstalled: () => ipcRenderer.invoke('cli:is-installed'),
    install: () => ipcRenderer.invoke('cli:install'),
    uninstall: () => ipcRenderer.invoke('cli:uninstall')
  },
  opencode: {
    onSessionChange: (listener) => {
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        payload: OpenCodeSessionInfo[]
      ) => {
        listener(payload)
      }

      ipcRenderer.on('opencode:session-change', wrappedListener)
      return () => ipcRenderer.off('opencode:session-change', wrappedListener)
    }
  },
  codex: {
    onSessionChange: (listener) => {
      let receivedLiveUpdate = false
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        payload: CodexSessionInfo[]
      ) => {
        receivedLiveUpdate = true
        listener(payload)
      }

      ipcRenderer.on('codex:session-change', wrappedListener)
      void ipcRenderer
        .invoke('codex:get-sessions')
        .then((payload: CodexSessionInfo[]) => {
          if (!receivedLiveUpdate) {
            listener(payload)
          }
        })
        .catch(() => {})

      return () => ipcRenderer.off('codex:session-change', wrappedListener)
    },
    isHooksEnabled: () => ipcRenderer.invoke('codex:is-hooks-enabled'),
    enableHooks: () => ipcRenderer.invoke('codex:enable-hooks'),
    disableHooks: () => ipcRenderer.invoke('codex:disable-hooks')
  },
  gemini: {
    isHooksEnabled: () => ipcRenderer.invoke('gemini:is-hooks-enabled'),
    enableHooks: () => ipcRenderer.invoke('gemini:enable-hooks'),
    disableHooks: () => ipcRenderer.invoke('gemini:disable-hooks')
  },
  tools: {
    checkAll: () => ipcRenderer.invoke('tools:check-all'),
    install: (toolId: string) => ipcRenderer.invoke('tools:install', toolId)
  },
  files: {
    listDirectory: (input) => ipcRenderer.invoke('files:list-directory', input),
    getGitStatus: (input) => ipcRenderer.invoke('files:git-status', input)
  }
}

contextBridge.exposeInMainWorld('mstry', api)
