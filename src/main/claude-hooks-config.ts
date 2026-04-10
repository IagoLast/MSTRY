import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SessionEnd'] as const

const getHookCommand = () => {
  // Use the hook script bundled alongside the app.
  // In dev: <repo>/resources/hooks/electree-claude-hook.sh
  // In prod: <app>/Resources/hooks/electree-claude-hook.sh (via electron-builder extraResources)
  const devPath = path.join(__dirname, '../../resources/hooks/electree-claude-hook.sh')
  if (existsSync(devPath)) return devPath

  // electron-builder packages extraResources next to app.asar
  const prodPath = path.join(process.resourcesPath, 'hooks/electree-claude-hook.sh')
  if (existsSync(prodPath)) return prodPath

  return devPath // fallback
}

interface HookEntry {
  type: string
  command: string
}

interface HookMatcher {
  matcher?: string
  hooks: HookEntry[]
}

type ClaudeSettings = Record<string, unknown> & {
  hooks?: Record<string, HookMatcher[]>
}

const readSettings = (): ClaudeSettings => {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {}
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

const writeSettings = (settings: ClaudeSettings) => {
  mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true })
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

const isElectreeHook = (entry: HookEntry) =>
  entry.command.includes('electree-claude-hook')

export const isClaudeHooksEnabled = (): boolean => {
  const settings = readSettings()
  if (!settings.hooks) return false

  return HOOK_EVENTS.every((event) => {
    const matchers = settings.hooks?.[event]
    if (!matchers) return false
    return matchers.some((m) => m.hooks.some(isElectreeHook))
  })
}

export const enableClaudeHooks = (): void => {
  const settings = readSettings()
  if (!settings.hooks) settings.hooks = {}

  const command = getHookCommand()
  const electreeHook: HookEntry = { type: 'command', command }

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = []
    }

    // Check if already registered
    const alreadyExists = settings.hooks[event].some((m) =>
      m.hooks.some(isElectreeHook)
    )

    if (!alreadyExists) {
      settings.hooks[event].push({
        matcher: '',
        hooks: [electreeHook]
      })
    }
  }

  writeSettings(settings)
}

export const disableClaudeHooks = (): void => {
  const settings = readSettings()
  if (!settings.hooks) return

  for (const event of HOOK_EVENTS) {
    const matchers = settings.hooks[event]
    if (!matchers) continue

    settings.hooks[event] = matchers
      .map((m) => ({
        ...m,
        hooks: m.hooks.filter((h) => !isElectreeHook(h))
      }))
      .filter((m) => m.hooks.length > 0)

    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event]
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }

  writeSettings(settings)
}
