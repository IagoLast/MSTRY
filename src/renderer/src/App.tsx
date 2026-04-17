import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useHotkeys } from '@tanstack/react-hotkeys'
import {
  VscAdd,
  VscCheck,
  VscChevronDown,
  VscChevronRight,
  VscClose,
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
import { BsClaude } from 'react-icons/bs'
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
  AppConfig,
  ClaudeSessionInfo,
  CodexSessionInfo,
  OpenCodeSessionInfo,
  PersistedTab,
  Project,
  WorkspaceItem
} from '../../shared/contracts'
import { CommandPalette, type CommandItem } from './components/command-palette'
import { SettingsPanel } from './components/settings-panel'
import { WorktreeTerminal } from './components/worktree-terminal'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { ScrollArea } from './components/ui/scroll-area'
import { getElectronBridge } from './lib/electron-bridge'
import { cn } from './lib/utils'

interface TerminalTab {
  id: string
  workspacePath: string
  initialCommand?: string
  tmuxSessionName: string | null
  sessionId: string | null
  pid: number | null
  processName: string | null
}

const createTab = (workspacePath: string, initialCommand?: string): TerminalTab => ({
  id: crypto.randomUUID(),
  workspacePath,
  initialCommand,
  tmuxSessionName: null,
  sessionId: null,
  pid: null,
  processName: null
})

