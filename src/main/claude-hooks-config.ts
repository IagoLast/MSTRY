import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'Stop', 'SessionEnd'] as const
const MANAGED_HOOK_FILENAMES = ['mstry-claude-hook.sh', 'electree-claude-hook.sh'] as const

const getHookCommand = () => {
  // Use the hook script bundled alongside the app.
  // In dev: <repo>/resources/hooks/mstry-claude-hook.sh
  // In prod: <app>/Resources/hooks/mstry-claude-hook.sh (via electron-builder extraResources)
  const devPath = path.join(__dirname, '../../resources/hooks/mstry-claude-hook.sh')
  if (existsSync(devPath)) return devPath

  // electron-builder packages extraResources next to app.asar
  const prodPath = path.join(process.resourcesPath, 'hooks/mstry-claude-hook.sh')
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

const isManagedHook = (entry: HookEntry) =>
  MANAGED_HOOK_FILENAMES.some((filename) => entry.command.includes(filename))

const hasCurrentCommand = (entry: HookEntry, command: string) =>
  path.resolve(entry.command) === command

const stripManagedHooks = (matchers: HookMatcher[] = []) =>
  matchers
    .map((matcher) => ({
      ...matcher,
      hooks: matcher.hooks.filter((hook) => !isManagedHook(hook))
    }))
    .filter((matcher) => matcher.hooks.length > 0)

export const isClaudeHooksEnabled = (): boolean => {
  const settings = readSettings()
  if (!settings.hooks) return false
  const command = path.resolve(getHookCommand())

  return HOOK_EVENTS.every((event) => {
    const matchers = settings.hooks?.[event]
    if (!matchers) return false
    return matchers.some((matcher) =>
      matcher.hooks.some((hook) => isManagedHook(hook) && hasCurrentCommand(hook, command))
    )
  })
}

export const enableClaudeHooks = (): void => {
  const settings = readSettings()
  if (!settings.hooks) settings.hooks = {}

  const command = path.resolve(getHookCommand())

  for (const event of HOOK_EVENTS) {
    settings.hooks[event] = [
      ...stripManagedHooks(settings.hooks[event]),
      {
        matcher: '',
        hooks: [{ type: 'command', command }]
      }
    ]
  }

  writeSettings(settings)
}

export const disableClaudeHooks = (): void => {
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
