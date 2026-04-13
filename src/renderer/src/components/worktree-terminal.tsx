import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'

import { getElectronBridge } from '../lib/electron-bridge'

const darkTheme: ITheme = {
  background: '#181818',
  foreground: '#d4d4d4',
  cursor: '#f3f4f6',
  cursorAccent: '#181818',
  selectionBackground: '#264f7840',
  black: '#181818',
  red: '#f28b82',
  green: '#b5cea8',
  yellow: '#dcdcaa',
  blue: '#9cdcfe',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#6a6a6a',
  brightRed: '#ff9da4',
  brightGreen: '#ce9178',
  brightYellow: '#f9f1a5',
  brightBlue: '#9cdcfe',
  brightMagenta: '#d7bae0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff'
}

const lightTheme: ITheme = {
  background: '#f5f5f6',
  foreground: '#1c1c1c',
  cursor: '#1c1c1c',
  cursorAccent: '#f5f5f6',
  selectionBackground: '#add6ff80',
  black: '#1c1c1c',
  red: '#cd3131',
  green: '#008000',
  yellow: '#795e26',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#1c1c1c'
}

const getTerminalTheme = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? darkTheme : lightTheme

interface WorktreeTerminalProps {
  active: boolean
  cwd: string
  initialCommand?: string
  /** When set, reattach to this existing tmux session instead of creating a new one. */
  tmuxSessionName?: string | null
  onNewTab?: () => void
  onCloseTab?: () => void
  onSessionCreated?: (sessionId: string, pid: number, tmuxSessionName: string) => void
}

