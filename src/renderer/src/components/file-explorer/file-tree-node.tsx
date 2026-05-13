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
import {
  directoryStatusColorClass,
  directoryTreeRowClass,
  statusColorClass,
  statusLetter,
  statusTreeRowClass,
  type StatusIndex
} from './git-status-utils'
import { useDirectory } from './use-directory'

interface Props {
  entry: FileEntry
  depth: number
  workspacePath: string
  expanded: Set<string>
  onToggle: (relativePath: string) => void
  statusIndex: StatusIndex
  selectedFilePath: string | null
  onSelectFile: (filePath: string) => void
}

export function FileTreeNode({
  entry,
  depth,
  workspacePath,
  expanded,
  onToggle,
  statusIndex,
  selectedFilePath,
  onSelectFile
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
  const hasDirectoryChanges = Boolean(dirAggregate && dirAggregate.changedCount > 0)

  const isSelected = !entry.isDirectory && entry.path === selectedFilePath
  const rowColor = fileStatus
    ? statusColorClass[fileStatus.status]
    : hasDirectoryChanges
      ? directoryStatusColorClass
      : 'text-secondary'
  const rowStateClass = isSelected ? 'bg-item-active text-foreground' : rowColor
  const gitRowClass = fileStatus
    ? statusTreeRowClass[fileStatus.status]
    : hasDirectoryChanges
      ? directoryTreeRowClass
      : null

  const showDirStats = entry.isDirectory && !isExpanded && dirAggregate
  const statsAdded = fileStatus?.added ?? (showDirStats ? dirAggregate!.added : 0)
  const statsDeleted = fileStatus?.deleted ?? (showDirStats ? dirAggregate!.deleted : 0)

  const handleClick = () => {
    if (entry.isDirectory) {
      onToggle(entry.relativePath)
      return
    }

    onSelectFile(entry.path)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          'group flex w-full min-w-0 items-center gap-1.5 border-l-2 border-transparent py-0.5 pr-2 text-left text-sm hover:bg-item-hover',
          gitRowClass,
          rowStateClass,
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
            <VscFolderOpened
              className={cn(
                'size-3.5 shrink-0',
                hasDirectoryChanges ? directoryStatusColorClass : 'text-icon'
              )}
            />
          ) : (
            <VscFolder
              className={cn(
                'size-3.5 shrink-0',
                hasDirectoryChanges ? directoryStatusColorClass : 'text-icon'
              )}
            />
          )
        ) : (
          <VscFile
            className={cn(
              'size-3.5 shrink-0',
              fileStatus ? statusColorClass[fileStatus.status] : 'text-icon'
            )}
          />
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
              selectedFilePath={selectedFilePath}
              onSelectFile={onSelectFile}
            />
          ))
        : null}
    </>
  )
}
