import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  type OpenDialogOptions
} from 'electron'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { installCli, isCliInstalled, uninstallCli } from './cli-install'
import { checkAllTools, installTool } from './coding-tools'
import { disableClaudeHooks, enableClaudeHooks, isClaudeHooksEnabled } from './claude-hooks-config'
import { disableCodexHooks, enableCodexHooks, isCodexHooksEnabled } from './codex-hooks-config'
import { disableGeminiHooks, enableGeminiHooks, isGeminiHooksEnabled } from './gemini-hooks-config'
import {
  addProjectPath,
  getAppConfig,
  removeProjectPath,
  reorderProjectPaths,
  selectProjectPath,
  setDefaultTabCommand
} from './config'
import { ClaudeStatusWatcher } from './claude-status'
import { CodexStatusWatcher } from './codex-status'
import { GeminiStatusWatcher } from './gemini-status'
import { createWorktree, listWorkspaceItems, removeWorktree } from './git'
import { loadTabState, saveTabState } from './tab-store'
import { TerminalManager } from './terminal-manager'
import type {
  AppConfig,
  AttachTerminalSessionInput,
  CreateTerminalSessionInput,
  CreateWorktreeInput,
  DeleteWorktreeInput,
  PersistedTabState,
  Project
} from '../shared/contracts'

let mainWindow: BrowserWindow | null = null
const terminalManager = new TerminalManager()
const claudeStatus = new ClaudeStatusWatcher()
const codexStatus = new CodexStatusWatcher()
const geminiStatus = new GeminiStatusWatcher()

interface ReadyAppConfig extends AppConfig {
  activeProject: Project
}

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const requireActiveProject = async (): Promise<ReadyAppConfig> => {
  const config = await getAppConfig()
  const activeProject = config.projects.find((project) => project.rootPath === config.activeProjectPath)

  if (!activeProject) {
    throw new Error('Configura primero una carpeta de trabajo.')
  }

  return {
    ...config,
    activeProject
  }
}

const registerIpc = () => {
  ipcMain.handle('workspace:get-config', () => getAppConfig())
  ipcMain.handle('workspace:set-path', (_event, workspacePath: string) => addProjectPath(workspacePath))
  ipcMain.handle('workspace:select-project', (_event, projectPath: string) => selectProjectPath(projectPath))
  ipcMain.handle('workspace:remove-project', (_event, projectPath: string) => removeProjectPath(projectPath))
  ipcMain.handle('workspace:reorder-projects', (_event, orderedPaths: string[]) => reorderProjectPaths(orderedPaths))
  ipcMain.handle('workspace:set-default-tab-command', (_event, command: string) => setDefaultTabCommand(command))
  ipcMain.handle('workspace:pick-path', async () => {
    const config = await getAppConfig()
    const options: OpenDialogOptions = {
      title: 'Selecciona una carpeta de trabajo',
      properties: ['openDirectory'],
      defaultPath: config.activeProjectPath ?? process.cwd()
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return addProjectPath(result.filePaths[0])
  })

  ipcMain.handle('worktrees:list', async (_event, rootPath: string, repoPath: string | null) => {
    return listWorkspaceItems(rootPath, repoPath)
  })

  ipcMain.handle('worktrees:create', async (_event, input: CreateWorktreeInput) => {
    const config = await requireActiveProject()
    return createWorktree(config.activeProject.repoPath, config.activeProject.worktreeRoot, input)
  })

  ipcMain.handle('worktrees:remove', async (_event, input: DeleteWorktreeInput) => {
    const config = await requireActiveProject()
    return removeWorktree(config.activeProject.repoPath, input.path)
  })
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('terminal:create-session', (_event, input: CreateTerminalSessionInput) => {
    const { id, tmuxSessionName } = terminalManager.createSession(input)
    const pid = terminalManager.getPid(id) ?? 0
    return { sessionId: id, pid, tmuxSessionName }
  })
  ipcMain.handle('terminal:attach-session', (_event, input: AttachTerminalSessionInput) => {
    const { id } = terminalManager.attachSession(input.tmuxSessionName, input.cols, input.rows)
    const pid = terminalManager.getPid(id) ?? 0
    return { sessionId: id, pid }
  })
  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) =>
    terminalManager.write(sessionId, data)
  )
  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) =>
    terminalManager.resize(sessionId, cols, rows)
  )
  ipcMain.handle('terminal:detach', (_event, sessionId: string) =>
    terminalManager.detach(sessionId)
  )
  ipcMain.handle('terminal:destroy-session', (_event, tmuxSessionName: string) =>
    terminalManager.destroyTmuxSession(tmuxSessionName)
  )
  ipcMain.handle('terminal:list-tmux-sessions', () => terminalManager.listTmuxSessions())
  ipcMain.handle('terminal:get-persisted-tabs', () => loadTabState())
  ipcMain.handle('terminal:persist-tabs', (_event, state: PersistedTabState) => saveTabState(state))
  ipcMain.handle('terminal:set-active-session', (_event, sessionId: string | null) =>
    terminalManager.setActiveSession(sessionId)
  )
  ipcMain.handle('terminal:write-to-active-session', (_event, data: string) =>
    terminalManager.writeToActiveSession(data)
  )
  ipcMain.handle('terminal:toggle-mouse', () => {
    const enabled = terminalManager.toggleMouse()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:mouse-mode-changed', enabled)
    }
    return enabled
  })
  ipcMain.handle('terminal:get-mouse-mode', () => terminalManager.isMouseEnabled())

  ipcMain.handle('claude:is-hooks-enabled', () => isClaudeHooksEnabled())
  ipcMain.handle('claude:enable-hooks', () => enableClaudeHooks())
  ipcMain.handle('claude:disable-hooks', () => disableClaudeHooks())

  ipcMain.handle('gemini:is-hooks-enabled', () => isGeminiHooksEnabled())
  ipcMain.handle('gemini:enable-hooks', () => enableGeminiHooks())
  ipcMain.handle('gemini:disable-hooks', () => disableGeminiHooks())

  ipcMain.handle('codex:is-hooks-enabled', () => isCodexHooksEnabled())
  ipcMain.handle('codex:enable-hooks', () => enableCodexHooks())
  ipcMain.handle('codex:disable-hooks', () => disableCodexHooks())

  ipcMain.handle('cli:is-installed', () => isCliInstalled())
  ipcMain.handle('cli:install', () => installCli())
  ipcMain.handle('cli:uninstall', () => uninstallCli())

  ipcMain.handle('tools:check-all', () => checkAllTools())
  ipcMain.handle('tools:install', (_event, toolId: string) => installTool(toolId))
}

