import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { spawn, type IPty } from 'node-pty'

import type {
  CreateTerminalSessionInput,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalProcessEvent
} from '../shared/contracts'

interface TerminalSession {
  id: string
  cwd: string
  shell: string
  process: IPty
  lastProcessName: string
  lastDataTimestamp: number
}

interface TerminalManagerEvents {
  data: [TerminalDataEvent]
  exit: [TerminalExitEvent]
  processChange: [TerminalProcessEvent]
}

const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }

  return process.env.SHELL ?? '/bin/zsh'
}

export class TerminalManager extends EventEmitter<TerminalManagerEvents> {
  private sessions = new Map<string, TerminalSession>()
  private activeSessionId: string | null = null

  setActiveSession(sessionId: string | null) {
    this.activeSessionId = sessionId
  }

  writeToActiveSession(data: string) {
    if (this.activeSessionId) {
      this.write(this.activeSessionId, data)
    }
  }
  private pollInterval: ReturnType<typeof setInterval> | null = null

  createSession(input: CreateTerminalSessionInput) {
    const id = randomUUID()
    const shell = getDefaultShell()
    const args = process.platform !== 'win32' ? ['--login'] : []
    const ptyProcess = spawn(shell, args, {
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color'
      },
      name: 'xterm-256color'
    })

    const session: TerminalSession = {
      id,
      cwd: input.cwd,
      shell,
      process: ptyProcess,
      lastProcessName: '',
      lastDataTimestamp: Date.now()
    }

    ptyProcess.onData((data) => {
      session.lastDataTimestamp = Date.now()
      this.emit('data', { sessionId: id, data })
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.emit('exit', { sessionId: id, exitCode })
      this.stopPollingIfEmpty()
    })

    this.sessions.set(id, session)
    this.startPolling()
    return id
  }

  getPid(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.process.pid ?? null
  }

  write(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    session.process.write(data)
  }

  resize(sessionId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    session.process.resize(cols, rows)
  }

  close(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    session.process.kill()
    this.sessions.delete(sessionId)
  }

  disposeAll() {
    this.stopPolling()
    for (const sessionId of this.sessions.keys()) {
      this.close(sessionId)
    }
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
        processName = session.process.process
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
