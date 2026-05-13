import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useHotkeys } from '@tanstack/react-hotkeys'
import {
  VscAdd,
  VscCheck,
  VscChevronDown,
  VscChevronRight,
  VscClose,
  VscFile,
  VscFolderOpened,
  VscListFlat,
  VscListTree,
  VscLayoutSidebarLeft,
  VscLayoutSidebarLeftOff,
  VscRefresh,
  VscRepo,
  VscSettingsGear,
  VscSourceControl,
  VscTerminalBash,
  VscTrash
} from 'react-icons/vsc'
import { SiClaude, SiOpenai } from 'react-icons/si'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type {
  AgentProcessKind,
  AppConfig,
  ClaudeSessionInfo,
  CodexSessionInfo,
  GitFileStatus,
  OpenCodeSessionInfo,
  PersistedTab,
  Project,
  TerminalProcessState,
  WorkspaceItem
} from '../../shared/contracts'
import { CommandPalette, type CommandItem } from './components/command-palette'
import { FileExplorer } from './components/file-explorer'
import { FileEditor } from './components/file-editor'
import { GitDiffEditor } from './components/git-diff-editor'
import { GitPanel } from './components/git-panel'
import { SettingsPanel } from './components/settings-panel'
import { WorktreeTerminal } from './components/worktree-terminal'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { ScrollArea } from './components/ui/scroll-area'
import { getElectronBridge } from './lib/electron-bridge'
import { cn } from './lib/utils'

interface TerminalTab {
  kind: 'terminal'
  id: string
  workspacePath: string
  initialCommand?: string
  tmuxSessionName: string | null
  sessionId: string | null
  pid: number | null
  processName: string | null
  processAgent: AgentProcessKind | null
  processState: TerminalProcessState
}

interface EditorTab {
  kind: 'editor'
  id: string
  workspacePath: string
  filePath: string
  title: string
}

interface DiffTab {
  kind: 'git-diff'
  id: string
  workspacePath: string
  filePath: string
  title: string
}

type AppTab = TerminalTab | EditorTab | DiffTab

interface EditorDocumentState {
  value: string
  savedValue: string
  isLoading: boolean
  isSaving: boolean
  errorMessage: string | null
}

interface DiffDocumentState {
  originalValue: string
  modifiedValue: string
  status: GitFileStatus
  isLoading: boolean
  errorMessage: string | null
}

const createTab = (workspacePath: string, initialCommand?: string): TerminalTab => ({
  kind: 'terminal',
  id: crypto.randomUUID(),
  workspacePath,
  initialCommand,
  tmuxSessionName: null,
  sessionId: null,
  pid: null,
  processName: null,
  processAgent: null,
  processState: 'inactive'
})

const createRestoredTab = (persisted: PersistedTab): TerminalTab => ({
  kind: 'terminal',
  id: persisted.id,
  workspacePath: persisted.workspacePath,
  tmuxSessionName: persisted.tmuxSessionName,
  sessionId: null,
  pid: null,
  processName: null,
  processAgent: null,
  processState: 'inactive'
})

const createEditorTab = (workspacePath: string, filePath: string): EditorTab => ({
  kind: 'editor',
  id: crypto.randomUUID(),
  workspacePath,
  filePath,
  title: filePath.split(/[\\/]/).pop() ?? 'file'
})

const createDiffTab = (workspacePath: string, filePath: string): DiffTab => ({
  kind: 'git-diff',
  id: crypto.randomUUID(),
  workspacePath,
  filePath,
  title: `diff:${filePath.split(/[\\/]/).pop() ?? 'file'}`
})

const isSameOrChildPath = (basePath: string, candidatePath: string) => {
  const normalizedBasePath = basePath.replace(/[\\/]+$/, '')
  return (
    candidatePath === normalizedBasePath ||
    candidatePath.startsWith(`${normalizedBasePath}/`) ||
    candidatePath.startsWith(`${normalizedBasePath}\\`)
  )
}

const getProjectMatchLength = (project: Project, workspacePath: string) => {
  const matches = [project.rootPath, project.worktreeRoot]
    .filter((candidatePath): candidatePath is string => Boolean(candidatePath))
    .filter((candidatePath) => isSameOrChildPath(candidatePath, workspacePath))
    .map((candidatePath) => candidatePath.length)

  return matches.length > 0 ? Math.max(...matches) : 0
}

const workspaceBelongsToProject = (project: Project, workspacePath: string) =>
  getProjectMatchLength(project, workspacePath) > 0

const findOwnerProject = (projects: Project[], workspacePath: string) => {
  let ownerProject: Project | null = null
  let bestMatchLength = 0

  for (const project of projects) {
    const matchLength = getProjectMatchLength(project, workspacePath)
    if (matchLength > bestMatchLength) {
      ownerProject = project
      bestMatchLength = matchLength
    }
  }

  return ownerProject
}

const buildValidActiveTabId = <T extends { id: string; workspacePath: string }>(
  tabs: T[],
  currentActiveTabId: Record<string, string>
) =>
  Object.fromEntries(
    [...tabs.reduce<Map<string, T[]>>((acc, tab) => {
      const workspaceTabs = acc.get(tab.workspacePath) ?? []
      workspaceTabs.push(tab)
      acc.set(tab.workspacePath, workspaceTabs)
      return acc
    }, new Map()).entries()].map(([workspacePath, workspaceTabs]) => {
      const activeTab = workspaceTabs.find((tab) => tab.id === currentActiveTabId[workspacePath]) ?? workspaceTabs[0]
      return [workspacePath, activeTab.id]
    })
  )

const isClaudeProcess = (name: string | null) =>
  name != null && /\bclaude\b/i.test(name)

const isCodexProcess = (name: string | null) =>
  name != null && /\bcodex\b/i.test(name)

const isOpenCodeProcess = (name: string | null) =>
  name != null && /\bopencode\b/i.test(name)

const getProcessAgentKind = (tab: TerminalTab): AgentProcessKind | null => {
  if (tab.processAgent) return tab.processAgent
  if (isClaudeProcess(tab.processName)) return 'claude'
  if (isCodexProcess(tab.processName)) return 'codex'
  if (isOpenCodeProcess(tab.processName)) return 'opencode'
  return null
}

const getAgentDisplayName = (agent: AgentProcessKind) => {
  if (agent === 'claude') return 'Claude'
  if (agent === 'codex') return 'Codex'
  if (agent === 'opencode') return 'OpenCode'
  return 'Gemini'
}

const getAgentState = (
  status: 'working' | 'idle' | undefined,
  processState: TerminalProcessState
): TerminalProcessState | null => {
  if (status === 'working') return 'active'
  if (status === 'idle') return 'inactive'
  if (processState === 'active') return 'active'
  return null
}

const getAgentColorClass = (state: TerminalProcessState | null) => {
  if (state === 'active') return 'text-green-400'
  if (state === 'inactive') return 'text-red-400'
  return 'text-icon'
}

const getTerminalAgent = (
  tab: TerminalTab,
  claudeSessions: ClaudeSessionInfo[],
  codexSessions: CodexSessionInfo[]
) => {
  const claudeInfo = tab.pid
    ? claudeSessions.find((s) => s.shellPid === tab.pid) ?? null
    : null
  const codexInfo = tab.pid
    ? codexSessions.find((s) => s.shellPid === tab.pid) ?? null
    : null
  const processAgent = getProcessAgentKind(tab)
  const agent = codexInfo ? 'codex' : claudeInfo ? 'claude' : processAgent
  const info = agent === 'codex' ? codexInfo : agent === 'claude' ? claudeInfo : null
  const state = getAgentState(info?.status, tab.processState)

  return {
    agent,
    info,
    state,
    prompt: info?.prompt ?? null
  }
}

function AgentIcon({
  agent,
  state,
  className
}: {
  agent: AgentProcessKind
  state: TerminalProcessState | null
  className: string
}) {
  if (agent === 'claude') {
    return <SiClaude className={cn(className, getAgentColorClass(state))} />
  }

  if (agent === 'codex') {
    return <SiOpenai className={cn(className, getAgentColorClass(state))} />
  }

  return (
    <span className={cn('flex items-center justify-center text-[10px] font-bold leading-none', className, getAgentColorClass(state))}>
      {agent === 'opencode' ? 'O' : 'G'}
    </span>
  )
}

const selectedWorkspaceQueryKey = ['ui', 'selected-workspace'] as const

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return 'An unexpected error occurred.'
}

const useSelectedWorkspace = () => {
  const queryClient = useQueryClient()
  const selectedWorkspaceQuery = useQuery({
    queryKey: selectedWorkspaceQueryKey,
    queryFn: async () =>
      queryClient.getQueryData<string | null>(selectedWorkspaceQueryKey) ?? null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  })

  return {
    selectedWorkspacePath: selectedWorkspaceQuery.data,
    setSelectedWorkspacePath: (value: string | null) => {
      queryClient.setQueryData(selectedWorkspaceQueryKey, value)
    }
  }
}

const randomAdjectives = ['swift', 'bold', 'calm', 'dark', 'eager', 'fair', 'keen', 'neat', 'warm', 'wise']
const randomNouns = ['oak', 'fox', 'elm', 'ray', 'dew', 'ash', 'bay', 'ivy', 'owl', 'sky']

