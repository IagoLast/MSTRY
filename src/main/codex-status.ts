import { EventEmitter } from 'node:events'
import { mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

import type { CodexSessionInfo } from '../shared/contracts'

const STATUS_DIR = '/tmp/electree-codex'

interface RawSessionFile {
  session_id: string
  status: 'working' | 'idle'
  cwd: string
  transcript_path?: string
  shell_pid: number
  agent_pid: number
  prompt: string
}

interface CodexStatusEvents {
  change: [sessions: CodexSessionInfo[]]
}

export class CodexStatusWatcher extends EventEmitter<CodexStatusEvents> {
  private lastJson = ''
  private pollTimer: ReturnType<typeof setInterval> | null = null

  start() {
    mkdirSync(STATUS_DIR, { recursive: true })
    this.poll()
    this.pollTimer = setInterval(() => this.poll(), 2000)
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private poll() {
    let files: string[]
    try {
      files = readdirSync(STATUS_DIR).filter((file) => file.endsWith('.json'))
    } catch {
      return
    }

    const sessions: CodexSessionInfo[] = []

    for (const file of files) {
      const filePath = path.join(STATUS_DIR, file)

      try {
        const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as RawSessionFile

        if (!this.isPidAlive(raw.agent_pid)) {
          unlinkSync(filePath)
          continue
        }

        sessions.push({
          sessionId: raw.session_id,
          status: raw.status,
          cwd: raw.cwd,
          name: null,
          prompt: raw.prompt || null,
          shellPid: raw.shell_pid ?? 0
        })
      } catch {
        // skip malformed files
      }
    }

    const json = JSON.stringify(sessions)
    if (json !== this.lastJson) {
      this.lastJson = json
      this.emit('change', sessions)
    }
  }

  private isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false

    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}
