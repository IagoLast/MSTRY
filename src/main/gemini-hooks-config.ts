import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const GEMINI_SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'settings.json')

const HOOK_EVENTS = ['SessionStart', 'BeforeAgent', 'AfterAgent', 'SessionEnd'] as const
const MANAGED_HOOK_FILENAMES = ['mstry-gemini-hook.sh', 'electree-gemini-hook.sh'] as const

const getHookCommand = () => {
  // Use the hook script bundled alongside the app.
  const devPath = path.join(__dirname, '../../resources/hooks/mstry-gemini-hook.sh')
  if (existsSync(devPath)) return devPath

  const prodPath = path.join(process.resourcesPath, 'hooks/mstry-gemini-hook.sh')
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

const isManagedHook = (entry: HookEntry) =>
  MANAGED_HOOK_FILENAMES.some((filename) => entry.command.includes(filename))

const stripManagedHooks = (matchers: HookMatcher[] = []) =>
  matchers
    .map((matcher) => ({
      ...matcher,
      hooks: matcher.hooks.filter((hook) => !isManagedHook(hook))
    }))
    .filter((matcher) => matcher.hooks.length > 0)

export const isGeminiHooksEnabled = (): boolean => {
  const settings = readSettings()
  if (!settings.hooks) return false

  const currentCommand = path.resolve(getHookCommand())

  return HOOK_EVENTS.every((event) => {
    const matchers = settings.hooks?.[event]
    if (!matchers) return false
    return matchers.some((matcher) =>
      matcher.hooks.some((hook) => isManagedHook(hook) && path.resolve(hook.command) === currentCommand)
    )
  })
}

export const enableGeminiHooks = (): void => {
  const settings = readSettings()
  if (!settings.hooks) settings.hooks = {}

  const command = path.resolve(getHookCommand())

  for (const event of HOOK_EVENTS) {
    settings.hooks[event] = [
      ...stripManagedHooks(settings.hooks[event]),
      {
        matcher: '',
        hooks: [{ name: 'mstry-gemini-status', type: 'command', command }]
      }
    ]
  }

  writeSettings(settings)
}

export const disableGeminiHooks = (): void => {
  const settings = readSettings()
  if (!settings.hooks) return

  for (const event of HOOK_EVENTS) {
    const matchers = settings.hooks[event]
    if (!matchers) continue

    settings.hooks[event] = stripManagedHooks(matchers)

    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event]
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks
  }

  writeSettings(settings)
}
