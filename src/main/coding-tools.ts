import { execFile, execFileSync } from 'node:child_process'
import type { CodingToolInfo } from '../shared/contracts'

interface CodingToolDef {
  id: string
  name: string
  description: string
  checkCmd: string
  checkArgs: string[]
  installCmd: string
  installArgs: string[]
}

const TOOLS: CodingToolDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Anthropic CLI para programar con Claude',
    checkCmd: 'claude',
    checkArgs: ['--version'],
    installCmd: 'npm',
    installArgs: ['install', '-g', '@anthropic-ai/claude-code']
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    description: 'OpenAI CLI para programar con Codex',
    checkCmd: 'codex',
    checkArgs: ['--version'],
    installCmd: 'npm',
    installArgs: ['install', '-g', '@openai/codex']
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'Google CLI para programar con Gemini',
    checkCmd: 'gemini',
    checkArgs: ['--version'],
    installCmd: 'npm',
    installArgs: ['install', '-g', '@google/gemini-cli']
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'CLI open source para programar con OpenCode',
    checkCmd: 'opencode',
    checkArgs: ['--version'],
    installCmd: 'npm',
    installArgs: ['install', '-g', 'opencode-ai']
  }
]

function isToolInstalled(tool: CodingToolDef): boolean {
  try {
    execFileSync(tool.checkCmd, tool.checkArgs, { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export function checkAllTools(): CodingToolInfo[] {
  return TOOLS.map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    installed: isToolInstalled(tool)
  }))
}

export function installTool(toolId: string): Promise<void> {
  const tool = TOOLS.find((t) => t.id === toolId)
  if (!tool) {
    return Promise.reject(new Error(`Unknown tool: ${toolId}`))
  }

  return new Promise((resolve, reject) => {
    execFile(tool.installCmd, tool.installArgs, { timeout: 120_000 }, (error) => {
      if (error) {
        reject(new Error(`Failed to install ${tool.name}: ${error.message}`))
      } else {
        resolve()
      }
    })
  })
}
