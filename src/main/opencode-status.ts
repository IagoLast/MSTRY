import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { OpenCodeSessionInfo } from '../shared/contracts'

const STATUS_DIR = '/tmp/electree-opencode'

interface RawSessionFile {
  sessionId: string
  status: 'working' | 'idle'
  cwd: string
  name: string | null
  shellPid: number
}

interface OpenCodeStatusEvents {
  change: [sessions: OpenCodeSessionInfo[]]
}

export class OpenCodeStatusWatcher extends EventEmitter<OpenCodeStatusEvents> {
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
      files = readdirSync(STATUS_DIR).filter((f) => f.endsWith('.json'))
    } catch {
      return
    }

    const sessions: OpenCodeSessionInfo[] = []

    for (const file of files) {
      try {
        const raw = JSON.parse(
          readFileSync(path.join(STATUS_DIR, file), 'utf-8')
        ) as RawSessionFile

        sessions.push({
          sessionId: raw.sessionId,
          status: raw.status,
          cwd: raw.cwd,
          name: raw.name,
          shellPid: raw.shellPid ?? 0
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
}
