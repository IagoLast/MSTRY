import { cn } from '../../lib/utils'

interface Props {
  added: number
  deleted: number
  className?: string
}

export function GitDiffStats({ added, deleted, className }: Props) {
  if (added === 0 && deleted === 0) {
    return null
  }

  return (
    <span
      className={cn(
        'ml-auto flex shrink-0 items-center gap-1 pl-2 font-mono text-[10px] tabular-nums',
        className
      )}
    >
      {added > 0 ? <span className="text-green-500">+{added}</span> : null}
      {deleted > 0 ? <span className="text-red-500">-{deleted}</span> : null}
    </span>
  )
}
