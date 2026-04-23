import type { GitFileStatus, GitFileStatusEntry } from '../../../../shared/contracts'

export const statusColorClass: Record<GitFileStatus, string> = {
  untracked: 'text-green-500',
  added: 'text-green-500',
  modified: 'text-yellow-500',
  typechange: 'text-yellow-500',
  deleted: 'text-red-500',
  renamed: 'text-blue-500',
  conflicted: 'text-orange-500',
  ignored: 'text-muted'
}

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
