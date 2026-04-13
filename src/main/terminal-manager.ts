import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'

import { spawn, type IPty } from 'node-pty'

import type {
  CreateTerminalSessionInput,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalProcessEvent
} from '../shared/contracts'

const TMUX_SOCKET = 'electree'

// Minimal tmux config that hides the status bar.
const TMUX_CONF = join(tmpdir(), 'electree-tmux.conf')
writeFileSync(
  TMUX_CONF,
  [
    'set-option -g status off',
    // Fallback: if status ever flickers on, make it invisible (transparent bg, no text).
    'set-option -g status-style "bg=default,fg=default"',
    'set-option -g status-left ""',
    'set-option -g status-right ""',
    // Disable the tmux prefix key so it doesn't intercept terminal input.
    // Without this, Ctrl+B activates tmux command mode and swallows the next key.
    'set-option -g prefix None',
    'unbind-key C-b',
    // Mouse is OFF by default — xterm.js handles scrollback natively.
    // Toggle with Cmd+M when apps like vim/claude need mouse scroll.
    'set-option -g mouse off',
    ''
  ].join('\n')
)

/** Common tmux args: force UTF-8 (-u), use our socket and our minimal config. */
const TMUX_BASE_ARGS = ['-u', '-L', TMUX_SOCKET, '-f', TMUX_CONF]

/**
 * Env with UTF-8 locale guaranteed — Electron launched from Finder often lacks LANG.
 * Computed lazily so it picks up PATH fixes applied after module load (fixPath()
 * runs in app.whenReady, but this module is imported earlier).
 */
const getTmuxEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  LANG: process.env.LANG ?? 'en_US.UTF-8',
  LC_ALL: process.env.LC_ALL ?? 'en_US.UTF-8',
  LC_CTYPE: process.env.LC_CTYPE ?? 'en_US.UTF-8'
})

interface TerminalSession {
  id: string
  tmuxSessionName: string
  cwd: string
  process: IPty
  lastProcessName: string
  lastDataTimestamp: number
}

interface TerminalManagerEvents {
  data: [TerminalDataEvent]
  exit: [TerminalExitEvent]
  processChange: [TerminalProcessEvent]
}

interface TmuxSessionInfo {
  name: string
  attached: boolean
}

export class TerminalManager extends EventEmitter<TerminalManagerEvents> {
  private sessions = new Map<string, TerminalSession>()
  private activeSessionId: string | null = null
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private mouseEnabled = false

  setActiveSession(sessionId: string | null) {
    this.activeSessionId = sessionId
  }

  writeToActiveSession(data: string) {
    if (this.activeSessionId) {
      this.write(this.activeSessionId, data)
    }
  }

  /** Create a new tmux session and attach to it via PTY. */
  createSession(input: CreateTerminalSessionInput): { id: string; tmuxSessionName: string } {
    const id = randomUUID()
    const tmuxSessionName = `electree_${id.slice(0, 8)}`

    // Create a detached tmux session in the requested cwd.
    execFileSync(
      'tmux',
      [
        ...TMUX_BASE_ARGS,
        'new-session',
        '-d',
        '-s',
        tmuxSessionName,
        '-c',
        input.cwd,
        '-x',
        String(input.cols),
        '-y',
        String(input.rows)
      ],
      { env: getTmuxEnv() }
    )

    const ptyProcess = this.spawnAttach(tmuxSessionName, input.cols, input.rows)

    const session: TerminalSession = {
      id,
      tmuxSessionName,
      cwd: input.cwd,
      process: ptyProcess,
      lastProcessName: '',
      lastDataTimestamp: Date.now()
    }

    this.wireSession(session)
    return { id, tmuxSessionName }
  }

  /** Reattach to an existing tmux session that survived a restart. */
  attachSession(
    tmuxSessionName: string,
    cols: number,
    rows: number
  ): { id: string } {
    const id = randomUUID()
    const ptyProcess = this.spawnAttach(tmuxSessionName, cols, rows)

    const session: TerminalSession = {
      id,
      tmuxSessionName,
      cwd: '',
      process: ptyProcess,
      lastProcessName: '',
      lastDataTimestamp: Date.now()
    }

    this.wireSession(session)
    return { id }
  }

  /** List tmux sessions alive on the electree socket. */
  listTmuxSessions(): string[] {
    return this.listTmuxSessionInfo().map((session) => session.name)
  }

  /**
   * Drop detached tmux sessions that do not belong to the current runtime or
   * to the set of tabs restored from disk.
   */
  pruneOrphanedSessions(keepSessionNames: string[]) {
    const keep = new Set(keepSessionNames)
    for (const session of this.sessions.values()) {
      keep.add(session.tmuxSessionName)
    }

    for (const session of this.listTmuxSessionInfo()) {
      if (session.attached || keep.has(session.name)) {
        continue
      }

      this.destroyTmuxSession(session.name)
    }
  }

