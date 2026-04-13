import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const GEMINI_SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'settings.json')

const HOOK_EVENTS = ['SessionStart', 'BeforeAgent', 'AfterAgent', 'SessionEnd'] as const

const getHookCommand = () => {
  // Use the hook script bundled alongside the app.
  const devPath = path.join(__dirname, '../../resources/hooks/electree-gemini-hook.sh')
  if (existsSync(devPath)) return devPath

  const prodPath = path.join(process.resourcesPath, 'hooks/electree-gemini-hook.sh')
  if (existsSync(prodPath)) return prodPath

  return devPath
}

interface HookEntry {
  name?: string
  type: string
  command: string
}

interface HookMatcher {
  matcher?: string
  hooks: HookEntry[]
}

type GeminiSettings = Record<string, unknown> & {
  hooks?: Record<string, HookMatcher[]>
}

const readSettings = (): GeminiSettings => {
  if (!existsSync(GEMINI_SETTINGS_PATH)) return {}
  try {
    return JSON.parse(readFileSync(GEMINI_SETTINGS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

const writeSettings = (settings: GeminiSettings) => {
  mkdirSync(path.dirname(GEMINI_SETTINGS_PATH), { recursive: true })
  writeFileSync(GEMINI_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

const isElectreeHook = (entry: HookEntry) =>
  entry.command.includes('electree-gemini-hook')

export const isGeminiHooksEnabled = (): boolean => {
  const settings = readSettings()
  if (!settings.hooks) return false

  const currentCommand = path.resolve(getHookCommand())

  return HOOK_EVENTS.every((event) => {
    const matchers = settings.hooks?.[event]
    if (!matchers) return false
    return matchers.some((m) =>
      m.hooks.some((h) => isElectreeHook(h) && path.resolve(h.command) === currentCommand)
    )
  })
}

export const enableGeminiHooks = (): void => {
  const settings = readSettings()
  if (!settings.hooks) settings.hooks = {}

  const command = path.resolve(getHookCommand())
  const electreeHook: HookEntry = { name: 'electree-gemini-status', type: 'command', command }

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = []
    }

    // Check if already registered
    const existingMatcher = settings.hooks[event].find((m) =>
      m.hooks.some(isElectreeHook)
    )

    if (existingMatcher) {
      // Update command if path changed
      const hook = existingMatcher.hooks.find(isElectreeHook)
      if (hook) hook.command = command
    } else {
      settings.hooks[event].push({
        matcher: '',
        hooks: [electreeHook]
      })
    }
  }

  writeSettings(settings)
}

export const disableGeminiHooks = (): void => {
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
