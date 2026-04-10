import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  VscAdd,
  VscChevronDown,
  VscChevronRight,
  VscFolder,
  VscFolderOpened,
  VscRefresh,
  VscRepo,
  VscSourceControl,
  VscTerminalBash,
  VscTrash
} from 'react-icons/vsc'

import type { Project, WorkspaceItem } from '../../shared/contracts'
import { WorktreeTerminal } from './components/worktree-terminal'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { ScrollArea } from './components/ui/scroll-area'
import { getElectronBridge } from './lib/electron-bridge'
import { cn } from './lib/utils'

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

const getWorkspaceMeta = (item: WorkspaceItem) => {
  if (item.kind === 'directory') {
    return 'folder'
  }

  if (item.isMain) {
    return 'main'
  }

  return item.branch ?? 'worktree'
}

export function App() {
  const queryClient = useQueryClient()
  const { selectedWorkspacePath, setSelectedWorkspacePath } = useSelectedWorkspace()
  const [newWorktreeName, setNewWorktreeName] = useState('')
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [openedTerminalPaths, setOpenedTerminalPaths] = useState<string[]>([])
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [worktreesCollapsed, setWorktreesCollapsed] = useState(false)

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
      setShowCreateInput(false)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const removeProjectMutation = useMutation({
    mutationFn: (project: Project) => getElectronBridge().workspace.removeProject(project.rootPath),
    onSuccess: (config, removedProject) => {
      queryClient.setQueryData(['app-config'], config)
      setOpenedTerminalPaths((current) =>
        current.filter((terminalPath) => {
          if (terminalPath === removedProject.rootPath) {
            return false
          }

          if (removedProject.worktreeRoot && terminalPath.startsWith(removedProject.worktreeRoot)) {
            return false
          }

          return true
        })
      )
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const createWorktreeMutation = useMutation({
    mutationFn: (name: string) => getElectronBridge().worktrees.create({ name }),
    onSuccess: (workspace) => {
      setNewWorktreeName('')
      setShowCreateInput(false)
      setSelectedWorkspacePath(workspace.path)
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

  const removeWorktreeMutation = useMutation({
    mutationFn: (workspacePath: string) => getElectronBridge().worktrees.remove({ path: workspacePath }),
    onSuccess: (_value, workspacePath) => {
      if (selectedWorkspacePath === workspacePath) {
        setSelectedWorkspacePath(null)
      }

      setOpenedTerminalPaths((current) => current.filter((path) => path !== workspacePath))
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    }
  })

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

    setOpenedTerminalPaths((current) =>
      current.includes(selectedWorkspacePath) ? current : [...current, selectedWorkspacePath]
    )
  }, [selectedWorkspacePath])

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

  const handleCreateWorktree = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await createWorktreeMutation.mutateAsync(newWorktreeName)
  }

  const handleDeleteProject = async (project: Project) => {
    if (!window.confirm(`Quitar ${project.name} de la lista de proyectos.`)) {
      return
    }

    await removeProjectMutation.mutateAsync(project)
  }

  const handleDeleteWorktree = async (workspace: WorkspaceItem) => {
    if (
      !window.confirm(
        `Borrar ${workspace.branch ?? workspace.name}.\n\nGit bloqueara la operacion si hay cambios sin guardar en ese worktree.`
      )
    ) {
      return
    }

    await removeWorktreeMutation.mutateAsync(workspace.path)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex h-screen max-w-[1680px] overflow-hidden">
        <aside className="flex w-[340px] shrink-0 flex-col border-r bg-sidebar">
          {/* Drag region for macOS traffic lights */}
          <div className="drag-region h-11 shrink-0 pl-[78px]">
            <div className="no-drag flex h-full items-center gap-1 border-b px-2">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void pickProjectMutation.mutateAsync()}
                aria-label="Open folder"
                title="Open folder"
              >
                <VscFolderOpened className="size-4" />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={handleRefresh}
                aria-label="Refresh"
                title="Refresh"
              >
                <VscRefresh className="size-4" />
              </Button>
            </div>
          </div>

          {configErrorMessage ? (
            <div className="border-b border-red-500/10 bg-red-500/[0.06] px-4 py-2.5 text-xs text-error">
              {configErrorMessage}
            </div>
          ) : null}

          <div className="border-b">
            <button
              type="button"
              onClick={() => setProjectsCollapsed((c) => !c)}
              className="flex h-9 w-full items-center gap-2 px-4 text-[11px] uppercase tracking-[0.18em] text-muted hover:text-secondary"
            >
              {projectsCollapsed ? (
                <VscChevronRight className="size-3.5" />
              ) : (
                <VscChevronDown className="size-3.5" />
              )}
              Projects
            </button>

            {!projectsCollapsed ? (
              <ScrollArea className="max-h-[220px]">
                <div className="px-2 pb-2">
                  {appConfigQuery.data?.projects.map((project) => {
                    const isActive = project.rootPath === activeProject?.rootPath

                    return (
                      <div
                        key={project.rootPath}
                        className={cn(
                          'group flex items-center gap-2 rounded-md px-2 py-1.5',
                          isActive ? 'bg-item-active text-foreground' : 'text-secondary hover:bg-item-hover'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void selectProjectMutation.mutateAsync(project.rootPath)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-overlay text-icon">
                            {project.mode === 'git' ? (
                              <VscRepo className="size-4" />
                            ) : (
                              <VscFolder className="size-4" />
                            )}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{project.name}</span>
                            <span className="block truncate text-[11px] uppercase tracking-[0.16em] text-muted">
                              {project.mode === 'git' ? 'repo' : 'folder'}
                            </span>
                          </span>
                        </button>

                        {isActive && isGitProject ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 rounded-md opacity-0 group-hover:opacity-100"
                            onClick={() => setShowCreateInput((current) => !current)}
                            aria-label="Create worktree"
                            title="Create worktree"
                          >
                            <VscAdd className="size-4" />
                          </Button>
                        ) : null}

                        {appConfigQuery.data.projects.length > 1 ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 rounded-md opacity-0 group-hover:opacity-100"
                            onClick={() => void handleDeleteProject(project)}
                            aria-label={`Quitar ${project.name}`}
                            title="Quitar proyecto"
                          >
                            <VscTrash className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            ) : null}
          </div>

          {showCreateInput && isGitProject ? (
            <div className="border-b px-3 py-3">
              <form className="flex items-center gap-2" onSubmit={handleCreateWorktree}>
                <Input
                  value={newWorktreeName}
                  onChange={(event) => setNewWorktreeName(event.target.value)}
                  placeholder="feature/nuevo-worktree"
                  className="h-9 rounded-lg text-sm"
                  disabled={createWorktreeMutation.isPending}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={createWorktreeMutation.isPending || !newWorktreeName.trim()}
                >
                  Crear
                </Button>
              </form>
            </div>
          ) : null}

          {worktreeErrorMessage ? (
            <div className="border-b border-red-500/10 bg-red-500/[0.06] px-4 py-2.5 text-xs text-error">
              {worktreeErrorMessage}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setWorktreesCollapsed((c) => !c)}
            className="flex h-9 shrink-0 items-center gap-2 border-b px-4 text-[11px] uppercase tracking-[0.18em] text-muted hover:text-secondary"
          >
            {worktreesCollapsed ? (
              <VscChevronRight className="size-3.5" />
            ) : (
              <VscChevronDown className="size-3.5" />
            )}
            {isGitProject ? 'Worktrees' : 'Workspace'}
          </button>

          {!worktreesCollapsed ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-2 py-2">
                {workspacesQuery.isPending ? (
                  <div className="px-2 py-2 text-sm text-muted">Loading...</div>
                ) : null}

                {!workspacesQuery.isPending && (workspacesQuery.data?.length ?? 0) === 0 ? (
                  <div className="px-2 py-2 text-sm text-muted">No items</div>
                ) : null}

                {workspacesQuery.data?.map((item) => {
                  const isSelected = selectedWorkspacePath === item.path
                  const canDelete = item.kind === 'worktree' && !item.isMain

                  return (
                    <div
                      key={item.path}
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1.5',
                        isSelected ? 'bg-item-active text-foreground' : 'text-secondary hover:bg-item-hover'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedWorkspacePath(item.path)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-overlay text-icon">
                          {item.kind === 'directory' ? (
                            <VscFolder className="size-4" />
                          ) : (
                            <VscSourceControl className="size-4" />
                          )}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{item.name}</span>
                          <span className="block truncate text-[11px] uppercase tracking-[0.16em] text-muted">
                            {getWorkspaceMeta(item)}
                          </span>
                        </span>
                      </button>

                      {canDelete ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 rounded-md opacity-0 group-hover:opacity-100"
                          onClick={() => void handleDeleteWorktree(item)}
                          aria-label={`Borrar ${item.name}`}
                          title="Borrar worktree"
                        >
                          <VscTrash className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-surface">
          <div className="flex h-11 items-center justify-between gap-4 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <VscTerminalBash className="size-4 shrink-0 text-icon" />
              <span className="truncate text-sm text-foreground">
                {selectedWorkspace?.branch ?? selectedWorkspace?.name ?? activeProject?.name ?? 'Terminal'}
              </span>
            </div>

            <div className="truncate text-xs text-muted">
              {selectedWorkspace?.path ?? activeProject?.rootPath ?? 'No project selected'}
            </div>
          </div>

          <div className="min-h-0 flex-1 p-2">
            {openedTerminalPaths.length > 0 ? (
              <div className="relative h-full overflow-hidden rounded-md border bg-terminal">
                {openedTerminalPaths.map((workspacePath) => (
                  <div
                    key={workspacePath}
                    className={cn(
                      'absolute inset-0',
                      workspacePath === selectedWorkspacePath ? 'block' : 'hidden'
                    )}
                  >
                    <WorktreeTerminal
                      active={workspacePath === selectedWorkspacePath}
                      cwd={workspacePath}
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
    </div>
  )
}
