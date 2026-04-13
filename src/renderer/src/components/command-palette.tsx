import { useEffect, useRef, useState } from 'react'
import { VscClose, VscTerminalBash, VscAdd, VscTrash, VscSettingsGear, VscRefresh } from 'react-icons/vsc'

export interface CommandItem {
  id: string
  label: string
  shortcut?: string
  icon?: React.ReactNode
  onSelect: () => void
}

interface CommandPaletteProps {
  commands: CommandItem[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return
    }

    if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault()
      filtered[selectedIndex].onSelect()
      onClose()
    }
  }

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div
      className="no-drag fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="w-full max-w-[480px] overflow-hidden rounded-xl border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b px-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="h-11 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={onClose}
            className="no-drag flex size-6 items-center justify-center rounded text-muted hover:text-secondary"
            aria-label="Close menu"
          >
            <VscClose className="size-3.5" />
          </button>
        </div>

        <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">No results</div>
          ) : (
            filtered.map((cmd, index) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => {
                  cmd.onSelect()
                  onClose()
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                  index === selectedIndex
                    ? 'bg-item-active text-foreground'
                    : 'text-secondary hover:bg-item-hover'
                }`}
              >
                {cmd.icon ? (
                  <span className="flex size-5 items-center justify-center text-icon">
                    {cmd.icon}
                  </span>
                ) : null}
                <span className="flex-1">{cmd.label}</span>
                {cmd.shortcut ? (
                  <kbd className="rounded bg-overlay px-1.5 py-0.5 font-mono text-[11px] text-muted">
                    {cmd.shortcut}
                  </kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
