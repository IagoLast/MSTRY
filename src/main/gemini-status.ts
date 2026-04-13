import { EventEmitter } from 'node:events'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { GeminiSessionInfo } from '../shared/contracts'

const STATUS_DIR = '/tmp/electree-gemini'

interface RawSessionFile {
  session_id: string
  status: 'working' | 'idle'
  cwd: string
  transcript_path: string
  shell_pid: number
  prompt: string
}

interface GeminiStatusEvents {
  change: [sessions: GeminiSessionInfo[]]
}

export class GeminiStatusWatcher extends EventEmitter<GeminiStatusEvents> {
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

    if (files.length > 0) {
      console.log(`[gemini-status] Found ${files.length} status files in ${STATUS_DIR}`)
    }

    const sessions: GeminiSessionInfo[] = []

    for (const file of files) {
      try {
        const filePath = path.join(STATUS_DIR, file)
        const content = readFileSync(filePath, 'utf-8')
        const raw = JSON.parse(content) as RawSessionFile

        console.log(`[gemini-status] Parsed session ${raw.session_id} for shell PID ${raw.shell_pid}`)

        sessions.push({
          sessionId: raw.session_id,
          status: raw.status,
          cwd: raw.cwd,
          name: this.resolveSessionName(raw.session_id, raw.transcript_path) ?? null,
          prompt: raw.prompt || null,
          shellPid: raw.shell_pid ?? 0
        })
      } catch (err) {
        console.error(`[gemini-status] Error parsing ${file}:`, err)
      }
    }

    const json = JSON.stringify(sessions)
    if (json !== this.lastJson) {
      this.lastJson = json
      this.emit('change', sessions)
    }
  }

  private resolveSessionName(sessionId: string, _transcriptPath: string): string | undefined {
    if (this.nameCache.has(sessionId)) {
      return this.nameCache.get(sessionId)
    }
    // For now, we don't have a way to resolve Gemini session names from transcripts
    return undefined
  }
}