const createRestoredTab = (persisted: PersistedTab): TerminalTab => ({
  id: persisted.id,
  workspacePath: persisted.workspacePath,
  tmuxSessionName: persisted.tmuxSessionName,
  sessionId: null,
  pid: null,
  processName: null
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

const selectedWorkspaceQueryKey = ['ui', 'selected-workspace'] as const

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return 'Ha ocurrido un error inesperado.'
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
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<Record<string, string>>({})
  const tabsRef = useRef<TerminalTab[]>([])
  const activeTabIdRef = useRef<Record<string, string>>({})
  const selectedWorkspacePathRef = useRef<string | null>(selectedWorkspacePath)
  const [agentsCollapsed, setAgentsCollapsed] = useState(false)
  const [agentsCompact, setAgentsCompact] = useState(false)
  const [collapsedAgentProjects, setCollapsedAgentProjects] = useState<Set<string>>(new Set())
  const [collapsedAgentWorktrees, setCollapsedAgentWorktrees] = useState<Set<string>>(new Set())
  const [draftWorktreeName, setDraftWorktreeName] = useState<string | null>(null)
  const [worktreeMenuProjectPath, setWorktreeMenuProjectPath] = useState<string | null>(null)
  const worktreeMenuRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mouseMode, setMouseMode] = useState(false)
  const [customTabNames, setCustomTabNames] = useState<Record<string, string>>({})
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const appConfigQuery = useQuery({
    queryKey: ['app-config'],
    queryFn: () => getElectronBridge().workspace.getConfig()
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
    (nextTabs: TerminalTab[]) => {
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

  const workspacesQuery = useQuery({
    queryKey: ['workspaces', activeProject?.rootPath],
    queryFn: () => getElectronBridge().worktrees.list(),
    enabled: Boolean(activeProject?.rootPath)
  })

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
          .filter((tab) => workspaceBelongsToProject(removedProject, tab.workspacePath))
          .map((tab) => {
            if (tab.tmuxSessionName) void bridge.terminal.destroySession(tab.tmuxSessionName)
            return tab.id
          })
      )
      commitTabState(tabsRef.current.filter((tab) => !removedTabIds.has(tab.id)))
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const createWorktreeMutation = useMutation({
    mutationFn: (name: string) => getElectronBridge().worktrees.create({ name }),
    onSuccess: (workspace) => {
      setDraftWorktreeName(null)
      setSelectedWorkspacePath(workspace.path)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const removeWorktreeMutation = useMutation({
    mutationFn: (workspacePath: string) => getElectronBridge().worktrees.remove({ path: workspacePath }),
    onSuccess: (result, workspacePath) => {
      const bridge = getElectronBridge()
      const removedTabIds = new Set(
        tabsRef.current
          .filter((tab) => tab.workspacePath === workspacePath)
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

  useEffect(() => {
    const availableItems = workspacesQuery.data ?? []

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
  }, [selectedWorkspacePath, setSelectedWorkspacePath, tabs, workspacesQuery.data])

  useEffect(() => {
    if (!selectedWorkspacePath) {
      return
    }

    const hasTabsForWorkspace = tabs.some((tab) => tab.workspacePath === selectedWorkspacePath)
    if (!hasTabsForWorkspace) {
      const tab = createTab(selectedWorkspacePath, defaultTabCommand)
      setTabs((current) => [...current, tab])
      setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
    }
  }, [defaultTabCommand, selectedWorkspacePath, tabs])

  useEffect(() => {
    const bridge = getElectronBridge()
    const off = bridge.terminal.onProcessChange((event) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.sessionId === event.sessionId ? { ...tab, processName: event.processName } : tab
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
    const persistable = tabs.filter((t) => t.tmuxSessionName)
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
  }, [tabs, activeTabId])

  const handleSessionCreated = useCallback(
    (tabId: string, sessionId: string, pid: number, tmuxSessionName: string) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId ? { ...tab, sessionId, pid, tmuxSessionName } : tab
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

  const groupedAgents = useMemo(() => {
    const projects = appConfigQuery.data?.projects ?? []
    const workspaces = workspacesQuery.data ?? []

    const tabsByProject = new Map<string, TerminalTab[]>()
    for (const tab of tabs) {
      const ownerProject = findOwnerProject(projects, tab.workspacePath)
      const projectPath = ownerProject?.rootPath ?? '__orphan__'
      if (!tabsByProject.has(projectPath)) tabsByProject.set(projectPath, [])
      tabsByProject.get(projectPath)!.push(tab)
    }

    const groups: {
      project: Project | null
      projectPath: string
      worktrees: { path: string; label: string; isWorktree: boolean; tabs: TerminalTab[] }[]
    }[] = []

    for (const [projectPath, projectTabs] of tabsByProject) {
      const project = projects.find((p) => p.rootPath === projectPath) ?? null

      const tabsByWorkspace = new Map<string, TerminalTab[]>()
      for (const tab of projectTabs) {
        if (!tabsByWorkspace.has(tab.workspacePath))
          tabsByWorkspace.set(tab.workspacePath, [])
        tabsByWorkspace.get(tab.workspacePath)!.push(tab)
      }

      const worktreeGroups: { path: string; label: string; isWorktree: boolean; tabs: TerminalTab[] }[] = []
      for (const [wsPath, wsTabs] of tabsByWorkspace) {
        const wsData = workspaces.find((w) => w.path === wsPath)
        let label: string
        if (wsData) {
          label = wsData.branch ?? (wsData.isMain ? 'main' : wsData.name)
        } else if (project && wsPath === project.rootPath) {
          label = 'main'
        } else {
          label = wsPath.split('/').pop() ?? 'workspace'
        }
        const isWorktree = wsData?.kind === 'worktree' && !wsData.isMain
        worktreeGroups.push({ path: wsPath, label, isWorktree, tabs: wsTabs })
      }

      groups.push({ project, projectPath, worktrees: worktreeGroups })
    }

    return groups
  }, [tabs, appConfigQuery.data?.projects, workspacesQuery.data])

  const handleToggleMouse = useCallback(() => {
    void getElectronBridge().terminal.toggleMouse()
  }, [])

  const handleDeleteOrphanTabs = useCallback(() => {
    const projects = appConfigQuery.data?.projects ?? []
    const orphanTabs = tabsRef.current.filter((tab) => !findOwnerProject(projects, tab.workspacePath))

    if (orphanTabs.length === 0) return

    const label = orphanTabs.length === 1 ? '1 agente huerfano' : `${orphanTabs.length} agentes huerfanos`
    if (
      !window.confirm(
        `Quitar ${label}.\n\nSe cerraran sus terminales y desapareceran de la barra lateral.`
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
    const mainPath = activeProject?.rootPath
    if (!mainPath) return
    const tab = createTab(mainPath, defaultTabCommand)
    setTabs((current) => [...current, tab])
    setActiveTabId((current) => ({ ...current, [mainPath]: tab.id }))
    setSelectedWorkspacePath(mainPath)
  }, [activeProject?.rootPath, defaultTabCommand, setSelectedWorkspacePath])

  const handleNavigateToWorktree = useCallback((worktreePath: string) => {
    const hasTabs = tabsRef.current.some((tab) => tab.workspacePath === worktreePath)
    if (!hasTabs) {
      const tab = createTab(worktreePath, defaultTabCommand)
      setTabs((current) => [...current, tab])
      setActiveTabId((current) => ({ ...current, [worktreePath]: tab.id }))
    }
    setSelectedWorkspacePath(worktreePath)
    setWorktreeMenuProjectPath(null)
  }, [defaultTabCommand, setSelectedWorkspacePath])

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
      const target = tabsRef.current.find((tab) => tab.id === tabId)
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
      if (workspaceTabs.length <= 1) return

      const closingTab = workspaceTabs.find((tab) => tab.id === tabId)
      const closingIndex = workspaceTabs.findIndex((tab) => tab.id === tabId)

      // Kill the tmux session — the user intentionally closed the tab.
      if (closingTab?.tmuxSessionName) {
        void getElectronBridge().terminal.destroySession(closingTab.tmuxSessionName)
      }

      setTabs((current) => current.filter((tab) => tab.id !== tabId))

      if (currentActiveTabId === tabId) {
        const nextTab = workspaceTabs[closingIndex + 1] ?? workspaceTabs[closingIndex - 1]
        if (nextTab) {
          setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: nextTab.id }))
        }
      }
    },
    [selectedWorkspacePath, tabs, currentActiveTabId]
  )

  const selectedWorkspace = useMemo(
    () => workspacesQuery.data?.find((item) => item.path === selectedWorkspacePath) ?? null,
    [selectedWorkspacePath, workspacesQuery.data]
  )

  const isGitProject = activeProject?.mode === 'git'
  const configErrorMessage = appConfigQuery.isError
    ? getErrorMessage(appConfigQuery.error)
    : pickProjectMutation.isError
      ? getErrorMessage(pickProjectMutation.error)
      : selectProjectMutation.isError
        ? getErrorMessage(selectProjectMutation.error)
        : removeProjectMutation.isError
          ? getErrorMessage(removeProjectMutation.error)
          : null

  const worktreeErrorMessage = workspacesQuery.isError
    ? getErrorMessage(workspacesQuery.error)
    : createWorktreeMutation.isError
      ? getErrorMessage(createWorktreeMutation.error)
      : removeWorktreeMutation.isError
        ? getErrorMessage(removeWorktreeMutation.error)
        : null


  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['app-config'] })
    queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  }

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open)
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
        label: 'Close Terminal',
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
      {
        id: 'toggle-sidebar',
        label: sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
        shortcut: '⌘B',
        icon: sidebarOpen ? <VscLayoutSidebarLeftOff className="size-4" /> : <VscLayoutSidebarLeft className="size-4" />,
        onSelect: toggleSidebar
      },
      {
        id: 'new-worktree',
        label: 'Crear worktree',
        icon: <VscSourceControl className="size-4" />,
        onSelect: () => setDraftWorktreeName((c) => (c !== null ? null : generateRandomWorktreeName()))
      },
      {
        id: 'new-tab-main',
        label: 'Abrir terminal en main',
        icon: <VscTerminalBash className="size-4" />,
        onSelect: handleNewTabInMain
      },
      {
        id: 'open-folder',
        label: 'Abrir carpeta',
        icon: <VscFolderOpened className="size-4" />,
        onSelect: () => void pickProjectMutation.mutateAsync()
      },
      {
        id: 'toggle-mouse',
        label: mouseMode ? 'Disable tmux mouse mode' : 'Enable tmux mouse mode',
        shortcut: '⌘M',
        onSelect: () => handleToggleMouse()
      }
    ],
    [handleNewTab, handleNewClaudeTab, handleNewTabInMain, handleCloseTab, currentActiveTabId, handleRefresh, pickProjectMutation, sidebarOpen, toggleSidebar, mouseMode, handleToggleMouse]
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
        hotkey: 'Mod+K',
        callback: () => setCommandPaletteOpen((open) => !open)
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
    await createWorktreeMutation.mutateAsync(draftWorktreeName)
  }

  const handleDeleteProject = async (project: Project) => {
    if (!window.confirm(`Quitar ${project.name} de la lista de proyectos.`)) {
      return
    }

    await removeProjectMutation.mutateAsync(project)
  }

  const handleDeleteWorktree = async (workspace: WorkspaceItem) => {
    const targetName = workspace.branch ?? workspace.name
    const branchWarning = workspace.branch
      ? `Tambien se borrara la rama local ${workspace.branch}.`
      : 'Se borrara la carpeta del worktree.'

    if (
      !window.confirm(
        `Borrar ${targetName}.\n\n${branchWarning}\nSe perderan los cambios sin commit que haya dentro de ese worktree.`
      )
    ) {
      return
    }

    await removeWorktreeMutation.mutateAsync(workspace.path)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex h-screen overflow-hidden">
        <aside
          className={cn('flex shrink-0 flex-col overflow-hidden bg-sidebar', sidebarOpen ? 'w-[400px] border-r' : 'w-0 border-r-0')}
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

          {draftWorktreeName !== null && isGitProject ? (
            <div className="border-b px-3 py-3">
              <form className="flex items-center gap-2" onSubmit={handleCreateWorktree}>
                <Input
                  value={draftWorktreeName}
                  onChange={(event) => setDraftWorktreeName(event.target.value)}
                  placeholder="feature/nuevo-worktree"
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
                  onClick={() => setDraftWorktreeName(null)}
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
                {tabs.length}
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
                {tabs.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted">Sin agentes activos</div>
                ) : null}

                {agentsCompact ? (
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={tabs.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col">
                    {groupedAgents.flatMap((group) =>
                      group.worktrees.flatMap((wt) =>
                        wt.tabs.map((tab) => {
                          const claudeInfo = tab.pid
                            ? claudeSessions.find((s) => s.shellPid === tab.pid) ?? null
                            : null
                          const codexInfo = tab.pid
                            ? codexSessions.find((s) => s.shellPid === tab.pid) ?? null
                            : null
                          const isClaude = claudeInfo !== null || isClaudeProcess(tab.processName)
                          const isCodex = codexInfo !== null || isCodexProcess(tab.processName)
                          const isOpenCode = isOpenCodeProcess(tab.processName)
                          const isAgent = isClaude || isCodex || isOpenCode
                          const isActive =
                            selectedWorkspacePath === tab.workspacePath &&
                            activeTabId[tab.workspacePath] === tab.id
                          const agentInfo = isCodex ? codexInfo : claudeInfo
                          const agentPrompt = (agentInfo as ClaudeSessionInfo | CodexSessionInfo | null)?.prompt
                          const defaultLabel = isAgent
                            ? (agentInfo?.name ?? agentPrompt ?? (isOpenCode ? 'OpenCode' : isCodex ? 'Codex' : 'Claude'))
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
                                {isAgent ? (
                                  isClaude ? (
                                    <BsClaude
                                      className={cn(
                                        'size-3',
                                        agentInfo?.status === 'working' && 'text-green-400',
                                        agentInfo?.status === 'idle' && 'text-red-400'
                                      )}
                                    />
                                  ) : (
                                    <span
                                      className={cn(
                                        'text-[10px] font-bold',
                                        agentInfo?.status === 'working' && 'text-green-400',
                                        agentInfo?.status === 'idle' && 'text-red-400'
                                      )}
                                    >
                                      {isOpenCode ? 'O' : 'C'}
                                    </span>
                                  )
                                ) : (
                                  <VscTerminalBash className="size-3.5" />
                                )}
                                {isAgent && agentInfo ? (
                                  <span
                                    className={cn(
                                      'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-sidebar',
                                      agentInfo.status === 'working' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                                    )}
                                    title={agentInfo.status === 'working' ? 'Working...' : 'Needs input'}
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
                        onClick={() => {
                          const mainPath = group.project?.rootPath
                          if (!mainPath) return
                          const hasTabs = tabsRef.current.some((tab) => tab.workspacePath === mainPath)
                          if (!hasTabs) {
                            const tab = createTab(mainPath, defaultTabCommand)
                            setTabs((current) => [...current, tab])
                            setActiveTabId((current) => ({ ...current, [mainPath]: tab.id }))
                          }
                          setSelectedWorkspacePath(mainPath)
                        }}
                        aria-label="Abrir terminal en main"
                        title="Abrir terminal en main"
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
                              {(workspacesQuery.data ?? []).filter((ws) => ws.kind === 'worktree' && !ws.isMain).map((ws) => (
                                <button
                                  key={ws.path}
                                  type="button"
                                  className={cn(
                                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-item-hover',
                                    selectedWorkspacePath === ws.path ? 'text-foreground' : 'text-secondary'
                                  )}
                                  onClick={() => handleNavigateToWorktree(ws.path)}
                                >
                                  <VscSourceControl className="size-3 shrink-0" />
                                  <span className="truncate">{ws.branch ?? ws.name}</span>
                                  {selectedWorkspacePath === ws.path ? (
                                    <VscCheck className="ml-auto size-3 shrink-0" />
                                  ) : null}
                                </button>
                              ))}
                              {(workspacesQuery.data ?? []).some((ws) => ws.kind === 'worktree' && !ws.isMain) ? (
                                <div className="mx-2 my-1 border-t border-border" />
                              ) : null}
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-secondary hover:bg-item-hover"
                                onClick={() => {
                                  setWorktreeMenuProjectPath(null)
                                  setDraftWorktreeName((c) => (c !== null ? null : generateRandomWorktreeName()))
                                }}
                              >
                                <VscAdd className="size-3 shrink-0" />
                                <span>Crear worktree</span>
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
                          aria-label={`Eliminar proyecto ${group.project.name}`}
                          title="Eliminar proyecto"
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
                          aria-label="Eliminar agentes huerfanos"
                          title="Eliminar agentes huerfanos"
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
                            onClick={() => {
                              const tab = createTab(wt.path, defaultTabCommand)
                              setTabs((current) => [...current, tab])
                              setActiveTabId((current) => ({ ...current, [wt.path]: tab.id }))
                              setSelectedWorkspacePath(wt.path)
                            }}
                            aria-label="Nuevo agente"
                            title="Nuevo agente"
                          >
                            <VscAdd className="size-3.5" />
                          </Button>

                          {(() => {
                            const wsData = (workspacesQuery.data ?? []).find((w) => w.path === wt.path)
                            const canDelete = wsData?.kind === 'worktree' && !wsData.isMain
                            return canDelete && wsData ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-5 shrink-0 rounded text-muted hover:text-destructive"
                                onClick={() => void handleDeleteWorktree(wsData)}
                                aria-label={`Borrar worktree ${wt.label}`}
                                title="Borrar worktree"
                              >
                                <VscTrash className="size-3.5" />
                              </Button>
                            ) : null
                          })()}
                        </div>

                        {!isWtCollapsed && (
                          <DndContext key={wt.path} sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={wt.tabs.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        {wt.tabs.map((tab) => {
                          const claudeInfo = tab.pid
                            ? claudeSessions.find((s) => s.shellPid === tab.pid) ?? null
                            : null
                          const codexInfo = tab.pid
                            ? codexSessions.find((s) => s.shellPid === tab.pid) ?? null
                            : null
                          const isClaude = claudeInfo !== null || isClaudeProcess(tab.processName)
                          const isCodex = codexInfo !== null || isCodexProcess(tab.processName)
                          const isOpenCode = isOpenCodeProcess(tab.processName)
                          const isAgent = isClaude || isCodex || isOpenCode
                          const isActive =
                            selectedWorkspacePath === tab.workspacePath &&
                            activeTabId[tab.workspacePath] === tab.id
                          const agentInfo = isCodex ? codexInfo : claudeInfo
                          const agentPrompt = (agentInfo as ClaudeSessionInfo | CodexSessionInfo | null)?.prompt
                          const defaultLabel = isAgent
                            ? (agentInfo?.name ?? agentPrompt ?? (isOpenCode ? 'OpenCode' : isCodex ? 'Codex' : 'Claude'))
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
                                {isAgent ? (
                                  isClaude ? (
                                    <BsClaude
                                      className={cn(
                                        'size-3',
                                        agentInfo?.status === 'working' && 'text-green-400',
                                        agentInfo?.status === 'idle' && 'text-red-400'
                                      )}
                                    />
                                  ) : (
                                    <span
                                      className={cn(
                                        'text-[10px] font-bold',
                                        agentInfo?.status === 'working' && 'text-green-400',
                                        agentInfo?.status === 'idle' && 'text-red-400'
                                      )}
                                    >
                                      {isOpenCode ? 'O' : 'C'}
                                    </span>
                                  )
                                ) : (
                                  <VscTerminalBash className="size-3.5" />
                                )}
                                {isAgent && agentInfo ? (
                                  <span
                                    className={cn(
                                      'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-sidebar',
                                      agentInfo.status === 'working' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                                    )}
                                    title={agentInfo.status === 'working' ? 'Working...' : 'Needs input'}
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
                const claudeInfo = tab.pid
                  ? claudeSessions.find((s) => s.shellPid === tab.pid) ?? null
                  : null
                const codexInfo = tab.pid
                  ? codexSessions.find((s) => s.shellPid === tab.pid) ?? null
                  : null
                const isClaude = claudeInfo !== null || isClaudeProcess(tab.processName)
                const isCodex = codexInfo !== null || isCodexProcess(tab.processName)
                const isOpenCode = isOpenCodeProcess(tab.processName)
                const isAgent = isClaude || isCodex || isOpenCode
                const agentInfo = isCodex ? codexInfo : claudeInfo
                const agentPrompt = (agentInfo as ClaudeSessionInfo | CodexSessionInfo | null)?.prompt

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
                      {isAgent ? (
                        isClaude ? (
                          <BsClaude
                            className={cn(
                              'size-2.5',
                              agentInfo?.status === 'working' && 'text-green-400',
                              agentInfo?.status === 'idle' && 'text-red-400'
                            )}
                          />
                        ) : (
                          <span
                            className={cn(
                              'text-[10px] font-bold',
                              agentInfo?.status === 'working' && 'text-green-400',
                              agentInfo?.status === 'idle' && 'text-red-400'
                            )}
                          >
                            {isOpenCode ? 'O' : 'C'}
                          </span>
                        )
                      ) : (
                        <VscTerminalBash className="size-3.5" />
                      )}
                      {isAgent && agentInfo ? (
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-surface',
                            agentInfo.status === 'working' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                          )}
                          title={agentInfo.status === 'working' ? 'Working...' : 'Needs input'}
                        />
                      ) : null}
                    </span>
                    <span className="truncate">
                      {isAgent
                        ? (agentInfo?.name ?? agentPrompt ?? (isOpenCode ? 'OpenCode' : isCodex ? 'Codex' : 'Claude'))
                        : (selectedWorkspace?.branch ?? selectedWorkspace?.name ?? 'Terminal')}
                    </span>
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
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted">
                Open folder para empezar.
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
    </div>
  )
}