const generateRandomWorktreeName = () => {
  const adj = randomAdjectives[Math.floor(Math.random() * randomAdjectives.length)]
  const noun = randomNouns[Math.floor(Math.random() * randomNouns.length)]
  return `${adj}-${noun}`
}

function SortableTabButton({
  id,
  className,
  onClick,
  children
}: {
  id: string
  className?: string
  onClick?: () => void
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined
  }
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      onClick={onClick}
      className={className}
      {...attributes}
      {...listeners}
    >
      {children}
    </button>
  )
}

export function App() {
  const queryClient = useQueryClient()
  const { selectedWorkspacePath, setSelectedWorkspacePath } = useSelectedWorkspace()
  const [tabs, setTabs] = useState<AppTab[]>([])
  const [activeTabId, setActiveTabId] = useState<Record<string, string>>({})
  const tabsRef = useRef<AppTab[]>([])
  const activeTabIdRef = useRef<Record<string, string>>({})
  const selectedWorkspacePathRef = useRef<string | null>(selectedWorkspacePath)
  const [agentsCollapsed, setAgentsCollapsed] = useState(false)
  const [agentsCompact, setAgentsCompact] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const [gitCollapsed, setGitCollapsed] = useState(false)
  const [collapsedAgentProjects, setCollapsedAgentProjects] = useState<Set<string>>(new Set())
  const [collapsedAgentWorktrees, setCollapsedAgentWorktrees] = useState<Set<string>>(new Set())
  const [draftWorktreeName, setDraftWorktreeName] = useState<string | null>(null)
  const [draftWorktreeProjectPath, setDraftWorktreeProjectPath] = useState<string | null>(null)
  const [worktreeMenuProjectPath, setWorktreeMenuProjectPath] = useState<string | null>(null)
  const worktreeMenuRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('electree:sidebar-width') : null
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 200), 800) : 400
  })
  const [mouseMode, setMouseMode] = useState(false)
  const [customTabNames, setCustomTabNames] = useState<Record<string, string>>({})
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [editorDocuments, setEditorDocuments] = useState<Record<string, EditorDocumentState>>({})
  const [diffDocuments, setDiffDocuments] = useState<Record<string, DiffDocumentState>>({})
  const terminalTabs = useMemo(
    () => tabs.filter((tab): tab is TerminalTab => tab.kind === 'terminal'),
    [tabs]
  )

  const appConfigQuery = useQuery({
    queryKey: ['app-config'],
    queryFn: () => getElectronBridge().workspace.getConfig()
  })

  const selectedGitStatusQuery = useQuery({
    queryKey: ['files', 'git-status', selectedWorkspacePath],
    queryFn: async () => {
      if (!selectedWorkspacePath) return []
      return getElectronBridge().files.getGitStatus({ cwd: selectedWorkspacePath })
    },
    enabled: selectedWorkspacePath !== null,
    refetchInterval: 3000,
    staleTime: 1500
  })

  const quickOpenFilesQuery = useQuery({
    queryKey: ['files', 'workspace-files', selectedWorkspacePath],
    queryFn: async () => {
      if (!selectedWorkspacePath) return []
      return getElectronBridge().files.listWorkspaceFiles({ cwd: selectedWorkspacePath })
    },
    enabled: selectedWorkspacePath !== null && quickOpenOpen,
    staleTime: 15_000
  })

  const activeProject = useMemo(
    () =>
      appConfigQuery.data?.projects.find(
        (project) => project.rootPath === appConfigQuery.data?.activeProjectPath
      ) ?? null,
    [appConfigQuery.data]
  )
  const defaultTabCommand = appConfigQuery.data?.defaultTabCommand || undefined

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  useEffect(() => {
    selectedWorkspacePathRef.current = selectedWorkspacePath
  }, [selectedWorkspacePath])

  const commitTabState = useCallback(
    (nextTabs: AppTab[]) => {
      const nextActiveTabId = buildValidActiveTabId(nextTabs, activeTabIdRef.current)
      const currentSelectedWorkspacePath = selectedWorkspacePathRef.current
      const nextSelectedWorkspacePath =
        currentSelectedWorkspacePath && nextTabs.some((tab) => tab.workspacePath === currentSelectedWorkspacePath)
          ? currentSelectedWorkspacePath
          : nextTabs[0]?.workspacePath ?? null

      tabsRef.current = nextTabs
      activeTabIdRef.current = nextActiveTabId
      selectedWorkspacePathRef.current = nextSelectedWorkspacePath

      setTabs(nextTabs)
      setActiveTabId(nextActiveTabId)
      setSelectedWorkspacePath(nextSelectedWorkspacePath)
    },
    [setSelectedWorkspacePath]
  )

  const projectPaths = appConfigQuery.data?.projects.map((project) => project.rootPath) ?? []

  const workspacesByProjectQuery = useQuery({
    queryKey: ['workspaces', projectPaths],
    queryFn: async () => {
      const bridge = getElectronBridge()
      const entries = await Promise.all(
        projectPaths.map(async (projectPath) => [
          projectPath,
          await bridge.worktrees.list({ projectPath })
        ] as const)
      )

      return Object.fromEntries(entries) as Record<string, WorkspaceItem[]>
    },
    enabled: projectPaths.length > 0
  })

  const activeWorkspaces = activeProject
    ? (workspacesByProjectQuery.data?.[activeProject.rootPath] ?? [])
    : []

  const pickProjectMutation = useMutation({
    mutationFn: () => getElectronBridge().workspace.pickPath(),
    onSuccess: (config) => {
      if (!config) {
        return
      }

      queryClient.setQueryData(['app-config'], config)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const selectProjectMutation = useMutation({
    mutationFn: (projectPath: string) => getElectronBridge().workspace.selectProject(projectPath),
    onSuccess: (config) => {
      queryClient.setQueryData(['app-config'], config)
      setDraftWorktreeName(null)
      setDraftWorktreeProjectPath(null)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const removeProjectMutation = useMutation({
    mutationFn: (project: Project) => getElectronBridge().workspace.removeProject(project.rootPath),
    onSuccess: (config, removedProject) => {
      queryClient.setQueryData(['app-config'], config)
      const bridge = getElectronBridge()
      const removedTabIds = new Set(
        tabsRef.current
          .filter((tab): tab is TerminalTab => tab.kind === 'terminal' && workspaceBelongsToProject(removedProject, tab.workspacePath))
          .map((tab) => {
            if (tab.tmuxSessionName) void bridge.terminal.destroySession(tab.tmuxSessionName)
            return tab.id
          })
      )
      commitTabState(tabsRef.current.filter((tab) => !removedTabIds.has(tab.id)))
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const focusWorkspace = useCallback(
    (
      workspacePath: string,
      options?: {
        createNewTab?: boolean
        projectPath?: string | null
      }
    ) => {
      if (options?.projectPath && options.projectPath !== activeProject?.rootPath) {
        void selectProjectMutation.mutateAsync(options.projectPath)
      }

      if (options?.createNewTab) {
        const tab = createTab(workspacePath, defaultTabCommand)
        setTabs((current) => [...current, tab])
        setActiveTabId((current) => ({ ...current, [workspacePath]: tab.id }))
      } else {
        const hasTabs = tabsRef.current.some((tab) => tab.workspacePath === workspacePath)
        if (!hasTabs) {
          const tab = createTab(workspacePath, defaultTabCommand)
          setTabs((current) => [...current, tab])
          setActiveTabId((current) => ({ ...current, [workspacePath]: tab.id }))
        }
      }

      setSelectedWorkspacePath(workspacePath)
    },
    [activeProject?.rootPath, defaultTabCommand, selectProjectMutation, setSelectedWorkspacePath]
  )

  const createWorktreeMutation = useMutation({
    mutationFn: ({ name, projectPath }: { name: string; projectPath: string | null }) =>
      getElectronBridge().worktrees.create({
        name,
        projectPath: projectPath ?? undefined
      }),
    onSuccess: (workspace, variables) => {
      setDraftWorktreeName(null)
      setDraftWorktreeProjectPath(null)
      focusWorkspace(workspace.path, { projectPath: variables.projectPath })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const removeWorktreeMutation = useMutation({
    mutationFn: ({ workspacePath, projectPath }: { workspacePath: string; projectPath: string }) =>
      getElectronBridge().worktrees.remove({ path: workspacePath, projectPath }),
    onSuccess: (result, variables) => {
      const bridge = getElectronBridge()
      const removedTabIds = new Set(
        tabsRef.current
          .filter((tab): tab is TerminalTab => tab.kind === 'terminal' && tab.workspacePath === variables.workspacePath)
          .map((tab) => {
            if (tab.tmuxSessionName) void bridge.terminal.destroySession(tab.tmuxSessionName)
            return tab.id
          })
      )
      commitTabState(tabsRef.current.filter((tab) => !removedTabIds.has(tab.id)))
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })

      if (result.warning) {
        window.alert(result.warning)
      }
    }
  })

  const checkoutMainMutation = useMutation({
    mutationFn: (projectPath: string) =>
      getElectronBridge().worktrees.checkoutMain({ projectPath }),
    onSuccess: (_result, projectPath) => {
      focusWorkspace(projectPath, { projectPath })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  useEffect(() => {
    if (selectProjectMutation.isPending) return

    const projects = appConfigQuery.data?.projects ?? []

    if (!activeProject) {
      if (selectedWorkspacePath !== null) {
        setSelectedWorkspacePath(null)
      }
      return
    }

    const selectedOwner = selectedWorkspacePath
      ? findOwnerProject(projects, selectedWorkspacePath)
      : null

    if (selectedOwner && selectedOwner.rootPath !== activeProject.rootPath) {
      setSelectedWorkspacePath(activeProject.rootPath)
      return
    }

    if (workspacesByProjectQuery.isPending) {
      return
    }

    const availableItems = activeWorkspaces

    if (availableItems.length === 0) {
      setSelectedWorkspacePath(null)
      return
    }

    const stillExists =
      availableItems.some((item) => item.path === selectedWorkspacePath) ||
      tabs.some((tab) => tab.workspacePath === selectedWorkspacePath)
    if (!stillExists) {
      setSelectedWorkspacePath(availableItems[0].path)
    }
  }, [
    activeProject,
    activeWorkspaces,
    appConfigQuery.data?.projects,
    selectProjectMutation.isPending,
    selectedWorkspacePath,
    setSelectedWorkspacePath,
    tabs,
    workspacesByProjectQuery.isPending
  ])

  useEffect(() => {
    if (!selectedWorkspacePath) {
      return
    }

    const hasTabsForWorkspace = terminalTabs.some((tab) => tab.workspacePath === selectedWorkspacePath)
    if (!hasTabsForWorkspace) {
      const tab = createTab(selectedWorkspacePath, defaultTabCommand)
      setTabs((current) => [...current, tab])
      setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
    }
  }, [defaultTabCommand, selectedWorkspacePath, terminalTabs])

  useEffect(() => {
    const bridge = getElectronBridge()
    const off = bridge.terminal.onProcessChange((event) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.kind === 'terminal' && tab.sessionId === event.sessionId
            ? {
                ...tab,
                processName: event.processName,
                processAgent: event.processAgent,
                processState: event.processState
              }
            : tab
        )
      )
    })
    return off
  }, [])

  // Close worktree menu on outside click
  useEffect(() => {
    if (!worktreeMenuProjectPath) return
    const handler = (e: MouseEvent) => {
      if (worktreeMenuRef.current && !worktreeMenuRef.current.contains(e.target as Node)) {
        setWorktreeMenuProjectPath(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [worktreeMenuProjectPath])

  const [claudeSessions, setClaudeSessions] = useState<ClaudeSessionInfo[]>([])
  const [codexSessions, setCodexSessions] = useState<CodexSessionInfo[]>([])
  // const [opencodeSessions, setOpencodeSessions] = useState<OpenCodeSessionInfo[]>([])
  const tabsRestoredRef = useRef(false)

  useEffect(() => {
    const bridge = getElectronBridge()
    const off = bridge.claude.onSessionChange(setClaudeSessions)
    return off
  }, [])

  useEffect(() => {
    const bridge = getElectronBridge()
    const off = bridge.codex.onSessionChange(setCodexSessions)
    return off
  }, [])

  // useEffect(() => {
  //   const bridge = getElectronBridge()
  //   const off = bridge.opencode.onSessionChange(setOpencodeSessions)
  //   return off
  // }, [])

  useEffect(() => {
    const bridge = getElectronBridge()
    void bridge.terminal.getMouseMode().then(setMouseMode)
    const off = bridge.terminal.onMouseModeChanged(setMouseMode)
    return off
  }, [])

  // Restore persisted tabs on startup.
  useEffect(() => {
    if (tabsRestoredRef.current) return
    tabsRestoredRef.current = true

    const bridge = getElectronBridge()
    void (async () => {
      const [persisted, aliveSessions] = await Promise.all([
        bridge.terminal.getPersistedTabs(),
        bridge.terminal.listTmuxSessions()
      ])

      const aliveSet = new Set(aliveSessions)
      const validTabs = persisted.tabs.filter((t) => aliveSet.has(t.tmuxSessionName))
      const nextActiveTabId = buildValidActiveTabId(validTabs, persisted.activeTabId)

      if (validTabs.length > 0) {
        const restoredTabs = validTabs.map(createRestoredTab)
        tabsRef.current = restoredTabs
        activeTabIdRef.current = nextActiveTabId
        setTabs(restoredTabs)
        setActiveTabId(nextActiveTabId)
      }
    })()
  }, [])

  // Persist tabs whenever they change.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!tabsRestoredRef.current) return
    const persistable = terminalTabs.filter((t) => t.tmuxSessionName)
    if (persistable.length === 0 && tabs.length > 0) return

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      void getElectronBridge().terminal.persistTabs({
        tabs: persistable.map((t) => ({
          id: t.id,
          workspacePath: t.workspacePath,
          tmuxSessionName: t.tmuxSessionName!
        })),
        activeTabId
      })
    }, 500)
  }, [tabs, terminalTabs, activeTabId])

  const handleSessionCreated = useCallback(
    (tabId: string, sessionId: string, pid: number, tmuxSessionName: string) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.kind === 'terminal' && tab.id === tabId
            ? { ...tab, sessionId, pid, tmuxSessionName }
            : tab
        )
      )
    },
    []
  )

  const currentTabs = useMemo(
    () => (selectedWorkspacePath ? tabs.filter((tab) => tab.workspacePath === selectedWorkspacePath) : []),
    [tabs, selectedWorkspacePath]
  )

  const currentActiveTabId = selectedWorkspacePath ? activeTabId[selectedWorkspacePath] ?? null : null

  const currentActiveTab = useMemo(
    () => currentTabs.find((tab) => tab.id === currentActiveTabId) ?? null,
    [currentTabs, currentActiveTabId]
  )

  const groupedAgents = useMemo(() => {
    const projects = appConfigQuery.data?.projects ?? []
    const workspacesByProject = workspacesByProjectQuery.data ?? {}

    // Index tabs by workspace, preserving terminalTabs order within each workspace
    // so drag-to-reorder keeps working inside a worktree.
    const tabsByWorkspace = new Map<string, TerminalTab[]>()
    const ownerProjectForTab = new Map<string, Project | null>()
    for (const tab of terminalTabs) {
      if (!tabsByWorkspace.has(tab.workspacePath)) tabsByWorkspace.set(tab.workspacePath, [])
      tabsByWorkspace.get(tab.workspacePath)!.push(tab)
      ownerProjectForTab.set(tab.id, findOwnerProject(projects, tab.workspacePath))
    }

    type WorktreeGroup = { path: string; label: string; isWorktree: boolean; wsData: WorkspaceItem | null; tabs: TerminalTab[] }

    const groups: {
      project: Project | null
      projectPath: string
      worktrees: WorktreeGroup[]
    }[] = []

    const consumedWorkspaces = new Set<string>()

    // Iterate projects in configured order (stable), then workspaces in the order
    // returned by git (stable: main first, then worktrees).
    for (const project of projects) {
      const projectWorkspaces = workspacesByProject[project.rootPath] ?? []
      const worktreeGroups: WorktreeGroup[] = []

      for (const wsData of projectWorkspaces) {
        const wsTabs = tabsByWorkspace.get(wsData.path)
        if (!wsTabs || wsTabs.length === 0) continue
        consumedWorkspaces.add(wsData.path)
        const label = wsData.branch ?? (wsData.isMain ? 'main' : wsData.name)
        const isWorktree = wsData.kind === 'worktree' && !wsData.isMain
        worktreeGroups.push({ path: wsData.path, label, isWorktree, wsData, tabs: wsTabs })
      }

      // Fallback: tabs whose workspace belongs to this project but isn't in the
      // workspaces list (e.g., deleted worktree still has live tabs). Sort by
      // path so the fallback order is also stable.
      const unresolvedPaths: string[] = []
      for (const tab of terminalTabs) {
        if (ownerProjectForTab.get(tab.id)?.rootPath !== project.rootPath) continue
        if (consumedWorkspaces.has(tab.workspacePath)) continue
        if (!unresolvedPaths.includes(tab.workspacePath)) unresolvedPaths.push(tab.workspacePath)
      }
      unresolvedPaths.sort()
      for (const wsPath of unresolvedPaths) {
        consumedWorkspaces.add(wsPath)
        const label = wsPath === project.rootPath ? 'main' : wsPath.split('/').pop() ?? 'workspace'
        worktreeGroups.push({ path: wsPath, label, isWorktree: false, wsData: null, tabs: tabsByWorkspace.get(wsPath)! })
      }

      if (worktreeGroups.length === 0) continue
      groups.push({ project, projectPath: project.rootPath, worktrees: worktreeGroups })
    }

    // Orphan tabs (no owning project). Grouped by workspace, sorted by path.
    const orphanPaths: string[] = []
    for (const tab of terminalTabs) {
      if (ownerProjectForTab.get(tab.id) !== null) continue
      if (consumedWorkspaces.has(tab.workspacePath)) continue
      if (!orphanPaths.includes(tab.workspacePath)) orphanPaths.push(tab.workspacePath)
    }
    if (orphanPaths.length > 0) {
      orphanPaths.sort()
      const worktreeGroups: WorktreeGroup[] = orphanPaths.map((wsPath) => ({
        path: wsPath,
        label: wsPath.split('/').pop() ?? 'workspace',
        isWorktree: false,
        wsData: null,
        tabs: tabsByWorkspace.get(wsPath)!
      }))
      groups.push({ project: null, projectPath: '__orphan__', worktrees: worktreeGroups })
    }

    return groups
  }, [terminalTabs, appConfigQuery.data?.projects, workspacesByProjectQuery.data])

  const worktreeMenuItems = worktreeMenuProjectPath
    ? (workspacesByProjectQuery.data?.[worktreeMenuProjectPath] ?? [])
    : []

  const handleToggleMouse = useCallback(() => {
    void getElectronBridge().terminal.toggleMouse()
  }, [])

  const handleDeleteOrphanTabs = useCallback(() => {
    const projects = appConfigQuery.data?.projects ?? []
    const orphanTabs = tabsRef.current.filter(
      (tab): tab is TerminalTab => tab.kind === 'terminal' && !findOwnerProject(projects, tab.workspacePath)
    )

    if (orphanTabs.length === 0) return

    const label = orphanTabs.length === 1 ? '1 orphan agent' : `${orphanTabs.length} orphan agents`
    if (
      !window.confirm(
        `Remove ${label}.\n\nTheir terminals will close and they will disappear from the sidebar.`
      )
    ) {
      return
    }

    const bridge = getElectronBridge()
    const orphanTabIds = new Set(
      orphanTabs.map((tab) => {
        if (tab.tmuxSessionName) void bridge.terminal.destroySession(tab.tmuxSessionName)
        return tab.id
      })
    )

    commitTabState(tabsRef.current.filter((tab) => !orphanTabIds.has(tab.id)))
  }, [appConfigQuery.data?.projects, commitTabState])

  const handleNewTab = useCallback(() => {
    if (!selectedWorkspacePath) return
    const tab = createTab(selectedWorkspacePath, defaultTabCommand)
    setTabs((current) => [...current, tab])
    setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
  }, [defaultTabCommand, selectedWorkspacePath])

  const handleNewTabInMain = useCallback(() => {
    if (!activeProject) return
    focusWorkspace(activeProject.rootPath, {
      createNewTab: true,
      projectPath: activeProject.rootPath
    })
  }, [activeProject, focusWorkspace])

  const handleOpenProjectMain = useCallback((project: Project | null, createNewTab = false) => {
    if (!project) return
    focusWorkspace(project.rootPath, {
      createNewTab,
      projectPath: project.rootPath
    })
    setWorktreeMenuProjectPath(null)
  }, [focusWorkspace])

  const handleNavigateToWorktree = useCallback((projectPath: string, worktreePath: string) => {
    focusWorkspace(worktreePath, { projectPath })
    setWorktreeMenuProjectPath(null)
  }, [focusWorkspace])

  const handleCheckoutMain = useCallback(async (project: Project | null) => {
    if (!project) return
    setWorktreeMenuProjectPath(null)
    await checkoutMainMutation.mutateAsync(project.rootPath)
  }, [checkoutMainMutation])

  const handleNewClaudeTab = useCallback(() => {
    if (!selectedWorkspacePath) return
    const tab = createTab(selectedWorkspacePath, 'claude --dangerously-skip-permissions')
    setTabs((current) => [...current, tab])
    setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
  }, [selectedWorkspacePath])

  const handleSelectTab = useCallback(
    (tab: TerminalTab) => {
      const projects = appConfigQuery.data?.projects ?? []
      const ownerProject = findOwnerProject(projects, tab.workspacePath)
      if (ownerProject && ownerProject.rootPath !== activeProject?.rootPath) {
        selectProjectMutation.mutate(ownerProject.rootPath)
      }
      setSelectedWorkspacePath(tab.workspacePath)
      setActiveTabId((current) => ({ ...current, [tab.workspacePath]: tab.id }))
    },
    [appConfigQuery.data, activeProject, selectProjectMutation, setSelectedWorkspacePath]
  )

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setTabs((current) => {
      const from = current.findIndex((t) => t.id === active.id)
      const to = current.findIndex((t) => t.id === over.id)
      if (from === -1 || to === -1) return current
      const next = current.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  const handleSwitchTab = useCallback(
    (index: number) => {
      if (!selectedWorkspacePath) return
      const workspaceTabs = tabs.filter((tab) => tab.workspacePath === selectedWorkspacePath)
      const tab = workspaceTabs[index]
      if (tab) {
        setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
      }
    },
    [selectedWorkspacePath, tabs]
  )

  const handleKillAgent = useCallback(
    (tabId: string) => {
      const target = tabsRef.current.find(
        (tab): tab is TerminalTab => tab.kind === 'terminal' && tab.id === tabId
      )
      if (!target) return

      if (target.tmuxSessionName) {
        void getElectronBridge().terminal.destroySession(target.tmuxSessionName)
      }

      commitTabState(tabsRef.current.filter((tab) => tab.id !== tabId))
    },
    [commitTabState]
  )

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (!selectedWorkspacePath) return

      const workspaceTabs = tabs.filter((tab) => tab.workspacePath === selectedWorkspacePath)
      const closingTab = workspaceTabs.find((tab) => tab.id === tabId)
      if (!closingTab) return

      const workspaceTerminalTabs = workspaceTabs.filter(
        (tab): tab is TerminalTab => tab.kind === 'terminal'
      )
      if (closingTab.kind === 'terminal' && workspaceTerminalTabs.length <= 1) return

      const closingIndex = workspaceTabs.findIndex((tab) => tab.id === tabId)

      // Kill the tmux session — the user intentionally closed the tab.
      if (closingTab.kind === 'terminal' && closingTab.tmuxSessionName) {
        void getElectronBridge().terminal.destroySession(closingTab.tmuxSessionName)
      }

      setTabs((current) => current.filter((tab) => tab.id !== tabId))
      if (closingTab.kind === 'editor') {
        setEditorDocuments((current) => {
          const next = { ...current }
          delete next[closingTab.filePath]
          return next
        })
      } else if (closingTab.kind === 'git-diff') {
        setDiffDocuments((current) => {
          const next = { ...current }
          delete next[closingTab.filePath]
          return next
        })
      }

      if (currentActiveTabId === tabId) {
        const nextTab = workspaceTabs[closingIndex + 1] ?? workspaceTabs[closingIndex - 1]
        if (nextTab) {
          setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: nextTab.id }))
        }
      }
    },
    [selectedWorkspacePath, tabs, currentActiveTabId]
  )

  const loadEditorFile = useCallback(async (workspacePath: string, filePath: string) => {
    setEditorDocuments((current) => ({
      ...current,
      [filePath]: {
        value: current[filePath]?.value ?? '',
        savedValue: current[filePath]?.savedValue ?? '',
        isLoading: true,
        isSaving: false,
        errorMessage: null
      }
    }))

    try {
      const result = await getElectronBridge().files.readTextFile({
        cwd: workspacePath,
        filePath
      })

      setEditorDocuments((current) => ({
        ...current,
        [filePath]: {
          value: result.content,
          savedValue: result.content,
          isLoading: false,
          isSaving: false,
          errorMessage: null
        }
      }))
    } catch (error) {
      setEditorDocuments((current) => ({
        ...current,
        [filePath]: {
          value: current[filePath]?.value ?? '',
          savedValue: current[filePath]?.savedValue ?? '',
          isLoading: false,
          isSaving: false,
          errorMessage: getErrorMessage(error)
        }
      }))
    }
  }, [])

  const loadDiffFile = useCallback(async (workspacePath: string, filePath: string) => {
    setDiffDocuments((current) => ({
      ...current,
      [filePath]: {
        originalValue: current[filePath]?.originalValue ?? '',
        modifiedValue: current[filePath]?.modifiedValue ?? '',
        status: current[filePath]?.status ?? 'modified',
        isLoading: true,
        errorMessage: null
      }
    }))

    try {
      const result = await getElectronBridge().files.getGitDiff({
        cwd: workspacePath,
        filePath
      })

      setDiffDocuments((current) => ({
        ...current,
        [filePath]: {
          originalValue: result.originalContent,
          modifiedValue: result.modifiedContent,
          status: result.status,
          isLoading: false,
          errorMessage: null
        }
      }))
    } catch (error) {
      setDiffDocuments((current) => ({
        ...current,
        [filePath]: {
          originalValue: current[filePath]?.originalValue ?? '',
          modifiedValue: current[filePath]?.modifiedValue ?? '',
          status: current[filePath]?.status ?? 'modified',
          isLoading: false,
          errorMessage: getErrorMessage(error)
        }
      }))
    }
  }, [])

  const handleSelectFile = useCallback(
    (filePath: string) => {
      if (!selectedWorkspacePath) return

      const existingTab = tabsRef.current.find(
        (tab): tab is EditorTab =>
          tab.kind === 'editor' &&
          tab.workspacePath === selectedWorkspacePath &&
          tab.filePath === filePath
      )

      if (existingTab) {
        setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: existingTab.id }))
        return
      }

      const nextTab = createEditorTab(selectedWorkspacePath, filePath)
      setTabs((current) => [...current, nextTab])
      setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: nextTab.id }))
      void loadEditorFile(selectedWorkspacePath, filePath)
    },
    [loadEditorFile, selectedWorkspacePath]
  )

  const handleSelectGitFile = useCallback(
    (filePath: string) => {
      if (!selectedWorkspacePath) return

      const existingTab = tabsRef.current.find(
        (tab): tab is DiffTab =>
          tab.kind === 'git-diff' &&
          tab.workspacePath === selectedWorkspacePath &&
          tab.filePath === filePath
      )

      if (existingTab) {
        setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: existingTab.id }))
        return
      }

      const nextTab = createDiffTab(selectedWorkspacePath, filePath)
      setTabs((current) => [...current, nextTab])
      setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: nextTab.id }))
      void loadDiffFile(selectedWorkspacePath, filePath)
    },
    [loadDiffFile, selectedWorkspacePath]
  )

  const handleEditorChange = useCallback((filePath: string, value: string) => {
    setEditorDocuments((current) => {
      const existing = current[filePath]
      if (!existing) return current

      return {
        ...current,
        [filePath]: {
          ...existing,
          value
        }
      }
    })
  }, [])

  const handleSaveEditor = useCallback(async (workspacePath: string, filePath: string) => {
    const documentState = editorDocuments[filePath]
    if (!documentState || documentState.isLoading || documentState.isSaving) return

    setEditorDocuments((current) => ({
      ...current,
      [filePath]: {
        ...current[filePath],
        isSaving: true,
        errorMessage: null
      }
    }))

    try {
      await getElectronBridge().files.writeTextFile({
        cwd: workspacePath,
        filePath,
        content: documentState.value
      })

      setEditorDocuments((current) => ({
        ...current,
        [filePath]: {
          ...current[filePath],
          savedValue: current[filePath].value,
          isSaving: false,
          errorMessage: null
        }
      }))
      queryClient.invalidateQueries({ queryKey: ['files'] })
      void loadDiffFile(workspacePath, filePath).catch(() => {})
    } catch (error) {
      setEditorDocuments((current) => ({
        ...current,
        [filePath]: {
          ...current[filePath],
          isSaving: false,
          errorMessage: getErrorMessage(error)
        }
      }))
    }
  }, [editorDocuments, loadDiffFile, queryClient])

  const handleReloadEditor = useCallback((workspacePath: string, filePath: string) => {
    void loadEditorFile(workspacePath, filePath)
  }, [loadEditorFile])

  const handleReloadDiff = useCallback((workspacePath: string, filePath: string) => {
    void loadDiffFile(workspacePath, filePath)
  }, [loadDiffFile])

  const selectedWorkspace = useMemo(
    () => activeWorkspaces.find((item) => item.path === selectedWorkspacePath) ?? null,
    [activeWorkspaces, selectedWorkspacePath]
  )

  const selectedWorkspaceLabel = useMemo(() => {
    if (selectedWorkspace) {
      return (
        selectedWorkspace.branch ??
        (selectedWorkspace.isMain ? 'main' : selectedWorkspace.name)
      )
    }
    if (activeProject && selectedWorkspacePath === activeProject.rootPath) {
      return 'main'
    }
    if (selectedWorkspacePath) {
      return selectedWorkspacePath.split('/').pop() ?? null
    }
    return null
  }, [activeProject, selectedWorkspace, selectedWorkspacePath])

  const selectedFilePath =
    currentActiveTab && currentActiveTab.kind === 'editor' ? currentActiveTab.filePath : null
  const selectedGitFilePath =
    currentActiveTab && currentActiveTab.kind === 'git-diff' ? currentActiveTab.filePath : null

  const draftWorktreeProject = useMemo(
    () =>
      appConfigQuery.data?.projects.find((project) => project.rootPath === draftWorktreeProjectPath) ??
      null,
    [appConfigQuery.data?.projects, draftWorktreeProjectPath]
  )
  const configErrorMessage = appConfigQuery.isError
    ? getErrorMessage(appConfigQuery.error)
    : pickProjectMutation.isError
      ? getErrorMessage(pickProjectMutation.error)
      : selectProjectMutation.isError
        ? getErrorMessage(selectProjectMutation.error)
        : removeProjectMutation.isError
          ? getErrorMessage(removeProjectMutation.error)
          : null

  const worktreeErrorMessage = workspacesByProjectQuery.isError
    ? getErrorMessage(workspacesByProjectQuery.error)
    : createWorktreeMutation.isError
      ? getErrorMessage(createWorktreeMutation.error)
      : removeWorktreeMutation.isError
        ? getErrorMessage(removeWorktreeMutation.error)
        : checkoutMainMutation.isError
          ? getErrorMessage(checkoutMainMutation.error)
          : null


  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['app-config'] })
    queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    queryClient.invalidateQueries({ queryKey: ['files'] })
  }

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open)
  }, [])

  useEffect(() => {
    window.localStorage.setItem('electree:sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  const handleSidebarResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const next = Math.min(Math.max(startWidth + (moveEvent.clientX - startX), 200), 800)
      setSidebarWidth(next)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  const quickOpenCommands = useMemo<CommandItem[]>(
    () =>
      (quickOpenFilesQuery.data ?? []).map((filePath) => ({
        id: `open:${filePath}`,
        label: filePath,
        icon: <VscFile className="size-4" />,
        onSelect: () => handleSelectFile(filePath)
      })),
    [handleSelectFile, quickOpenFilesQuery.data]
  )

  const quickOpenFilter = useCallback((command: CommandItem, query: string) => {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return true

    try {
      return new RegExp(trimmedQuery, 'i').test(command.label)
    } catch {
      return command.label.toLowerCase().includes(trimmedQuery.toLowerCase())
    }
  }, [])

  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: 'new-tab',
        label: 'New Terminal',
        shortcut: '⌘T',
        icon: <VscAdd className="size-4" />,
        onSelect: () => handleNewTab()
      },
      {
        id: 'new-claude-tab',
        label: 'New Claude (skip permissions)',
        shortcut: '⌘⇧C',
        icon: <span className="text-[10px] font-bold">C</span>,
        onSelect: () => handleNewClaudeTab()
      },
      {
        id: 'close-tab',
        label: 'Close Tab',
        shortcut: '⌘W',
        icon: <VscClose className="size-4" />,
        onSelect: () => {
          if (currentActiveTabId) handleCloseTab(currentActiveTabId)
        }
      },
      {
        id: 'settings',
        label: 'Settings',
        shortcut: '⌘,',
        icon: <VscSettingsGear className="size-4" />,
        onSelect: () => setSettingsOpen(true)
      },
      {
        id: 'refresh',
        label: 'Refresh',
        shortcut: '⌘R',
        icon: <VscRefresh className="size-4" />,
        onSelect: handleRefresh
      },
      ...(currentActiveTab?.kind === 'editor'
        ? [
            {
              id: 'save-file',
              label: 'Save File',
              shortcut: '⌘S',
              icon: <VscCheck className="size-4" />,
              onSelect: () => void handleSaveEditor(currentActiveTab.workspacePath, currentActiveTab.filePath)
            } satisfies CommandItem
          ]
        : []),
      {
        id: 'toggle-sidebar',
        label: sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
        shortcut: '⌘B',
        icon: sidebarOpen ? <VscLayoutSidebarLeftOff className="size-4" /> : <VscLayoutSidebarLeft className="size-4" />,
        onSelect: toggleSidebar
      },
      {
        id: 'new-worktree',
        label: 'Create worktree',
        icon: <VscSourceControl className="size-4" />,
        onSelect: () => {
          if (draftWorktreeName !== null) {
            setDraftWorktreeName(null)
            setDraftWorktreeProjectPath(null)
            return
          }

          setDraftWorktreeProjectPath(activeProject?.rootPath ?? null)
          setDraftWorktreeName(generateRandomWorktreeName())
        }
      },
      {
        id: 'new-tab-main',
        label: 'Open terminal in main',
        icon: <VscTerminalBash className="size-4" />,
        onSelect: handleNewTabInMain
      },
      {
        id: 'open-folder',
        label: 'Open folder',
        icon: <VscFolderOpened className="size-4" />,
        onSelect: () => void pickProjectMutation.mutateAsync()
      },
      {
        id: 'quick-open',
        label: 'Quick open file',
        shortcut: '⌘P',
        icon: <VscFile className="size-4" />,
        onSelect: () => {
          setCommandPaletteOpen(false)
          setQuickOpenOpen(true)
        }
      },
      {
        id: 'toggle-mouse',
        label: mouseMode ? 'Disable tmux mouse mode' : 'Enable tmux mouse mode',
        shortcut: '⌘M',
        onSelect: () => handleToggleMouse()
      }
    ],
    [
      activeProject?.rootPath,
      currentActiveTab,
      currentActiveTabId,
      draftWorktreeName,
      handleCloseTab,
      handleNewClaudeTab,
      handleNewTab,
      handleNewTabInMain,
      handleRefresh,
      handleSaveEditor,
      handleToggleMouse,
      mouseMode,
      pickProjectMutation,
      sidebarOpen,
      toggleSidebar
    ]
  )

  useHotkeys(
    [
      {
        hotkey: 'Mod+T',
        callback: () => handleNewTab()
      },
      {
        hotkey: 'Mod+W',
        callback: () => {
          if (currentActiveTabId) handleCloseTab(currentActiveTabId)
        }
      },
      {
        hotkey: 'Mod+S',
        callback: () => {
          if (currentActiveTab?.kind === 'editor') {
            void handleSaveEditor(currentActiveTab.workspacePath, currentActiveTab.filePath)
          }
        }
      },
      {
        hotkey: 'Mod+K',
        callback: () => {
          setQuickOpenOpen(false)
          setCommandPaletteOpen((open) => !open)
        }
      },
      {
        hotkey: 'Mod+P',
        callback: () => {
          setCommandPaletteOpen(false)
          setQuickOpenOpen((open) => !open)
        }
      },
      {
        hotkey: 'Mod+B',
        callback: () => toggleSidebar()
      },
      {
        hotkey: 'Mod+Shift+C',
        callback: () => handleNewClaudeTab()
      },
      { hotkey: 'Mod+1', callback: () => handleSwitchTab(0) },
      { hotkey: 'Mod+2', callback: () => handleSwitchTab(1) },
      { hotkey: 'Mod+3', callback: () => handleSwitchTab(2) },
      { hotkey: 'Mod+4', callback: () => handleSwitchTab(3) },
      { hotkey: 'Mod+5', callback: () => handleSwitchTab(4) },
      { hotkey: 'Mod+6', callback: () => handleSwitchTab(5) },
      { hotkey: 'Mod+7', callback: () => handleSwitchTab(6) },
      { hotkey: 'Mod+8', callback: () => handleSwitchTab(7) },
      { hotkey: 'Mod+9', callback: () => handleSwitchTab(8) },
      { hotkey: 'Mod+M', callback: () => handleToggleMouse() }
    ],
    { preventDefault: true }
  )

  const handleCreateWorktree = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draftWorktreeName) return
    await createWorktreeMutation.mutateAsync({
      name: draftWorktreeName,
      projectPath: draftWorktreeProjectPath ?? activeProject?.rootPath ?? null
    })
  }

  const handleDeleteProject = async (project: Project) => {
    if (!window.confirm(`Remove ${project.name} from the list of projects.`)) {
      return
    }

    await removeProjectMutation.mutateAsync(project)
  }

  const handleDeleteWorktree = async (workspace: WorkspaceItem, projectPath: string) => {
    const targetName = workspace.branch ?? workspace.name
    const branchWarning = workspace.branch
      ? `The local branch ${workspace.branch} will also be deleted.`
      : 'The worktree folder will be deleted.'

    if (
      !window.confirm(
        `Delete ${targetName}.\n\n${branchWarning}\nAny uncommitted changes inside this worktree will be lost.`
      )
    ) {
      return
    }

    await removeWorktreeMutation.mutateAsync({
      workspacePath: workspace.path,
      projectPath
    })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex h-screen overflow-hidden">
        <aside
          style={sidebarOpen ? { width: sidebarWidth } : undefined}
          className={cn('relative flex shrink-0 flex-col overflow-hidden bg-sidebar', sidebarOpen ? 'border-r' : 'w-0 border-r-0')}
        >
          {/* Drag region for macOS traffic lights */}
          <div className="drag-region h-11 shrink-0 border-b pl-[78px]">
            <div className="no-drag flex h-full items-center gap-1 px-2">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRefresh}
                aria-label="Refresh"
                title="Refresh"
              >
                <VscRefresh className="size-4" />
              </Button>

              <div className="flex-1" />

              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
              >
                <VscSettingsGear className="size-4" />
              </Button>
            </div>
          </div>

          {configErrorMessage ? (
            <div className="border-b border-red-500/10 bg-red-500/[0.06] px-4 py-2.5 text-xs text-error">
              {configErrorMessage}
            </div>
          ) : null}

          {worktreeErrorMessage ? (
            <div className="border-b border-red-500/10 bg-red-500/[0.06] px-4 py-2.5 text-xs text-error">
              {worktreeErrorMessage}
            </div>
          ) : null}

          {draftWorktreeName !== null && draftWorktreeProject?.mode === 'git' ? (
            <div className="border-b px-3 py-3">
              <form className="flex items-center gap-2" onSubmit={handleCreateWorktree}>
                <Input
                  value={draftWorktreeName}
                  onChange={(event) => setDraftWorktreeName(event.target.value)}
                  placeholder="feature/new-worktree"
                  className="h-9 rounded-lg text-sm"
                  disabled={createWorktreeMutation.isPending}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={createWorktreeMutation.isPending || !draftWorktreeName.trim()}
                >
                  <VscCheck className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setDraftWorktreeName(null)
                    setDraftWorktreeProjectPath(null)
                  }}
                >
                  <VscClose className="size-3.5" />
                </Button>
              </form>
            </div>
          ) : null}

          <div className="flex h-9 shrink-0 items-center border-b">
            <button
              type="button"
              onClick={() => setAgentsCollapsed((c) => !c)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-4 text-sm uppercase tracking-[0.18em] text-muted hover:text-secondary"
            >
              {agentsCollapsed ? (
                <VscChevronRight className="size-3.5" />
              ) : (
                <VscChevronDown className="size-3.5" />
              )}
              Agents
              <span className="ml-1 font-mono text-sm normal-case tracking-normal text-muted">
                {terminalTabs.length}
              </span>
            </button>

            <Button
              size="icon"
              variant="ghost"
              className="size-7 rounded-md"
              onClick={() => setAgentsCompact((c) => !c)}
              aria-label={agentsCompact ? 'Tree view' : 'Compact view'}
              title={agentsCompact ? 'Tree view' : 'Compact view'}
            >
              {agentsCompact ? (
                <VscListTree className="size-4" />
              ) : (
                <VscListFlat className="size-4" />
              )}
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="mr-2 size-7 rounded-md"
              onClick={() => void pickProjectMutation.mutateAsync()}
              aria-label="Open folder"
              title="Open folder"
            >
              <VscFolderOpened className="size-4" />
            </Button>
          </div>

          {!agentsCollapsed ? (
            <ScrollArea className="min-h-0 min-w-0 flex-1">
              <div className="overflow-hidden px-2 py-2">
                {terminalTabs.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted">Sin agentes activos</div>
                ) : null}

                {agentsCompact ? (
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={terminalTabs.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col">
                    {groupedAgents.flatMap((group) =>
                      group.worktrees.flatMap((wt) =>
                        wt.tabs.map((tab) => {
                          const tabAgent = getTerminalAgent(tab, claudeSessions, codexSessions)
                          const isAgent = tabAgent.agent !== null
                          const isActive =
                            selectedWorkspacePath === tab.workspacePath &&
                            activeTabId[tab.workspacePath] === tab.id
                          const defaultLabel = isAgent
                            ? (tabAgent.info?.name ?? tabAgent.prompt ?? getAgentDisplayName(tabAgent.agent!))
                            : 'Terminal'
                          const label = customTabNames[tab.id] || defaultLabel
                          const projectName = group.project?.name ?? 'Unknown'
                          return (
                            <SortableTabButton
                              key={tab.id}
                              id={tab.id}
                              onClick={() => handleSelectTab(tab)}
                              className={cn(
                                'group flex w-full min-w-0 cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm active:cursor-grabbing',
                                isActive ? 'bg-item-active text-foreground' : 'text-secondary hover:bg-item-hover'
                              )}
                            >
                              <span className="relative flex size-4 shrink-0 items-center justify-center text-icon">
                                {tabAgent.agent ? (
                                  <AgentIcon agent={tabAgent.agent} state={tabAgent.state} className="size-3" />
                                ) : (
                                  <VscTerminalBash className="size-3.5" />
                                )}
                                {tabAgent.agent && tabAgent.state ? (
                                  <span
                                    className={cn(
                                      'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-sidebar',
                                      tabAgent.state === 'active' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                                    )}
                                    title={tabAgent.state === 'active' ? 'Active' : 'Inactive'}
                                  />
                                ) : null}
                              </span>

                              <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                                <span className="text-muted">{projectName}</span>
                                <span className="text-muted">/</span>
                                <span className="text-muted">{wt.label}</span>
                                {wt.isWorktree ? (
                                  <span className="shrink-0 rounded border border-border px-1 text-[9px] font-semibold uppercase leading-[1.3] tracking-wider text-muted">
                                    WT
                                  </span>
                                ) : null}
                                <span className="text-muted">/</span>
                                <span className="truncate">{label}</span>
                              </span>

                              <span
                                role="button"
                                tabIndex={0}
                                aria-label="Kill agent"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleKillAgent(tab.id)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleKillAgent(tab.id)
                                  }
                                }}
                                className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-icon opacity-0 hover:bg-item-hover hover:text-foreground group-hover:opacity-100"
                              >
                                <VscClose className="size-3.5" />
                              </span>
                            </SortableTabButton>
                          )
                        })
                      )
                    )}
                    </div>
                    </SortableContext>
                  </DndContext>
                ) : groupedAgents.map((group) => {
                  const isProjectCollapsed = collapsedAgentProjects.has(group.projectPath)
                  return (
                  <div key={group.projectPath} className="mb-1 overflow-hidden">
                    <div className="group flex min-w-0 items-center gap-2 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedAgentProjects((prev) => {
                            const next = new Set(prev)
                            next.has(group.projectPath) ? next.delete(group.projectPath) : next.add(group.projectPath)
                            return next
                          })
                        }
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-base text-muted hover:text-secondary"
                      >
                        {isProjectCollapsed ? (
                          <VscChevronRight className="size-3.5 shrink-0" />
                        ) : (
                          <VscChevronDown className="size-3.5 shrink-0" />
                        )}
                        <VscRepo className="size-3.5 shrink-0" />
                        <span className="truncate font-medium">{group.project?.name ?? 'Unknown'}</span>
                      </button>

                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-5 shrink-0 rounded opacity-0 group-hover:opacity-100"
                        onClick={() => void handleCheckoutMain(group.project)}
                        aria-label="Checkout primary branch"
                        title="Checkout primary branch"
                      >
                        <VscTerminalBash className="size-3.5" />
                      </Button>

                      {group.project?.mode === 'git' ? (
                        <div className="relative" ref={worktreeMenuProjectPath === group.projectPath ? worktreeMenuRef : undefined}>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-5 shrink-0 rounded opacity-0 group-hover:opacity-100"
                            onClick={() => setWorktreeMenuProjectPath((c) => c === group.projectPath ? null : group.projectPath)}
                            aria-label="Worktrees"
                            title="Worktrees"
                          >
                            <VscSourceControl className="size-3.5" />
                          </Button>
                          {worktreeMenuProjectPath === group.projectPath ? (
                            <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] max-w-[300px] rounded-md border border-border bg-sidebar py-1 shadow-lg">
                              <button
                                type="button"
                                className={cn(
                                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-item-hover',
                                  selectedWorkspacePath === group.project?.rootPath ? 'text-foreground' : 'text-secondary'
                                )}
                                onClick={() => handleOpenProjectMain(group.project)}
                              >
                                <VscTerminalBash className="size-3 shrink-0" />
                                <span className="truncate">Open terminal in main</span>
                                {selectedWorkspacePath === group.project?.rootPath ? (
                                  <VscCheck className="ml-auto size-3 shrink-0" />
                                ) : null}
                              </button>
                              <div className="mx-2 my-1 border-t border-border" />
                              {worktreeMenuItems.filter((ws) => ws.kind === 'worktree' && !ws.isMain).map((ws) => (
                                <button
                                  key={ws.path}
                                  type="button"
                                  className={cn(
                                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-item-hover',
                                    selectedWorkspacePath === ws.path ? 'text-foreground' : 'text-secondary'
                                  )}
                                  onClick={() => handleNavigateToWorktree(group.projectPath, ws.path)}
                                >
                                  <VscSourceControl className="size-3 shrink-0" />
                                  <span className="truncate">{ws.branch ?? ws.name}</span>
                                  {selectedWorkspacePath === ws.path ? (
                                    <VscCheck className="ml-auto size-3 shrink-0" />
                                  ) : null}
                                </button>
                              ))}
                              {worktreeMenuItems.some((ws) => ws.kind === 'worktree' && !ws.isMain) ? (
                                <div className="mx-2 my-1 border-t border-border" />
                              ) : null}
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-secondary hover:bg-item-hover"
                                onClick={() => {
                                  setWorktreeMenuProjectPath(null)
                                  if (draftWorktreeName !== null) {
                                    setDraftWorktreeName(null)
                                    setDraftWorktreeProjectPath(null)
                                    return
                                  }

                                  setDraftWorktreeProjectPath(group.projectPath)
                                  setDraftWorktreeName(generateRandomWorktreeName())
                                }}
                              >
                                <VscAdd className="size-3 shrink-0" />
                                <span>Create worktree</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {group.project && (appConfigQuery.data?.projects.length ?? 0) > 1 ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-5 shrink-0 rounded opacity-0 group-hover:opacity-100"
                          onClick={() => group.project && void handleDeleteProject(group.project)}
                          aria-label={`Remove project ${group.project.name}`}
                          title="Remove project"
                        >
                          <VscTrash className="size-3.5" />
                        </Button>
                      ) : null}

                      {!group.project ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-5 shrink-0 rounded opacity-0 group-hover:opacity-100"
                          onClick={() => handleDeleteOrphanTabs()}
                          aria-label="Remove orphan agents"
                          title="Remove orphan agents"
                        >
                          <VscTrash className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>

                    {!isProjectCollapsed && group.worktrees.map((wt) => {
                      const isWtCollapsed = collapsedAgentWorktrees.has(wt.path)
                      return (
                      <div key={wt.path}>
                        <div className="group flex min-w-0 items-center py-1 pl-7 pr-2">
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedAgentWorktrees((prev) => {
                                const next = new Set(prev)
                                next.has(wt.path) ? next.delete(wt.path) : next.add(wt.path)
                                return next
                              })
                            }
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-base text-muted hover:text-secondary"
                          >
                            {isWtCollapsed ? (
                              <VscChevronRight className="size-3 shrink-0" />
                            ) : (
                              <VscChevronDown className="size-3 shrink-0" />
                            )}
                            <VscSourceControl className="size-3 shrink-0" />
                            <span className="truncate">{wt.label}</span>
                            {wt.isWorktree ? (
                              <span className="shrink-0 rounded border border-border px-1 text-[9px] font-semibold uppercase leading-[1.3] tracking-wider text-muted">
                                WT
                              </span>
                            ) : null}
                          </button>

                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-5 shrink-0 rounded opacity-0 group-hover:opacity-100"
                            onClick={() =>
                              focusWorkspace(wt.path, {
                                createNewTab: true,
                                projectPath: group.project?.rootPath ?? null
                              })
                            }
                            aria-label="New agent"
                            title="New agent"
                          >
                            <VscAdd className="size-3.5" />
                          </Button>

                          {wt.wsData && wt.isWorktree ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-5 shrink-0 rounded text-muted hover:text-destructive"
                                onClick={() => group.project && void handleDeleteWorktree(wt.wsData!, group.project.rootPath)}
                                aria-label={`Delete worktree ${wt.label}`}
                                title="Delete worktree"
                              >
                                <VscTrash className="size-3.5" />
                              </Button>
                          ) : null}
                        </div>

                        {!isWtCollapsed && (
                          <DndContext key={wt.path} sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={wt.tabs.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        {wt.tabs.map((tab) => {
                          const tabAgent = getTerminalAgent(tab, claudeSessions, codexSessions)
                          const isAgent = tabAgent.agent !== null
                          const isActive =
                            selectedWorkspacePath === tab.workspacePath &&
                            activeTabId[tab.workspacePath] === tab.id
                          const defaultLabel = isAgent
                            ? (tabAgent.info?.name ?? tabAgent.prompt ?? getAgentDisplayName(tabAgent.agent!))
                            : 'Terminal'
                          const label = customTabNames[tab.id] || defaultLabel

                          return (
                            <SortableTabButton
                              key={tab.id}
                              id={tab.id}
                              onClick={() => handleSelectTab(tab)}
                              className={cn(
                                'group flex w-full min-w-0 cursor-grab items-center gap-2 rounded-md py-1.5 pl-[52px] pr-2 text-left text-base active:cursor-grabbing',
                                isActive ? 'bg-item-active text-foreground' : 'text-secondary hover:bg-item-hover'
                              )}
                            >
                              <span className="relative flex size-4 shrink-0 items-center justify-center text-icon">
                                {tabAgent.agent ? (
                                  <AgentIcon agent={tabAgent.agent} state={tabAgent.state} className="size-3" />
                                ) : (
                                  <VscTerminalBash className="size-3.5" />
                                )}
                                {tabAgent.agent && tabAgent.state ? (
                                  <span
                                    className={cn(
                                      'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-sidebar',
                                      tabAgent.state === 'active' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                                    )}
                                    title={tabAgent.state === 'active' ? 'Active' : 'Inactive'}
                                  />
                                ) : null}
                              </span>

                              {editingTabId === tab.id ? (
                                <input
                                  autoFocus
                                  className="min-w-0 rounded border border-border bg-transparent px-1 text-sm text-foreground outline-none"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    e.stopPropagation()
                                    if (e.key === 'Enter') {
                                      const trimmed = editingValue.trim()
                                      if (trimmed) {
                                        setCustomTabNames((prev) => ({ ...prev, [tab.id]: trimmed }))
                                      } else {
                                        setCustomTabNames((prev) => {
                                          const next = { ...prev }
                                          delete next[tab.id]
                                          return next
                                        })
                                      }
                                      setEditingTabId(null)
                                    } else if (e.key === 'Escape') {
                                      setEditingTabId(null)
                                    }
                                  }}
                                  onBlur={() => {
                                    const trimmed = editingValue.trim()
                                    if (trimmed) {
                                      setCustomTabNames((prev) => ({ ...prev, [tab.id]: trimmed }))
                                    } else {
                                      setCustomTabNames((prev) => {
                                        const next = { ...prev }
                                        delete next[tab.id]
                                        return next
                                      })
                                    }
                                    setEditingTabId(null)
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <span
                                  className="min-w-0 truncate text-base"
                                  onDoubleClick={(e) => {
                                    e.stopPropagation()
                                    setEditingTabId(tab.id)
                                    setEditingValue(customTabNames[tab.id] || '')
                                  }}
                                >
                                  {label}
                                </span>
                              )}

                              <span
                                role="button"
                                tabIndex={0}
                                aria-label="Kill agent"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleKillAgent(tab.id)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleKillAgent(tab.id)
                                  }
                                }}
                                className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-icon opacity-0 hover:bg-item-hover hover:text-foreground group-hover:opacity-100"
                              >
                                <VscClose className="size-3.5" />
                              </span>
                            </SortableTabButton>
                          )
                        })}
                            </SortableContext>
                          </DndContext>
                        )}
                      </div>
                      )
                    })}
                  </div>
                  )
                })}
              </div>
            </ScrollArea>
          ) : null}

          <FileExplorer
            workspacePath={selectedWorkspacePath}
            collapsed={filesCollapsed}
            onToggleCollapsed={() => setFilesCollapsed((c) => !c)}
            selectedFilePath={selectedFilePath}
            onSelectFile={handleSelectFile}
          />
          <GitPanel
            collapsed={gitCollapsed}
            entries={selectedGitStatusQuery.data ?? []}
            selectedFilePath={selectedGitFilePath}
            projectName={activeProject?.name ?? null}
            workspaceLabel={selectedWorkspaceLabel}
            onToggleCollapsed={() => setGitCollapsed((c) => !c)}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['files', 'git-status', selectedWorkspacePath] })}
            onSelectFile={handleSelectGitFile}
          />

          {sidebarOpen ? (
            <div
              onMouseDown={handleSidebarResizeStart}
              className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize bg-transparent hover:bg-item-active"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
            />
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-surface">
          <div className="drag-region flex h-11 shrink-0 items-center border-b">
            <div className={cn('flex min-w-0 flex-1 items-center gap-1 pr-2', sidebarOpen ? 'pl-2' : 'pl-[78px]')}>
              <Button
                size="icon"
                variant="ghost"
                className="no-drag size-7 shrink-0 rounded-md"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                title={sidebarOpen ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
              >
                {sidebarOpen ? (
                  <VscLayoutSidebarLeftOff className="size-4" />
                ) : (
                  <VscLayoutSidebarLeft className="size-4" />
                )}
              </Button>

              {currentTabs.map((tab, index) => {
                const isActive = tab.id === currentActiveTabId
                const tabAgent =
                  tab.kind === 'terminal' ? getTerminalAgent(tab, claudeSessions, codexSessions) : null
                const editorDocument = tab.kind === 'editor' ? editorDocuments[tab.filePath] : null
                const editorDirty = tab.kind === 'editor' && editorDocument
                  ? editorDocument.value !== editorDocument.savedValue
                  : false

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() =>
                      selectedWorkspacePath &&
                      setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
                    }
                    className={cn(
                      'no-drag group relative flex h-8 max-w-[200px] items-center gap-1.5 rounded-md px-3 text-xs',
                      isActive
                        ? 'bg-item-active text-foreground'
                        : 'text-muted hover:bg-item-hover hover:text-secondary'
                    )}
                  >
                    {currentTabs.length > 1 && index < 9 ? (
                      <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded bg-overlay font-mono text-[9px] text-muted">
                        {index + 1}
                      </span>
                    ) : null}
                    <span className="relative flex size-3.5 shrink-0 items-center justify-center">
                      {tab.kind === 'editor' || tab.kind === 'git-diff' ? (
                        <VscFile className="size-3.5" />
                      ) : tabAgent?.agent ? (
                        <AgentIcon agent={tabAgent.agent} state={tabAgent.state} className="size-2.5" />
                      ) : (
                        <VscTerminalBash className="size-3.5" />
                      )}
                      {tabAgent?.agent && tabAgent.state ? (
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-surface',
                            tabAgent.state === 'active' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                          )}
                          title={tabAgent.state === 'active' ? 'Active' : 'Inactive'}
                        />
                      ) : null}
                    </span>
                    <span className="truncate">
                      {tab.kind === 'editor' || tab.kind === 'git-diff'
                        ? tab.title
                        : tabAgent?.agent
                        ? (tabAgent.info?.name ?? tabAgent.prompt ?? getAgentDisplayName(tabAgent.agent))
                        : (selectedWorkspace?.branch ?? selectedWorkspace?.name ?? 'Terminal')}
                    </span>
                    {editorDirty ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />
                    ) : null}
                    {currentTabs.length > 1 ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCloseTab(tab.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation()
                            handleCloseTab(tab.id)
                          }
                        }}
                        className="ml-0.5 flex size-4 items-center justify-center rounded opacity-0 hover:bg-overlay group-hover:opacity-100"
                      >
                        <VscClose className="size-3" />
                      </span>
                    ) : null}
                  </button>
                )
              })}

              {selectedWorkspacePath ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="no-drag size-7 shrink-0 rounded-md"
                  onClick={handleNewTab}
                  aria-label="New terminal tab"
                  title="New terminal tab"
                >
                  <VscAdd className="size-3.5" />
                </Button>
              ) : null}

              {mouseMode ? (
                <button
                  type="button"
                  onClick={handleToggleMouse}
                  className="no-drag ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium bg-yellow-600/20 text-yellow-500 hover:bg-yellow-600/30"
                  title="Tmux mouse mode ON (⌘M to toggle)"
                >
                  MOUSE
                </button>
              ) : null}
            </div>

          </div>

          <div className="min-h-0 flex-1 p-2">
            {currentTabs.length > 0 ? (
              <div className="relative h-full overflow-hidden rounded-md border bg-terminal">
                {currentTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={cn(
                      'absolute inset-0',
                      tab.id === currentActiveTabId ? 'visible' : 'invisible'
                    )}
                  >
                    {tab.kind === 'terminal' ? (
                      <WorktreeTerminal
                        active={tab.id === currentActiveTabId}
                        cwd={tab.workspacePath}
                        initialCommand={tab.initialCommand}
                        tmuxSessionName={tab.tmuxSessionName}
                        mouseMode={mouseMode}
                        onNewTab={handleNewTab}
                        onCloseTab={() => handleCloseTab(tab.id)}
                        onSessionCreated={(sessionId, pid, tmux) =>
                          handleSessionCreated(tab.id, sessionId, pid, tmux)
                        }
                      />
                    ) : tab.kind === 'editor' ? (
                      <FileEditor
                        filePath={tab.filePath}
                        value={editorDocuments[tab.filePath]?.value ?? ''}
                        savedValue={editorDocuments[tab.filePath]?.savedValue ?? ''}
                        isLoading={editorDocuments[tab.filePath]?.isLoading ?? true}
                        isSaving={editorDocuments[tab.filePath]?.isSaving ?? false}
                        errorMessage={editorDocuments[tab.filePath]?.errorMessage ?? null}
                        onChange={(value) => handleEditorChange(tab.filePath, value)}
                        onSave={() => void handleSaveEditor(tab.workspacePath, tab.filePath)}
                        onReload={() => handleReloadEditor(tab.workspacePath, tab.filePath)}
                        onClose={() => handleCloseTab(tab.id)}
                      />
                    ) : (
                      <GitDiffEditor
                        filePath={tab.filePath}
                        status={diffDocuments[tab.filePath]?.status ?? 'modified'}
                        originalValue={diffDocuments[tab.filePath]?.originalValue ?? ''}
                        modifiedValue={diffDocuments[tab.filePath]?.modifiedValue ?? ''}
                        isLoading={diffDocuments[tab.filePath]?.isLoading ?? true}
                        errorMessage={diffDocuments[tab.filePath]?.errorMessage ?? null}
                        onReload={() => handleReloadDiff(tab.workspacePath, tab.filePath)}
                        onClose={() => handleCloseTab(tab.id)}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted">
                Open a folder to get started.
              </div>
            )}
          </div>
        </main>
      </div>

      {settingsOpen ? (
        <SettingsPanel
          defaultTabCommand={appConfigQuery.data?.defaultTabCommand ?? ''}
          onConfigUpdated={(config) => queryClient.setQueryData(['app-config'], config)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {commandPaletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setCommandPaletteOpen(false)} />
      ) : null}
      {quickOpenOpen ? (
        <CommandPalette
          commands={quickOpenCommands}
          filter={quickOpenFilter}
          placeholder="Search by name or regex..."
          emptyText={
            quickOpenFilesQuery.isPending ? 'Indexing files…' : 'No files found'
          }
          onClose={() => setQuickOpenOpen(false)}
        />
      ) : null}
    </div>
  )
}
