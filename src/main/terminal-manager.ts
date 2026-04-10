import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { spawn, type IPty } from 'node-pty'

import type {
  CreateTerminalSessionInput,
  TerminalDataEvent,
  TerminalExitEvent
} from '../shared/contracts'

interface TerminalSession {
  id: string
  cwd: string
  shell: string
  process: IPty
}

interface TerminalManagerEvents {
  data: [TerminalDataEvent]
  exit: [TerminalExitEvent]
}

const getDefaultShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }

  return process.env.SHELL ?? '/bin/zsh'
}

export class TerminalManager extends EventEmitter<TerminalManagerEvents> {
  private sessions = new Map<string, TerminalSession>()
  private sessionsByCwd = new Map<string, string>()

  createSession(input: CreateTerminalSessionInput) {
    const normalizedCwd = input.cwd
    const existingSessionId = this.sessionsByCwd.get(normalizedCwd)

    if (existingSessionId) {
      const existingSession = this.sessions.get(existingSessionId)
      if (existingSession) {
        existingSession.process.resize(input.cols, input.rows)
        return existingSession.id
      }

      this.sessionsByCwd.delete(normalizedCwd)
    }

    const id = randomUUID()
    const shell = getDefaultShell()
    const ptyProcess = spawn(shell, [], {
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color'
      },
      name: 'xterm-color'
    })

    const session: TerminalSession = {
      id,
      cwd: input.cwd,
      shell,
      process: ptyProcess
    }

    ptyProcess.onData((data) => {
      this.emit('data', { sessionId: id, data })
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.sessionsByCwd.delete(session.cwd)
      this.emit('exit', { sessionId: id, exitCode })
    })

    this.sessions.set(id, session)
    this.sessionsByCwd.set(normalizedCwd, id)
    return id
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
    this.sessionsByCwd.delete(session.cwd)
  }

  disposeAll() {
    for (const sessionId of this.sessions.keys()) {
      this.close(sessionId)
    }
  }
}
