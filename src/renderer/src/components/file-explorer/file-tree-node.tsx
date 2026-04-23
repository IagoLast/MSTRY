import {
  VscChevronDown,
  VscChevronRight,
  VscFile,
  VscFolder,
  VscFolderOpened
} from 'react-icons/vsc'

import type { FileEntry } from '../../../../shared/contracts'
import { cn } from '../../lib/utils'
import { GitDiffStats } from './git-diff-stats'
import { statusColorClass, statusLetter, type StatusIndex } from './git-status-utils'
import { useDirectory } from './use-directory'

interface Props {
  entry: FileEntry
  depth: number
  workspacePath: string
  expanded: Set<string>
  onToggle: (relativePath: string) => void
  statusIndex: StatusIndex
}

export function FileTreeNode({
  entry,
  depth,
  workspacePath,
  expanded,
  onToggle,
  statusIndex
}: Props) {
  const isExpanded = expanded.has(entry.relativePath)
  const directoryQuery = useDirectory(
    workspacePath,
    entry.relativePath,
    entry.isDirectory && isExpanded
  )

  const fileStatus = statusIndex.fileIndex.get(entry.relativePath) ?? null
  const dirAggregate = entry.isDirectory
    ? statusIndex.dirIndex.get(entry.relativePath) ?? null
    : null

  const rowColor = fileStatus
    ? statusColorClass[fileStatus.status]
    : dirAggregate && dirAggregate.changedCount > 0
      ? 'text-foreground'
      : 'text-secondary'

  const showDirStats = entry.isDirectory && !isExpanded && dirAggregate
  const statsAdded = fileStatus?.added ?? (showDirStats ? dirAggregate!.added : 0)
  const statsDeleted = fileStatus?.deleted ?? (showDirStats ? dirAggregate!.deleted : 0)

  const handleClick = () => {
    if (entry.isDirectory) {
      onToggle(entry.relativePath)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          'group flex w-full min-w-0 items-center gap-1.5 py-0.5 pr-2 text-left text-sm hover:bg-item-hover',
          rowColor,
          fileStatus?.status === 'deleted' && 'line-through opacity-80',
          fileStatus?.status === 'ignored' && 'opacity-60'
        )}
        title={entry.relativePath}
      >
        {entry.isDirectory ? (
          isExpanded ? (
            <VscChevronDown className="size-3 shrink-0 text-muted" />
          ) : (
            <VscChevronRight className="size-3 shrink-0 text-muted" />
          )
        ) : (
          <span className="size-3 shrink-0" />
        )}

        {entry.isDirectory ? (
          isExpanded ? (
            <VscFolderOpened className="size-3.5 shrink-0 text-icon" />
          ) : (
            <VscFolder className="size-3.5 shrink-0 text-icon" />
          )
        ) : (
          <VscFile className="size-3.5 shrink-0 text-icon" />
        )}

        <span className="min-w-0 truncate">{entry.name}</span>

        {fileStatus ? (
          <span
            className={cn(
              'ml-1 shrink-0 font-mono text-[10px] font-semibold',
              statusColorClass[fileStatus.status]
            )}
          >
            {statusLetter[fileStatus.status]}
          </span>
        ) : null}

        <GitDiffStats added={statsAdded} deleted={statsDeleted} />
      </button>

      {entry.isDirectory && isExpanded
        ? directoryQuery.data?.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              workspacePath={workspacePath}
              expanded={expanded}
              onToggle={onToggle}
              statusIndex={statusIndex}
            />
          ))
        : null}
    </>
  )
}
