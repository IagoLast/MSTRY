import { useEffect, useState } from 'react'

import { getElectronBridge } from '../lib/electron-bridge'
import { cn } from '../lib/utils'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [hooksEnabled, setHooksEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getElectronBridge()
      .claude.isHooksEnabled()
      .then(setHooksEnabled)
  }, [])

  const toggle = async () => {
    setBusy(true)
    const bridge = getElectronBridge()
    try {
      if (hooksEnabled) {
        await bridge.claude.disableHooks()
        setHooksEnabled(false)
      } else {
        await bridge.claude.enableHooks()
        setHooksEnabled(true)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24" onClick={onClose}>
      <div
        className="w-[420px] rounded-xl border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="text-sm font-medium">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Claude Code integration</p>
              <p className="mt-1 text-xs text-muted">
                Configura hooks en <code className="font-mono text-secondary">~/.claude/settings.json</code> para
                mostrar el nombre y estado de las sesiones de Claude en las tabs.
              </p>
            </div>

            <button
              type="button"
              disabled={hooksEnabled === null || busy}
              onClick={() => void toggle()}
              className={cn(
                'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50',
                hooksEnabled ? 'bg-purple-500' : 'bg-overlay-hover'
              )}
            >
              <span
                className={cn(
                  'inline-block size-3.5 rounded-full bg-white shadow transition-transform',
                  hooksEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                )}
              />
            </button>
          </div>

          {hooksEnabled ? (
            <div className="mt-3 rounded-lg bg-overlay px-3 py-2 text-xs text-secondary">
              Activo. Las tabs mostraran el nombre y estado (working / idle) de cada sesion de Claude.
            </div>
          ) : hooksEnabled === false ? (
            <div className="mt-3 rounded-lg bg-overlay px-3 py-2 text-xs text-muted">
              Desactivado. Las tabs solo mostraran el nombre del branch.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