function fixPath(): void {
  if (process.platform !== 'darwin') return
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const current = process.env.PATH ?? ''
  const missing = extraPaths.filter((p) => !current.split(':').includes(p))
  if (missing.length > 0) {
    process.env.PATH = `${current}:${missing.join(':')}`
  }
}

function isTmuxInstalled(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

app.whenReady().then(async () => {
  fixPath()

  if (!isTmuxInstalled()) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'tmux no encontrado',
      message: 'Electree necesita tmux para funcionar.',
      detail:
        'Instálalo con Homebrew ejecutando en tu terminal:\n\n  brew install tmux\n\nDespués vuelve a abrir la aplicación.',
      buttons: ['Cerrar aplicación', 'Copiar comando'],
      defaultId: 0,
      cancelId: 0
    })

    if (response === 1) {
      const { clipboard } = await import('electron')
      clipboard.writeText('brew install tmux')
    }

    app.quit()
    return
  }

  // Handle --open-path CLI argument
  const openPathIndex = process.argv.indexOf('--open-path')
  if (openPathIndex !== -1 && process.argv[openPathIndex + 1]) {
    const targetPath = process.argv[openPathIndex + 1]
    await addProjectPath(targetPath).catch(() => {
      // Path may already be added or invalid — ignore silently
    })
  }

  // Custom menu that only keeps essential app shortcuts.
  // The default Electron menu intercepts keys like Cmd+R, Cmd+Shift+R, etc.
  // which should be forwarded to the terminal instead.
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Alt+I',
          click: () => mainWindow?.webContents.toggleDevTools()
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)

  registerIpc()

  terminalManager.on('data', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:data', event)
    }
  })

  terminalManager.on('exit', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:exit', event)
    }
  })

  terminalManager.on('processChange', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:process-change', event)
    }
  })

  claudeStatus.on('change', (sessions) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('claude:session-change', sessions)
    }
  })

  codexStatus.on('change', (sessions) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('codex:session-change', sessions)
    }
  })

  geminiStatus.on('change', (sessions) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('gemini:session-change', sessions)
    }
  })

  claudeStatus.start()
  codexStatus.start()
  geminiStatus.start()

  try {
    const persistedTabs = await loadTabState()
    terminalManager.pruneOrphanedSessions(persistedTabs.tabs.map((tab) => tab.tmuxSessionName))
  } catch (error) {
    console.warn('[terminal] failed to prune orphaned tmux sessions', error)
  }

  await createWindow()

  // Prevent Chromium from swallowing Ctrl+<letter> combos (Ctrl+R, Ctrl+C, etc.)
  // that must reach the terminal PTY. We write the control character directly to
  // the active PTY session from the main process — no renderer round-trip needed.
  mainWindow!.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.meta || input.alt) {
      return
    }

    const key = input.key.toUpperCase()
    if (input.shift && key === 'C') {
      return
    }

    if (key.length === 1 && key >= 'A' && key <= 'Z') {
      event.preventDefault()
      const controlChar = String.fromCharCode(key.charCodeAt(0) - 64)
      terminalManager.writeToActiveSession(controlChar)
    }
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  claudeStatus.stop()
  codexStatus.stop()
  geminiStatus.stop()
  // Only detach PTYs — tmux sessions survive for reattach on next launch.
  terminalManager.disposeAll()
})