  /** List tmux sessions alive on the electree socket with attachment state. */
  private listTmuxSessionInfo(): TmuxSessionInfo[] {
    try {
      const output = execFileSync(
        'tmux',
        [...TMUX_BASE_ARGS, 'list-sessions', '-F', '#{session_name}\t#{session_attached}'],
        {
          encoding: 'utf8',
          env: getTmuxEnv()
        }
      )

      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, attached] = line.split('\t')
          return {
            name,
            attached: attached === '1'
          }
        })
    } catch {
      return []
    }
  }

  getPid(sessionId: string): number | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    // Return the PID of the shell running inside the tmux pane, not the
    // PID of the local `tmux attach` process.  This must match the
    // shell_pid reported by the Claude hook so that tabs can be associated
    // with Claude sessions.
    try {
      const output = execFileSync(
        'tmux',
        [
          ...TMUX_BASE_ARGS,
          'list-panes',
          '-t',
          session.tmuxSessionName,
          '-F',
          '#{pane_pid}'
        ],
        { encoding: 'utf8' }
      )
      const pid = parseInt(output.trim().split('\n')[0], 10)
      if (!isNaN(pid)) return pid
    } catch {
      // fall through
    }

    return session.process.pid ?? null
  }

  getTmuxSessionName(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.tmuxSessionName ?? null
  }

  write(sessionId: string, data: string) {
    this.sessions.get(sessionId)?.process.write(data)
  }

  /** Toggle tmux mouse mode globally. Returns the new state. */
  toggleMouse(): boolean {
    this.mouseEnabled = !this.mouseEnabled
    const value = this.mouseEnabled ? 'on' : 'off'
    try {
      execFileSync('tmux', [...TMUX_BASE_ARGS, 'set-option', '-g', 'mouse', value], {
        env: getTmuxEnv()
      })
    } catch {
      // tmux server may not be running yet
    }
    return this.mouseEnabled
  }

  isMouseEnabled(): boolean {
    return this.mouseEnabled
  }

  resize(sessionId: string, cols: number, rows: number) {
    this.sessions.get(sessionId)?.process.resize(cols, rows)
  }

  /** Detach the PTY wrapper without killing the underlying tmux session. */
  detach(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.process.kill()
    this.sessions.delete(sessionId)
    this.stopPollingIfEmpty()
  }

  /** Kill a tmux session entirely (user intentionally closed the tab). */
  destroyTmuxSession(tmuxSessionName: string) {
    try {
      execFileSync('tmux', [...TMUX_BASE_ARGS, 'kill-session', '-t', tmuxSessionName], {
        env: getTmuxEnv()
      })
    } catch {
      // Session may already be dead — that's fine.
    }
  }

  /** Detach all PTYs without killing tmux sessions (app quit / reload). */
  disposeAll() {
    this.stopPolling()
    for (const sessionId of [...this.sessions.keys()]) {
      this.detach(sessionId)
    }
  }

  // -- private helpers -------------------------------------------------------

  private spawnAttach(tmuxSessionName: string, cols: number, rows: number): IPty {
    // Always force status bar off — the -f config is only read on first server
    // start, so an already-running server would ignore it.
    try {
      execFileSync('tmux', [...TMUX_BASE_ARGS, 'set-option', '-g', 'status', 'off'], {
        env: getTmuxEnv()
      })
      execFileSync('tmux', [...TMUX_BASE_ARGS, 'set-option', '-g', 'mouse', this.mouseEnabled ? 'on' : 'off'], {
        env: getTmuxEnv()
      })
    } catch {
      // Server may not be up yet — new-session will start it with the config.
    }

    return spawn('tmux', [...TMUX_BASE_ARGS, 'attach-session', '-t', tmuxSessionName], {
      cols,
      rows,
      env: {
        ...getTmuxEnv(),
        TERM: 'xterm-256color'
      },
      name: 'xterm-256color',
      encoding: 'utf8'
    })
  }

  private wireSession(session: TerminalSession) {
    session.process.onData((data) => {
      session.lastDataTimestamp = Date.now()
      this.emit('data', { sessionId: session.id, data })
    })

    session.process.onExit(({ exitCode }) => {
      this.sessions.delete(session.id)
      this.emit('exit', { sessionId: session.id, exitCode })
      this.stopPollingIfEmpty()
    })

    this.sessions.set(session.id, session)
    this.startPolling()
  }

  private startPolling() {
    if (this.pollInterval) return
    this.pollInterval = setInterval(() => this.pollProcessNames(), 2000)
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  private stopPollingIfEmpty() {
    if (this.sessions.size === 0) {
      this.stopPolling()
    }
  }

  private pollProcessNames() {
    for (const session of this.sessions.values()) {
      let processName: string
      try {
        // Query the tmux pane's foreground process — more accurate than
        // node-pty's .process which would just return "tmux".
        const output = execFileSync(
          'tmux',
          [
            ...TMUX_BASE_ARGS,
            'list-panes',
            '-t',
            session.tmuxSessionName,
            '-F',
            '#{pane_current_command}'
          ],
          { encoding: 'utf8' }
        )
        processName = output.trim().split('\n')[0] ?? ''
      } catch {
        continue
      }

      if (processName !== session.lastProcessName) {
        session.lastProcessName = processName
        this.emit('processChange', { sessionId: session.id, processName })
      }
    }
  }
}