export function WorktreeTerminal({ active, cwd, initialCommand, tmuxSessionName, onNewTab, onCloseTab, onSessionCreated }: WorktreeTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const activeRef = useRef(active)
  const onNewTabRef = useRef(onNewTab)
  const onCloseTabRef = useRef(onCloseTab)
  const onSessionCreatedRef = useRef(onSessionCreated)
  activeRef.current = active
  onNewTabRef.current = onNewTab
  onCloseTabRef.current = onCloseTab
  onSessionCreatedRef.current = onSessionCreated

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    let sessionId: string | null = null
    let disposed = false
    const electree = getElectronBridge()

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      macOptionIsMeta: true,
      fontFamily:
        '"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      fontWeight: '400',
      lineHeight: 1.35,
      letterSpacing: 0.1,
      scrollback: 10_000,
      theme: getTerminalTheme()
    })

    const fitAddon = new FitAddon()
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const copySelectionToClipboard = (event?: ClipboardEvent) => {
      const selection = terminal.getSelection()
      if (!selection) {
        return false
      }

      event?.preventDefault()
      event?.clipboardData?.setData('text/plain', selection)
      void electree.clipboard.writeText(selection)
      return true
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true
      }

      const key = event.key.toLowerCase()
      const isMacCopyShortcut =
        event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'c'
      const isShiftCopyShortcut =
        event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === 'c'

      if (isMacCopyShortcut || isShiftCopyShortcut) {
        if (copySelectionToClipboard()) {
          event.preventDefault()
          event.stopPropagation()
        }
        return false
      }

      // Only intercept Cmd (metaKey) shortcuts for tab management.
      // Ctrl key combos (Ctrl+R, Ctrl+W, etc.) must pass through to the terminal.
      if (!event.metaKey) {
        return true
      }

      // Let these Cmd shortcuts bubble up to the app-level hotkey handler
      if (
        key === 't' ||
        key === 'w' ||
        key === 'k' ||
        key === 'b' ||
        (event.shiftKey && key === 'c') ||
        (key >= '1' && key <= '9')
      ) {
        return false
      }

      return true
    })

    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    const handleCopy = (event: ClipboardEvent) => {
      if (!activeRef.current || !terminal.hasSelection()) {
        return
      }

      const activeElement = document.activeElement
      const terminalOwnsFocus =
        activeElement == null ||
        activeElement === document.body ||
        activeElement === document.documentElement ||
        (activeElement instanceof Element && containerRef.current?.contains(activeElement))

      if (!terminalOwnsFocus) {
        return
      }

      copySelectionToClipboard(event)
    }

    window.addEventListener('copy', handleCopy)

    requestAnimationFrame(() => {
      fitAddon.fit()
      terminal.focus()
    })

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handleThemeChange = () => {
      terminal.options.theme = getTerminalTheme()
    }
    mql.addEventListener('change', handleThemeChange)

    const offData = electree.terminal.onData((event) => {
      if (event.sessionId === sessionId) {
        terminal.write(event.data)
      }
    })

    const offExit = electree.terminal.onExit((event) => {
      if (event.sessionId === sessionId) {
        terminal.writeln(`\r\n[process exited with code ${event.exitCode ?? 0}]`)
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()

      if (sessionId && containerRef.current?.offsetParent) {
        void electree.terminal.resize(sessionId, terminal.cols, terminal.rows)
      }
    })

    resizeObserver.observe(containerRef.current)

    // Poll every 200ms to keep the terminal size in sync with the container,
    // since the initial fit may fire before the layout is fully resolved.
    let lastCols = terminal.cols
    let lastRows = terminal.rows
    const fitPollInterval = setInterval(() => {
      fitAddon.fit()
      if (sessionId && (terminal.cols !== lastCols || terminal.rows !== lastRows)) {
        lastCols = terminal.cols
        lastRows = terminal.rows
        void electree.terminal.resize(sessionId, terminal.cols, terminal.rows)
      }
    }, 200)

    const terminalInputDisposable = terminal.onData((data) => {
      if (sessionId) {
        void electree.terminal.write(sessionId, data)
      }
    })

    // Receive Ctrl+key combos forwarded from the main process (which intercepts
    // them via before-input-event to prevent Chromium from swallowing them).
    const offControlInput = electree.terminal.onControlInput((data) => {
      console.log('[control-input] received', JSON.stringify(data), { sessionId, active: activeRef.current })
      if (sessionId && activeRef.current) {
        console.log('[control-input] writing to PTY session', sessionId)
        void electree.terminal.write(sessionId, data)
      }
    })

    // Reattach to an existing tmux session or create a new one.
    const sessionPromise = tmuxSessionName
      ? electree.terminal
          .attachSession({ tmuxSessionName, cols: terminal.cols, rows: terminal.rows })
          .then((r) => ({ ...r, tmuxSessionName }))
      : electree.terminal.createSession({ cwd, cols: terminal.cols, rows: terminal.rows })

    void sessionPromise
      .then((result) => {
        if (disposed) {
          return
        }

        sessionId = result.sessionId
        sessionIdRef.current = result.sessionId
        if (activeRef.current) {
          void electree.terminal.setActiveSession(result.sessionId)
        }
        onSessionCreatedRef.current?.(result.sessionId, result.pid, result.tmuxSessionName)

        if (!tmuxSessionName && initialCommand) {
          void electree.terminal.write(result.sessionId, initialCommand + '\n')
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'No se pudo abrir la terminal.'
        terminal.writeln(`\r\n${message}`)
      })

    return () => {
      disposed = true
      clearInterval(fitPollInterval)
      mql.removeEventListener('change', handleThemeChange)
      resizeObserver.disconnect()
      offData()
      offExit()
      offControlInput()
      terminalInputDisposable.dispose()
      window.removeEventListener('copy', handleCopy)

      if (sessionId) {
        void electree.terminal.detach(sessionId)
      }

      terminal.dispose()

      terminalRef.current = null
      fitAddonRef.current = null
      sessionIdRef.current = null
    }
  }, [cwd, initialCommand, tmuxSessionName])

  useEffect(() => {
    if (!active) {
      return
    }

    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current

    if (!terminal || !fitAddon) {
      return
    }

    const electree = getElectronBridge()

    const sid = sessionIdRef.current
    if (sid) {
      void electree.terminal.setActiveSession(sid)
    }

    requestAnimationFrame(() => {
      fitAddon.fit()
      terminal.focus()

      if (sid) {
        void electree.terminal.resize(sid, terminal.cols, terminal.rows)
      }
    })
  }, [active])

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
}
