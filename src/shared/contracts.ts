export type WorkspaceMode = 'empty' | 'directory' | 'git'

export interface Project {
  name: string
  rootPath: string
  repoPath: string | null
  worktreeRoot: string | null
  mode: WorkspaceMode
}

export interface AppConfig {
  activeProjectPath: string | null
  projects: Project[]
  shell: string
  defaultTabCommand: string
}

export interface WorkspaceItem {
  kind: 'directory' | 'worktree'
  path: string
  name: string
  branch: string | null
  head: string | null
  isBare: boolean
  isDetached: boolean
  isLocked: boolean
  isPrunable: boolean
  isMain: boolean
}

export interface CreateWorktreeInput {
  name: string
}

export interface DeleteWorktreeInput {
  path: string
}

export interface DeleteWorktreeResult {
  removedPath: string
  removedBranch: string | null
  warning: string | null
}

export interface CreateTerminalSessionInput {
  cwd: string
  cols: number
  rows: number
}

export interface CreateTerminalSessionResult {
  sessionId: string
  pid: number
  tmuxSessionName: string
}

export interface AttachTerminalSessionInput {
  tmuxSessionName: string
  cols: number
  rows: number
}

export interface AttachTerminalSessionResult {
  sessionId: string
  pid: number
}

export interface PersistedTab {
  id: string
  workspacePath: string
  tmuxSessionName: string
}

export interface PersistedTabState {
  tabs: PersistedTab[]
  activeTabId: Record<string, string>
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number | null
}

export interface TerminalProcessEvent {
  sessionId: string
  processName: string
}

export interface ClaudeSessionInfo {
  sessionId: string
  status: 'working' | 'idle'
  cwd: string
  name: string | null
  prompt: string | null
  shellPid: number
}

export interface OpenCodeSessionInfo {
  sessionId: string
  status: 'working' | 'idle'
  cwd: string
  name: string | null
  shellPid: number
}

export interface ElectronApi {
  workspace: {
    getConfig: () => Promise<AppConfig>
    setPath: (workspacePath: string) => Promise<AppConfig>
    pickPath: () => Promise<AppConfig | null>
    selectProject: (projectPath: string) => Promise<AppConfig>
    removeProject: (projectPath: string) => Promise<AppConfig>
    reorderProjects: (orderedPaths: string[]) => Promise<AppConfig>
    setDefaultTabCommand: (command: string) => Promise<AppConfig>
  }
  worktrees: {
    list: () => Promise<WorkspaceItem[]>
    create: (input: CreateWorktreeInput) => Promise<WorkspaceItem>
    remove: (input: DeleteWorktreeInput) => Promise<DeleteWorktreeResult>
  }
  clipboard: {
    writeText: (text: string) => Promise<void>
  }
  webUtils: {
    getPathForFile: (file: File) => string
  }
  terminal: {
    createSession: (input: CreateTerminalSessionInput) => Promise<CreateTerminalSessionResult>
    attachSession: (input: AttachTerminalSessionInput) => Promise<AttachTerminalSessionResult>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    detach: (sessionId: string) => Promise<void>
    destroySession: (tmuxSessionName: string) => Promise<void>
    listTmuxSessions: () => Promise<string[]>
    getPersistedTabs: () => Promise<PersistedTabState>
    persistTabs: (state: PersistedTabState) => Promise<void>
    setActiveSession: (sessionId: string | null) => Promise<void>
    writeToActiveSession: (data: string) => Promise<void>
    onData: (listener: (event: TerminalDataEvent) => void) => () => void
    onExit: (listener: (event: TerminalExitEvent) => void) => () => void
    onProcessChange: (listener: (event: TerminalProcessEvent) => void) => () => void
    onControlInput: (listener: (data: string) => void) => () => void
    toggleMouse: () => Promise<boolean>
    getMouseMode: () => Promise<boolean>
    onMouseModeChanged: (listener: (enabled: boolean) => void) => () => void
  }
  claude: {
    onSessionChange: (listener: (sessions: ClaudeSessionInfo[]) => void) => () => void
    isHooksEnabled: () => Promise<boolean>
    enableHooks: () => Promise<void>
    disableHooks: () => Promise<void>
  }
  opencode: {
    onSessionChange: (listener: (sessions: OpenCodeSessionInfo[]) => void) => () => void
  }
  cli: {
    isInstalled: () => Promise<boolean>
    install: () => Promise<void>
    uninstall: () => Promise<void>
  }
}
