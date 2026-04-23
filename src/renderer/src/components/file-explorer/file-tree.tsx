import { FileTreeNode } from './file-tree-node'
import type { StatusIndex } from './git-status-utils'
import { useDirectory } from './use-directory'

interface Props {
  workspacePath: string
  expanded: Set<string>
  onToggle: (relativePath: string) => void
  statusIndex: StatusIndex
}

export function FileTree({ workspacePath, expanded, onToggle, statusIndex }: Props) {
  const rootQuery = useDirectory(workspacePath, '', true)

  if (rootQuery.isPending) {
    return <div className="px-3 py-2 text-xs text-muted">Cargando…</div>
  }

  if (rootQuery.isError) {
    return (
      <div className="px-3 py-2 text-xs text-error">
        {rootQuery.error instanceof Error ? rootQuery.error.message : 'Error al listar archivos.'}
      </div>
    )
  }

  if (!rootQuery.data || rootQuery.data.length === 0) {
    return <div className="px-3 py-2 text-xs text-muted">(vacio)</div>
  }

  return (
    <div className="flex flex-col py-1">
      {rootQuery.data.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          workspacePath={workspacePath}
          expanded={expanded}
          onToggle={onToggle}
          statusIndex={statusIndex}
        />
      ))}
    </div>
  )
}
