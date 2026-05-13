import type { GitFileStatus, GitFileStatusEntry } from '../../../../shared/contracts'

export const statusColorClass: Record<GitFileStatus, string> = {
  untracked: 'text-[color:var(--git-added-fg)]',
  added: 'text-[color:var(--git-added-fg)]',
  modified: 'text-[color:var(--git-modified-fg)]',
  typechange: 'text-[color:var(--git-modified-fg)]',
  deleted: 'text-[color:var(--git-deleted-fg)]',
  renamed: 'text-[color:var(--git-renamed-fg)]',
  conflicted: 'text-[color:var(--git-conflicted-fg)]',
  ignored: 'text-muted'
}

export const statusTreeRowClass: Record<GitFileStatus, string> = {
  untracked: 'git-change-row git-change-row--added',
  added: 'git-change-row git-change-row--added',
  modified: 'git-change-row git-change-row--modified',
  typechange: 'git-change-row git-change-row--modified',
  deleted: 'git-change-row git-change-row--deleted',
  renamed: 'git-change-row git-change-row--renamed',
  conflicted: 'git-change-row git-change-row--conflicted',
  ignored: ''
}

export const directoryStatusColorClass = 'text-[color:var(--git-directory-fg)]'
export const directoryTreeRowClass = 'git-change-row git-change-row--directory'

export const statusLetter: Record<GitFileStatus, string> = {
  untracked: 'U',
  added: 'A',
  modified: 'M',
  typechange: 'T',
  deleted: 'D',
  renamed: 'R',
  conflicted: '!',
  ignored: 'I'
}

export interface DirAggregate {
  added: number
  deleted: number
  changedCount: number
}

export interface StatusIndex {
  fileIndex: Map<string, GitFileStatusEntry>
  dirIndex: Map<string, DirAggregate>
}

export const buildStatusIndex = (entries: GitFileStatusEntry[]): StatusIndex => {
  const fileIndex = new Map<string, GitFileStatusEntry>()
  const dirIndex = new Map<string, DirAggregate>()

  for (const entry of entries) {
    fileIndex.set(entry.relativePath, entry)

    const segments = entry.relativePath.split('/')
    for (let depth = 1; depth < segments.length; depth += 1) {
      const dirPath = segments.slice(0, depth).join('/')
      const current = dirIndex.get(dirPath) ?? { added: 0, deleted: 0, changedCount: 0 }
      current.added += entry.added
      current.deleted += entry.deleted
      current.changedCount += 1
      dirIndex.set(dirPath, current)
    }
  }

  return { fileIndex, dirIndex }
}
