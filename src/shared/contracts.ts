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

export interface CreateTerminalSessionInput {
  cwd: string
  cols: number
  rows: number
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

export interface ElectronApi {
  workspace: {
    getConfig: () => Promise<AppConfig>
    setPath: (workspacePath: string) => Promise<AppConfig>
    pickPath: () => Promise<AppConfig | null>
    selectProject: (projectPath: string) => Promise<AppConfig>
    removeProject: (projectPath: string) => Promise<AppConfig>
  }
  worktrees: {
    list: () => Promise<WorkspaceItem[]>
    create: (input: CreateWorktreeInput) => Promise<WorkspaceItem>
    remove: (input: DeleteWorktreeInput) => Promise<void>
  }
  terminal: {
    createSession: (input: CreateTerminalSessionInput) => Promise<{ sessionId: string; pid: number }>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    close: (sessionId: string) => Promise<void>
    setActiveSession: (sessionId: string | null) => Promise<void>
    onData: (listener: (event: TerminalDataEvent) => void) => () => void
    onExit: (listener: (event: TerminalExitEvent) => void) => () => void
    onProcessChange: (listener: (event: TerminalProcessEvent) => void) => () => void
    onControlInput: (listener: (data: string) => void) => () => void
  }
  claude: {
    onSessionChange: (listener: (sessions: ClaudeSessionInfo[]) => void) => () => void
    isHooksEnabled: () => Promise<boolean>
    enableHooks: () => Promise<void>
    disableHooks: () => Promise<void>
  }
}
