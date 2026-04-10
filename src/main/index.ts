import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  type OpenDialogOptions
} from 'electron'
import path from 'node:path'

import { disableClaudeHooks, enableClaudeHooks, isClaudeHooksEnabled } from './claude-hooks-config'
import { addProjectPath, getAppConfig, removeProjectPath, selectProjectPath } from './config'
import { ClaudeStatusWatcher } from './claude-status'
import { createWorktree, listWorkspaceItems, removeWorktree } from './git'
import { TerminalManager } from './terminal-manager'
import type {
  AppConfig,
  CreateTerminalSessionInput,
  CreateWorktreeInput,
  DeleteWorktreeInput,
  Project
} from '../shared/contracts'

let mainWindow: BrowserWindow | null = null
const terminalManager = new TerminalManager()
const claudeStatus = new ClaudeStatusWatcher()

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

  ipcMain.handle('worktrees:list', async () => {
    const config = await requireActiveProject()
    return listWorkspaceItems(config.activeProject.rootPath, config.activeProject.repoPath)
  })

  ipcMain.handle('worktrees:create', async (_event, input: CreateWorktreeInput) => {
    const config = await requireActiveProject()
    return createWorktree(config.activeProject.repoPath, config.activeProject.worktreeRoot, input)
  })

  ipcMain.handle('worktrees:remove', async (_event, input: DeleteWorktreeInput) => {
    const config = await requireActiveProject()
    return removeWorktree(config.activeProject.repoPath, input.path)
  })

  ipcMain.handle('terminal:create-session', (_event, input: CreateTerminalSessionInput) => {
    const sessionId = terminalManager.createSession(input)
    const pid = terminalManager.getPid(sessionId) ?? 0
    return { sessionId, pid }
  })
  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) =>
    terminalManager.write(sessionId, data)
  )
  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) =>
    terminalManager.resize(sessionId, cols, rows)
  )
  ipcMain.handle('terminal:close', (_event, sessionId: string) => terminalManager.close(sessionId))
  ipcMain.handle('terminal:set-active-session', (_event, sessionId: string | null) =>
    terminalManager.setActiveSession(sessionId)
  )

  ipcMain.handle('claude:is-hooks-enabled', () => isClaudeHooksEnabled())
  ipcMain.handle('claude:enable-hooks', () => enableClaudeHooks())
  ipcMain.handle('claude:disable-hooks', () => disableClaudeHooks())
}

app.whenReady().then(async () => {
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
      label: 'Window',
      submenu: [
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

  claudeStatus.start()
  await createWindow()

  // Prevent Chromium from swallowing Ctrl+<letter> combos (Ctrl+R, Ctrl+C, etc.)
  // that must reach the terminal PTY. We write the control character directly to
  // the active PTY session from the main process — no renderer round-trip needed.
  mainWindow!.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.meta || input.alt) {
      return
    }

    const key = input.key.toUpperCase()
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
  terminalManager.disposeAll()
})
