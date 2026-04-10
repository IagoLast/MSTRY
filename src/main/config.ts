import { app } from 'electron'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { resolveGitRoot } from './git'
import type { AppConfig, Project, WorkspaceMode } from '../shared/contracts'

interface StoredConfig {
  activeProjectPath: string | null
  projectPaths: string[]
}

const DEFAULT_CONFIG: StoredConfig = {
  activeProjectPath: null,
  projectPaths: []
}

const configDirectory = () => path.join(app.getPath('userData'))
const configPath = () => path.join(configDirectory(), 'config.json')

const getShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }

  return process.env.SHELL ?? '/bin/zsh'
}

const isExistingDirectory = async (candidatePath: string) => {
  try {
    return (await stat(candidatePath)).isDirectory()
  } catch {
    return false
  }
}

const normalizeProjectPath = async (candidate: string | null) => {
  if (!candidate) {
    return null
  }

  const resolved = path.resolve(candidate.trim())
  return (await isExistingDirectory(resolved)) ? resolved : null
}

const readStoredConfig = async (): Promise<StoredConfig> => {
  try {
    await access(configPath())
    const raw = await readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredConfig>

    return {
      activeProjectPath: parsed.activeProjectPath ?? null,
      projectPaths: Array.isArray(parsed.projectPaths) ? parsed.projectPaths : []
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

const writeStoredConfig = async (config: StoredConfig) => {
  await mkdir(configDirectory(), { recursive: true })
  await writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

const buildProject = async (projectPath: string): Promise<Project> => {
  const repoPath = await resolveGitRoot(projectPath)
  const rootPath = repoPath ?? projectPath
  const mode: WorkspaceMode = repoPath ? 'git' : 'directory'

  return {
    name: path.basename(rootPath),
    rootPath,
    repoPath,
    worktreeRoot: repoPath ? path.join(path.dirname(repoPath), '.claude-worktrees', path.basename(repoPath)) : null,
    mode
  }
}

const sanitizeProjectPaths = async (projectPaths: string[]) => {
  const normalized = await Promise.all(projectPaths.map((projectPath) => normalizeProjectPath(projectPath)))
  return [...new Set(normalized.filter((projectPath): projectPath is string => Boolean(projectPath)))]
}

const detectFallbackProjects = async () => {
  const currentDirectory = await normalizeProjectPath(process.cwd())
  return currentDirectory ? [currentDirectory] : []
}

const buildAppConfig = async (stored: StoredConfig): Promise<AppConfig> => {
  const sanitizedProjectPaths = await sanitizeProjectPaths(stored.projectPaths)
  const candidateProjectPaths =
    sanitizedProjectPaths.length > 0 ? sanitizedProjectPaths : await detectFallbackProjects()

  const projects = await Promise.all(candidateProjectPaths.map((projectPath) => buildProject(projectPath)))
  const activeProjectPath =
    projects.find((project) => project.rootPath === stored.activeProjectPath)?.rootPath ??
    projects[0]?.rootPath ??
    null

  return {
    activeProjectPath,
    projects,
    shell: getShell()
  }
}

const persistAppConfig = async (config: AppConfig) => {
  await writeStoredConfig({
    activeProjectPath: config.activeProjectPath,
    projectPaths: config.projects.map((project) => project.rootPath)
  })
}

export const getAppConfig = async (): Promise<AppConfig> => {
  const stored = await readStoredConfig()
  const config = await buildAppConfig(stored)

  if (
    stored.activeProjectPath !== config.activeProjectPath ||
    JSON.stringify(stored.projectPaths) !== JSON.stringify(config.projects.map((project) => project.rootPath))
  ) {
    await persistAppConfig(config)
  }

  return config
}

export const addProjectPath = async (projectPath: string): Promise<AppConfig> => {
  const normalized = await normalizeProjectPath(projectPath)

  if (!normalized) {
    throw new Error('La ruta indicada no es una carpeta valida.')
  }

  const stored = await readStoredConfig()
  const config = await buildAppConfig({
    activeProjectPath: normalized,
    projectPaths: [...stored.projectPaths, normalized]
  })

  await persistAppConfig(config)
  return config
}

export const selectProjectPath = async (projectPath: string): Promise<AppConfig> => {
  const normalized = await normalizeProjectPath(projectPath)

  if (!normalized) {
    throw new Error('No he podido encontrar ese proyecto.')
  }

  const config = await getAppConfig()
  const exists = config.projects.some((project) => project.rootPath === normalized)

  if (!exists) {
    throw new Error('Ese proyecto no existe en la lista actual.')
  }

  const updated: AppConfig = {
    ...config,
    activeProjectPath: normalized
  }

  await persistAppConfig(updated)
  return updated
}

export const removeProjectPath = async (projectPath: string): Promise<AppConfig> => {
  const normalized = await normalizeProjectPath(projectPath)

  if (!normalized) {
    return getAppConfig()
  }

  const config = await getAppConfig()
  const remainingProjects = config.projects.filter((project) => project.rootPath !== normalized)
  const activeProjectPath =
    config.activeProjectPath === normalized ? remainingProjects[0]?.rootPath ?? null : config.activeProjectPath

  const updated: AppConfig = {
    ...config,
    activeProjectPath,
    projects: remainingProjects
  }

  await persistAppConfig(updated)
  return updated
}
