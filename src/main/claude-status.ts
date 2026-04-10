import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { ClaudeSessionInfo } from '../shared/contracts'

const STATUS_DIR = '/tmp/electree-claude'

interface RawSessionFile {
  session_id: string
  status: 'working' | 'idle'
  cwd: string
  transcript_path: string
  shell_pid: number
  prompt: string
}

interface ClaudeStatusEvents {
  change: [sessions: ClaudeSessionInfo[]]
}

export class ClaudeStatusWatcher extends EventEmitter<ClaudeStatusEvents> {
  private lastJson = ''
  private nameCache = new Map<string, string>()
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

    const sessions: ClaudeSessionInfo[] = []

    for (const file of files) {
      try {
        const raw = JSON.parse(
          readFileSync(path.join(STATUS_DIR, file), 'utf-8')
        ) as RawSessionFile

        sessions.push({
          sessionId: raw.session_id,
          status: raw.status,
          cwd: raw.cwd,
          name: this.resolveSessionName(raw.session_id, raw.transcript_path) ?? null,
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

  private resolveSessionName(sessionId: string, transcriptPath: string): string | undefined {
    if (this.nameCache.has(sessionId)) {
      return this.nameCache.get(sessionId)
    }

    if (!transcriptPath) return undefined

    try {
      const projectDir = path.dirname(transcriptPath)
      const indexPath = path.join(projectDir, 'sessions-index.json')
      if (!existsSync(indexPath)) return undefined

      const content = readFileSync(indexPath, 'utf-8')
      const parsed = JSON.parse(content)

      const sessions: { id?: string; name?: string; auto_generated_summary?: string }[] =
        Array.isArray(parsed) ? parsed : parsed.sessions ?? []

      const match = sessions.find((s) => s.id === sessionId)
      if (!match) return undefined

      const name = match.name || match.auto_generated_summary || undefined
      if (name) {
        this.nameCache.set(sessionId, name)
      }
      return name
    } catch {
      return undefined
    }
  }
}
