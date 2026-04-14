import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CODEX_CONFIG_DIR = path.join(os.homedir(), '.codex')
const CODEX_CONFIG_PATH = path.join(CODEX_CONFIG_DIR, 'config.toml')
const CODEX_HOOKS_PATH = path.join(CODEX_CONFIG_DIR, 'hooks.json')
const MANAGED_HOOK_FILENAMES = ['mstry-codex-hook.sh', 'electree-codex-hook.sh'] as const

interface HookDefinition {
  event: string
  matcher?: string
}

const HOOK_DEFINITIONS: HookDefinition[] = [
  { event: 'SessionStart', matcher: 'startup|resume' },
  { event: 'PreToolUse', matcher: 'Bash' },
  { event: 'PostToolUse', matcher: 'Bash' },
  { event: 'UserPromptSubmit' },
  { event: 'Stop' }
]

interface HookEntry {
  type: string
  command: string
  statusMessage?: string
  timeout?: number
  timeoutSec?: number
}

interface HookMatcher {
  matcher?: string
  hooks: HookEntry[]
}

type HooksFile = Record<string, unknown> & {
  hooks?: Record<string, HookMatcher[]>
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\"'\"'`)}'`

const getHookScriptPath = () => {
  const devPath = path.join(__dirname, '../../resources/hooks/mstry-codex-hook.sh')
  if (existsSync(devPath)) return devPath

  const prodPath = path.join(process.resourcesPath, 'hooks/mstry-codex-hook.sh')
  if (existsSync(prodPath)) return prodPath

  return devPath
}

const getHookCommand = () => `/bin/bash ${shellQuote(path.resolve(getHookScriptPath()))}`

const readHooksFile = (): HooksFile => {
  if (!existsSync(CODEX_HOOKS_PATH)) return {}

  try {
    return JSON.parse(readFileSync(CODEX_HOOKS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

const writeHooksFile = (settings: HooksFile) => {
  mkdirSync(CODEX_CONFIG_DIR, { recursive: true })
  writeFileSync(CODEX_HOOKS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
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

const isCodexFeatureEnabled = (): boolean => {
  if (!existsSync(CODEX_CONFIG_PATH)) return false

  try {
    const content = readFileSync(CODEX_CONFIG_PATH, 'utf-8')
    let currentSection = ''

    for (const line of content.split(/\r?\n/)) {
      const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/)
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim()
        continue
      }

      if (currentSection !== 'features') continue

      const featureMatch = line.match(/^\s*codex_hooks\s*=\s*(true|false)\b/i)
      if (featureMatch) {
        return featureMatch[1].toLowerCase() === 'true'
      }
    }
  } catch {
    return false
  }

  return false
}

const ensureCodexFeatureEnabled = () => {
  mkdirSync(CODEX_CONFIG_DIR, { recursive: true })

  const existing = existsSync(CODEX_CONFIG_PATH)
    ? readFileSync(CODEX_CONFIG_PATH, 'utf-8')
    : ''
  const lines = existing === '' ? [] : existing.split(/\r?\n/)

  let currentSection = ''
  let featuresStart = -1
  let featuresEnd = lines.length
  let keyLine = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/)

    if (sectionMatch) {
      if (currentSection === 'features' && featuresEnd === lines.length) {
        featuresEnd = index
      }

      currentSection = sectionMatch[1].trim()
      if (currentSection === 'features' && featuresStart === -1) {
        featuresStart = index
      }
      continue
    }

    if (currentSection === 'features' && /^\s*codex_hooks\s*=/.test(line)) {
      keyLine = index
    }
  }

  if (currentSection === 'features' && featuresEnd === lines.length) {
    featuresEnd = lines.length
  }

  if (keyLine !== -1) {
    lines[keyLine] = 'codex_hooks = true'
  } else if (featuresStart !== -1) {
    lines.splice(featuresEnd, 0, 'codex_hooks = true')
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('')
    }
    lines.push('[features]', 'codex_hooks = true')
  }

  writeFileSync(CODEX_CONFIG_PATH, lines.join('\n').replace(/\n*$/, '\n'), 'utf-8')
}

export const isCodexHooksEnabled = (): boolean => {
  if (!isCodexFeatureEnabled()) return false

  const settings = readHooksFile()
  if (!settings.hooks) return false

  const currentCommand = getHookCommand()

  return HOOK_DEFINITIONS.every(({ event }) => {
    const matchers = settings.hooks?.[event]
    if (!matchers) return false

    return matchers.some((matcher) =>
      matcher.hooks.some((hook) => isManagedHook(hook) && hook.command === currentCommand)
    )
  })
}

export const enableCodexHooks = (): void => {
  ensureCodexFeatureEnabled()

  const settings = readHooksFile()
  if (!settings.hooks) settings.hooks = {}

  const command = getHookCommand()

  for (const { event, matcher } of HOOK_DEFINITIONS) {
    settings.hooks[event] = [
      ...stripManagedHooks(settings.hooks[event]),
      {
        ...(matcher ? { matcher } : {}),
        hooks: [{ type: 'command', command }]
      }
    ]
  }

  writeHooksFile(settings)
}

export const disableCodexHooks = (): void => {
  const settings = readHooksFile()
  if (!settings.hooks) return

  for (const { event } of HOOK_DEFINITIONS) {
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

  writeHooksFile(settings)
}
