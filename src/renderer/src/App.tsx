import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useHotkeys } from '@tanstack/react-hotkeys'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  VscAdd,
  VscCheck,
  VscChevronDown,
  VscChevronRight,
  VscClose,
  VscFolder,
  VscFolderOpened,
  VscLayoutSidebarLeft,
  VscLayoutSidebarLeftOff,
  VscRefresh,
  VscRepo,
  VscSettingsGear,
  VscSortPrecedence,
  VscSourceControl,
  VscTerminalBash,
  VscTrash
} from 'react-icons/vsc'

import type { AppConfig, ClaudeSessionInfo, PersistedTab, Project, WorkspaceItem } from '../../shared/contracts'
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

const isClaudeProcess = (name: string | null) =>
  name != null && /\bclaude\b/i.test(name)

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

const getWorkspaceMeta = (item: WorkspaceItem) => {
  if (item.kind === 'directory') {
    return 'folder'
  }

  if (item.isMain) {
    return 'main'
  }

  return item.branch ?? 'worktree'
}

function SortableAgentItem({
  id,
  children
}: {
  id: string
  children: (args: { listeners: ReturnType<typeof useSortable>['listeners']; isDragging: boolean }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ listeners, isDragging })}
    </div>
  )
}

export function App() {
  const queryClient = useQueryClient()
  const { selectedWorkspacePath, setSelectedWorkspacePath } = useSelectedWorkspace()
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<Record<string, string>>({})
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [worktreesCollapsed, setWorktreesCollapsed] = useState(false)
  const [agentsCollapsed, setAgentsCollapsed] = useState(false)
  const [draftWorktreeName, setDraftWorktreeName] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(340)
  const [mouseMode, setMouseMode] = useState(false)
  const isResizing = useRef(false)

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleAgentDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setTabs((current) => {
      const oldIndex = current.findIndex((t) => t.id === active.id)
      const newIndex = current.findIndex((t) => t.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return current
      return arrayMove(current, oldIndex, newIndex)
    })
  }, [])

  const [worktreeOrder, setWorktreeOrder] = useState<string[]>([])

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

  const reorderProjectsMutation = useMutation({
    mutationFn: (orderedPaths: string[]) =>
      getElectronBridge().workspace.reorderProjects(orderedPaths),
    onMutate: async (orderedPaths) => {
      await queryClient.cancelQueries({ queryKey: ['app-config'] })
      const previous = queryClient.getQueryData<AppConfig>(['app-config'])
      if (previous) {
        const byPath = new Map(previous.projects.map((project) => [project.rootPath, project]))
        const reordered: Project[] = []
        const seen = new Set<string>()
        for (const candidate of orderedPaths) {
          const project = byPath.get(candidate)
          if (project && !seen.has(candidate)) {
            reordered.push(project)
            seen.add(candidate)
          }
        }
        for (const project of previous.projects) {
          if (!seen.has(project.rootPath)) reordered.push(project)
        }
        queryClient.setQueryData<AppConfig>(['app-config'], { ...previous, projects: reordered })
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['app-config'], context.previous)
    },
    onSuccess: (config) => {
      queryClient.setQueryData(['app-config'], config)
    }
  })

  const removeProjectMutation = useMutation({
    mutationFn: (project: Project) => getElectronBridge().workspace.removeProject(project.rootPath),
    onSuccess: (config, removedProject) => {
      queryClient.setQueryData(['app-config'], config)
      const electree = getElectronBridge()
      setTabs((current) => {
        const removed = current.filter((tab) => {
          if (tab.workspacePath === removedProject.rootPath) return true
          if (removedProject.worktreeRoot && tab.workspacePath.startsWith(removedProject.worktreeRoot)) return true
          return false
        })
        for (const tab of removed) {
          if (tab.tmuxSessionName) void electree.terminal.destroySession(tab.tmuxSessionName)
        }
        return current.filter((tab) => !removed.includes(tab))
      })
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
      if (selectedWorkspacePath === workspacePath) {
        setSelectedWorkspacePath(null)
      }

      const electree = getElectronBridge()
      setTabs((current) => {
        for (const tab of current) {
          if (tab.workspacePath === workspacePath && tab.tmuxSessionName) {
            void electree.terminal.destroySession(tab.tmuxSessionName)
          }
        }
        return current.filter((tab) => tab.workspacePath !== workspacePath)
      })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })

      if (result.warning) {
        window.alert(result.warning)
      }
    }
  })

  useEffect(() => {
    if (!activeProject) {
      setWorktreeOrder([])
      return
    }
    try {
      const saved = localStorage.getItem(`worktree-order:${activeProject.rootPath}`)
      setWorktreeOrder(saved ? (JSON.parse(saved) as string[]) : [])
    } catch {
      setWorktreeOrder([])
    }
  }, [activeProject?.rootPath])

  useEffect(() => {
    if (!activeProject) return
    try {
      localStorage.setItem(
        `worktree-order:${activeProject.rootPath}`,
        JSON.stringify(worktreeOrder)
      )
    } catch {
      /* ignore quota errors */
    }
  }, [activeProject?.rootPath, worktreeOrder])

  const orderedWorkspaces = useMemo(() => {
    const items = workspacesQuery.data ?? []
    if (worktreeOrder.length === 0) return items
    const byPath = new Map(items.map((item) => [item.path, item]))
    const ordered: WorkspaceItem[] = []
    const seen = new Set<string>()
    for (const path of worktreeOrder) {
      const item = byPath.get(path)
      if (item && !seen.has(path)) {
        ordered.push(item)
        seen.add(path)
      }
    }
    for (const item of items) {
      if (!seen.has(item.path)) ordered.push(item)
    }
    return ordered
  }, [workspacesQuery.data, worktreeOrder])

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const projects = appConfigQuery.data?.projects ?? []
      const paths = projects.map((project) => project.rootPath)
      const oldIndex = paths.indexOf(active.id as string)
      const newIndex = paths.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return
      reorderProjectsMutation.mutate(arrayMove(paths, oldIndex, newIndex))
    },
    [appConfigQuery.data?.projects, reorderProjectsMutation]
  )

  const handleWorktreeDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const paths = orderedWorkspaces.map((item) => item.path)
      const oldIndex = paths.indexOf(active.id as string)
      const newIndex = paths.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return
      setWorktreeOrder(arrayMove(paths, oldIndex, newIndex))
    },
    [orderedWorkspaces]
  )

  useEffect(() => {
    const availableItems = workspacesQuery.data ?? []

    if (availableItems.length === 0) {
      setSelectedWorkspacePath(null)
      return
    }

    const stillExists = availableItems.some((item) => item.path === selectedWorkspacePath)
    if (!stillExists) {
      setSelectedWorkspacePath(availableItems[0].path)
    }
  }, [selectedWorkspacePath, setSelectedWorkspacePath, workspacesQuery.data])

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
    const electree = getElectronBridge()
    const off = electree.terminal.onProcessChange((event) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.sessionId === event.sessionId ? { ...tab, processName: event.processName } : tab
        )
      )
    })
    return off
  }, [])

  const [claudeSessions, setClaudeSessions] = useState<ClaudeSessionInfo[]>([])
  const tabsRestoredRef = useRef(false)

  useEffect(() => {
    const electree = getElectronBridge()
    const off = electree.claude.onSessionChange(setClaudeSessions)
    return off
  }, [])

  useEffect(() => {
    const electree = getElectronBridge()
    void electree.terminal.getMouseMode().then(setMouseMode)
    const off = electree.terminal.onMouseModeChanged(setMouseMode)
    return off
  }, [])

  // Restore persisted tabs on startup.
  useEffect(() => {
    if (tabsRestoredRef.current) return
    tabsRestoredRef.current = true

    const electree = getElectronBridge()
    void (async () => {
      const [persisted, aliveSessions] = await Promise.all([
        electree.terminal.getPersistedTabs(),
        electree.terminal.listTmuxSessions()
      ])

      const aliveSet = new Set(aliveSessions)
      const validTabs = persisted.tabs.filter((t) => aliveSet.has(t.tmuxSessionName))

      if (validTabs.length > 0) {
        setTabs(validTabs.map(createRestoredTab))
        setActiveTabId(persisted.activeTabId)
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

  const handleToggleMouse = useCallback(() => {
    void getElectronBridge().terminal.toggleMouse()
  }, [])

  const handleNewTab = useCallback(() => {
    if (!selectedWorkspacePath) return
    const tab = createTab(selectedWorkspacePath, defaultTabCommand)
    setTabs((current) => [...current, tab])
    setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
  }, [defaultTabCommand, selectedWorkspacePath])

  const handleNewClaudeTab = useCallback(() => {
    if (!selectedWorkspacePath) return
    const tab = createTab(selectedWorkspacePath, 'claude --dangerously-skip-permissions')
    setTabs((current) => [...current, tab])
    setActiveTabId((current) => ({ ...current, [selectedWorkspacePath]: tab.id }))
  }, [selectedWorkspacePath])

  const handleSelectTab = useCallback(
    (tab: TerminalTab) => {
      const projects = appConfigQuery.data?.projects ?? []
      const ownerProject = projects.find((project) => {
        if (tab.workspacePath === project.rootPath) return true
        if (project.worktreeRoot && tab.workspacePath.startsWith(project.worktreeRoot)) return true
        return false
      })
      if (ownerProject && ownerProject.rootPath !== activeProject?.rootPath) {
        selectProjectMutation.mutate(ownerProject.rootPath)
      }
      setSelectedWorkspacePath(tab.workspacePath)
      setActiveTabId((current) => ({ ...current, [tab.workspacePath]: tab.id }))
    },
    [appConfigQuery.data, activeProject, selectProjectMutation, setSelectedWorkspacePath]
  )

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
      const target = tabs.find((tab) => tab.id === tabId)
      if (!target) return

      if (target.tmuxSessionName) {
        void getElectronBridge().terminal.destroySession(target.tmuxSessionName)
      }

      setTabs((current) => current.filter((tab) => tab.id !== tabId))
      setActiveTabId((current) => {
        if (current[target.workspacePath] !== tabId) return current
        const remaining = tabs.filter(
          (tab) => tab.workspacePath === target.workspacePath && tab.id !== tabId
        )
        const next = { ...current }
        if (remaining.length > 0) {
          next[target.workspacePath] = remaining[0].id
        } else {
          delete next[target.workspacePath]
        }
        return next
      })
    },
    [tabs]
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

  const handleSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const newWidth = Math.min(Math.max(ev.clientX, 200), 600)
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

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
        label: 'New Worktree',
        icon: <VscSourceControl className="size-4" />,
        onSelect: () => setDraftWorktreeName((c) => (c !== null ? null : generateRandomWorktreeName()))
      },
      {
        id: 'open-folder',
        label: 'Open Folder',
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
    [handleNewTab, handleNewClaudeTab, handleCloseTab, currentActiveTabId, handleRefresh, pickProjectMutation, sidebarOpen, toggleSidebar, mouseMode, handleToggleMouse]
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
          className={cn('flex shrink-0 flex-col overflow-hidden bg-sidebar', sidebarOpen ? 'border-r' : 'border-r-0')}
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
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

          <div className="border-b">
            <div className="flex h-9 items-center">
              <button
                type="button"
                onClick={() => setProjectsCollapsed((c) => !c)}
                className="flex min-w-0 flex-1 items-center gap-2 px-4 text-[11px] uppercase tracking-[0.18em] text-muted hover:text-secondary"
              >
                {projectsCollapsed ? (
                  <VscChevronRight className="size-3.5" />
                ) : (
                  <VscChevronDown className="size-3.5" />
                )}
                Projects
              </button>

              <Button
                size="icon"
                variant="ghost"
                className="mr-0.5 size-7 rounded-md"
                onClick={() => {
                  const projects = appConfigQuery.data?.projects ?? []
                  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name))
                  reorderProjectsMutation.mutate(sorted.map((p) => p.rootPath))
                }}
                aria-label="Sort alphabetically"
                title="Sort alphabetically"
              >
                <VscSortPrecedence className="size-4" />
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

            {!projectsCollapsed ? (
              <ScrollArea className="[&_[data-radix-scroll-area-viewport]]:max-h-[220px]">
                <div className="px-2 pb-2">
                  <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleProjectDragEnd}
                  >
                    <SortableContext
                      items={(appConfigQuery.data?.projects ?? []).map((p) => p.rootPath)}
                      strategy={verticalListSortingStrategy}
                    >
                  {appConfigQuery.data?.projects.map((project) => {
                    const isActive = project.rootPath === activeProject?.rootPath

                    return (
                      <SortableAgentItem key={project.rootPath} id={project.rootPath}>
                        {({ listeners }) => (
                      <div
                        className={cn(
                          'group flex items-center gap-2 rounded-md px-2 py-1',
                          isActive ? 'bg-item-active text-foreground' : 'text-secondary hover:bg-item-hover'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void selectProjectMutation.mutateAsync(project.rootPath)}
                          {...listeners}
                          className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left active:cursor-grabbing"
                        >
                          <span className="flex size-4 shrink-0 items-center justify-center text-icon">
                            {project.mode === 'git' ? (
                              <VscRepo className="size-3.5" />
                            ) : (
                              <VscFolder className="size-3.5" />
                            )}
                          </span>

                          <span className="min-w-0 flex-1 leading-tight">
                            <span className="block truncate text-[10px] uppercase tracking-[0.14em] text-muted">
                              {project.mode === 'git' ? 'repo' : 'folder'}
                            </span>
                            <span className="block truncate text-xs">{project.name}</span>
                          </span>
                        </button>

                        {isActive && isGitProject ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-5 rounded opacity-0 group-hover:opacity-100"
                            onClick={() => setDraftWorktreeName((current) => current !== null ? null : generateRandomWorktreeName())}
                            aria-label="Create worktree"
                            title="Create worktree"
                          >
                            <VscAdd className="size-3.5" />
                          </Button>
                        ) : null}

                        {appConfigQuery.data.projects.length > 1 ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-5 rounded opacity-0 group-hover:opacity-100"
                            onClick={() => void handleDeleteProject(project)}
                            aria-label={`Quitar ${project.name}`}
                            title="Quitar proyecto"
                          >
                            <VscTrash className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                        )}
                      </SortableAgentItem>
                    )
                  })}
                    </SortableContext>
                  </DndContext>
                </div>
              </ScrollArea>
            ) : null}
          </div>

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

          {worktreeErrorMessage ? (
            <div className="border-b border-red-500/10 bg-red-500/[0.06] px-4 py-2.5 text-xs text-error">
              {worktreeErrorMessage}
            </div>
          ) : null}

          <div className="flex h-9 shrink-0 items-center border-b">
            <button
              type="button"
              onClick={() => setWorktreesCollapsed((c) => !c)}
              className="flex min-w-0 flex-1 items-center gap-2 px-4 text-[11px] uppercase tracking-[0.18em] text-muted hover:text-secondary"
            >
              {worktreesCollapsed ? (
                <VscChevronRight className="size-3.5" />
              ) : (
                <VscChevronDown className="size-3.5" />
              )}
              {isGitProject ? 'Worktrees' : 'Workspace'}
            </button>

            <Button
              size="icon"
              variant="ghost"
              className="mr-0.5 size-7 rounded-md"
              onClick={() => {
                const sorted = [...orderedWorkspaces].sort((a, b) => a.name.localeCompare(b.name))
                setWorktreeOrder(sorted.map((item) => item.path))
              }}
              aria-label="Sort alphabetically"
              title="Sort alphabetically"
            >
              <VscSortPrecedence className="size-4" />
            </Button>

            {isGitProject ? (
              <Button
                size="icon"
                variant="ghost"
                className="mr-2 size-7 rounded-md"
                onClick={() => setDraftWorktreeName((current) => current !== null ? null : generateRandomWorktreeName())}
                aria-label="Create worktree"
                title="Create worktree"
              >
                <VscAdd className="size-4" />
              </Button>
            ) : null}
          </div>

          {!worktreesCollapsed ? (
            <ScrollArea className="shrink-0 border-b [&_[data-radix-scroll-area-viewport]]:max-h-[40vh]">
              <div className="px-2 py-2">
                {workspacesQuery.isPending ? (
                  <div className="px-2 py-2 text-sm text-muted">Loading...</div>
                ) : null}

                {!workspacesQuery.isPending && orderedWorkspaces.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted">No items</div>
                ) : null}

                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleWorktreeDragEnd}
                >
                  <SortableContext
                    items={orderedWorkspaces.map((item) => item.path)}
                    strategy={verticalListSortingStrategy}
                  >
                {orderedWorkspaces.map((item) => {
                  const isSelected = selectedWorkspacePath === item.path
                  const canDelete = item.kind === 'worktree' && !item.isMain

                  return (
                    <SortableAgentItem key={item.path} id={item.path}>
                      {({ listeners }) => (
                    <div
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1',
                        isSelected ? 'bg-item-active text-foreground' : 'text-secondary hover:bg-item-hover'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedWorkspacePath(item.path)}
                        {...listeners}
                        className="flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left active:cursor-grabbing"
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center text-icon">
                          {item.kind === 'directory' ? (
                            <VscFolder className="size-3.5" />
                          ) : (
                            <VscSourceControl className="size-3.5" />
                          )}
                        </span>

                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-[10px] uppercase tracking-[0.14em] text-muted">
                            {getWorkspaceMeta(item)}
                          </span>
                          <span className="block truncate text-xs">{item.name}</span>
                        </span>
                      </button>

                      {canDelete ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-5 rounded opacity-0 group-hover:opacity-100"
                          onClick={() => void handleDeleteWorktree(item)}
                          aria-label={`Borrar ${item.name}`}
                          title="Borrar worktree"
                        >
                          <VscTrash className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                      )}
                    </SortableAgentItem>
                  )
                })}
                  </SortableContext>
                </DndContext>
              </div>
            </ScrollArea>
          ) : null}

          <div className="flex h-9 shrink-0 items-center border-b">
            <button
              type="button"
              onClick={() => setAgentsCollapsed((c) => !c)}
              className="flex min-w-0 flex-1 items-center gap-2 px-4 text-[11px] uppercase tracking-[0.18em] text-muted hover:text-secondary"
            >
              {agentsCollapsed ? (
                <VscChevronRight className="size-3.5" />
              ) : (
                <VscChevronDown className="size-3.5" />
              )}
              Agents
              <span className="ml-1 font-mono text-[10px] normal-case tracking-normal text-muted">
                {tabs.length}
              </span>
            </button>

            <Button
              size="icon"
              variant="ghost"
              className="mr-2 size-7 rounded-md"
              onClick={() => {
                setTabs((current) =>
                  [...current].sort((a, b) => {
                    const labelA = a.workspacePath.split('/').pop() ?? ''
                    const labelB = b.workspacePath.split('/').pop() ?? ''
                    return labelA.localeCompare(labelB)
                  })
                )
              }}
              aria-label="Sort alphabetically"
              title="Sort alphabetically"
            >
              <VscSortPrecedence className="size-4" />
            </Button>
          </div>

          {!agentsCollapsed ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-2 py-2">
                {tabs.length === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted">Sin agentes activos</div>
                ) : null}

                <DndContext
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleAgentDragEnd}
                >
                  <SortableContext items={tabs.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {tabs.map((tab) => {
                  const workspace = workspacesQuery.data?.find((w) => w.path === tab.workspacePath)
                  const workspaceLabel = workspace?.branch ?? workspace?.name ?? tab.workspacePath.split('/').pop() ?? 'workspace'
                  const projects = appConfigQuery.data?.projects ?? []
                  const ownerProject = projects.find((project) => {
                    if (tab.workspacePath === project.rootPath) return true
                    if (project.worktreeRoot && tab.workspacePath.startsWith(project.worktreeRoot)) return true
                    return false
                  })
                  const projectLabel = ownerProject?.name ?? ''
                  const headerLabel = projectLabel ? `${projectLabel} / ${workspaceLabel}` : workspaceLabel
                  const claudeInfo = tab.pid
                    ? claudeSessions.find((s) => s.shellPid === tab.pid) ?? null
                    : null
                  const isClaude = claudeInfo !== null || isClaudeProcess(tab.processName)
                  const isActive =
                    selectedWorkspacePath === tab.workspacePath &&
                    activeTabId[tab.workspacePath] === tab.id
                  const label = isClaude
                    ? (claudeInfo?.name ?? claudeInfo?.prompt ?? 'Claude')
                    : 'Terminal'

                  return (
                    <SortableAgentItem key={tab.id} id={tab.id}>
                      {({ listeners }) => (
                    <button
                      type="button"
                      onClick={() => handleSelectTab(tab)}
                      {...listeners}
                      className={cn(
                        'group flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1 text-left active:cursor-grabbing',
                        isActive ? 'bg-item-active text-foreground' : 'text-secondary hover:bg-item-hover'
                      )}
                    >
                      <span className="relative flex size-4 shrink-0 items-center justify-center text-icon">
                        {isClaude ? (
                          <span
                            className={cn(
                              'text-[10px] font-bold',
                              claudeInfo?.status === 'working' && 'text-green-400',
                              claudeInfo?.status === 'idle' && 'text-red-400'
                            )}
                          >
                            C
                          </span>
                        ) : (
                          <VscTerminalBash className="size-3.5" />
                        )}
                        {isClaude && claudeInfo ? (
                          <span
                            className={cn(
                              'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-sidebar',
                              claudeInfo.status === 'working' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                            )}
                            title={claudeInfo.status === 'working' ? 'Working...' : 'Needs input'}
                          />
                        ) : null}
                      </span>

                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block max-w-[220px] truncate text-[10px] uppercase tracking-[0.14em] text-muted">
                          {headerLabel}
                        </span>
                        <span className="block max-w-[220px] truncate text-xs">{label}</span>
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
                        className="ml-1 flex size-5 shrink-0 items-center justify-center rounded text-icon opacity-0 hover:bg-item-hover hover:text-foreground group-hover:opacity-100"
                      >
                        <VscClose className="size-3.5" />
                      </span>
                    </button>
                      )}
                    </SortableAgentItem>
                  )
                })}
                  </SortableContext>
                </DndContext>
              </div>
            </ScrollArea>
          ) : null}
        </aside>

        {/* Resize handle */}
        {sidebarOpen ? (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleSidebarResize}
            className="w-1 shrink-0 cursor-col-resize transition-colors hover:bg-focus-ring active:bg-focus-ring"
          />
        ) : null}

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
                const isClaude = claudeInfo !== null || isClaudeProcess(tab.processName)

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
                      {isClaude ? (
                        <span
                          className={cn(
                            'text-[10px] font-bold',
                            claudeInfo?.status === 'working' && 'text-green-400',
                            claudeInfo?.status === 'idle' && 'text-red-400'
                          )}
                        >
                          C
                        </span>
                      ) : (
                        <VscTerminalBash className="size-3.5" />
                      )}
                      {isClaude && claudeInfo ? (
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-surface',
                            claudeInfo.status === 'working' ? 'bg-green-400' : 'bg-red-400 animate-pulse'
                          )}
                          title={claudeInfo.status === 'working' ? 'Working...' : 'Needs input'}
                        />
                      ) : null}
                    </span>
                    <span className="truncate">
                      {isClaude
                        ? (claudeInfo?.name ?? claudeInfo?.prompt ?? 'Claude')
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
