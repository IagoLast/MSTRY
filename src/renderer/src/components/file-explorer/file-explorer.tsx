import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { VscChevronDown, VscChevronRight, VscRefresh } from 'react-icons/vsc'

import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '../../lib/utils'
import { FileTree } from './file-tree'
import { buildStatusIndex } from './git-status-utils'
import { useGitStatus } from './use-git-status'

interface Props {
  workspacePath: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function FileExplorer({ workspacePath, collapsed, onToggleCollapsed }: Props) {
  const queryClient = useQueryClient()
  const [expandedByWorkspace, setExpandedByWorkspace] = useState<Map<string, Set<string>>>(
    () => new Map()
  )
  const gitStatusQuery = useGitStatus(workspacePath)

  const statusIndex = useMemo(
    () => buildStatusIndex(gitStatusQuery.data ?? []),
    [gitStatusQuery.data]
  )

  const expanded = useMemo(
    () => (workspacePath ? expandedByWorkspace.get(workspacePath) ?? new Set<string>() : new Set<string>()),
    [expandedByWorkspace, workspacePath]
  )

  const handleToggle = useCallback(
    (relativePath: string) => {
      if (!workspacePath) return
      setExpandedByWorkspace((current) => {
        const next = new Map(current)
        const currentSet = next.get(workspacePath) ?? new Set<string>()
        const nextSet = new Set(currentSet)
        if (nextSet.has(relativePath)) {
          nextSet.delete(relativePath)
        } else {
          nextSet.add(relativePath)
        }
        next.set(workspacePath, nextSet)
        return next
      })
    },
    [workspacePath]
  )

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['files'] })
  }, [queryClient])

  const changedCount = gitStatusQuery.data?.length ?? 0

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col border-t',
        collapsed ? 'shrink-0' : 'min-h-0 flex-1'
      )}
    >
      <div className="flex h-9 shrink-0 items-center border-b">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-4 text-sm uppercase tracking-[0.18em] text-muted hover:text-secondary"
        >
          {collapsed ? (
            <VscChevronRight className="size-3.5" />
          ) : (
            <VscChevronDown className="size-3.5" />
          )}
          Files
          {changedCount > 0 ? (
            <span className="ml-1 font-mono text-sm normal-case tracking-normal text-muted">
              {changedCount}
            </span>
          ) : null}
        </button>

        <Button
          size="icon"
          variant="ghost"
          className="mr-2 size-7 rounded-md"
          onClick={handleRefresh}
          aria-label="Refresh files"
          title="Refresh files"
        >
          <VscRefresh className="size-4" />
        </Button>
      </div>

      {!collapsed ? (
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          {workspacePath ? (
            <FileTree
              workspacePath={workspacePath}
              expanded={expanded}
              onToggle={handleToggle}
              statusIndex={statusIndex}
            />
          ) : (
            <div className="px-4 py-3 text-xs text-muted">Selecciona un agente</div>
          )}
        </ScrollArea>
      ) : null}
    </div>
  )
}
