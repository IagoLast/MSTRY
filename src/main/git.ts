import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  CheckoutMainResult,
  CreateWorktreeInput,
  DeleteWorktreeResult,
  WorkspaceItem
} from '../shared/contracts'

const execFileAsync = promisify(execFile)

const runGit = async (repoPath: string, args: string[]) => {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      encoding: 'utf8'
    })
    return stdout.trimEnd()
  } catch (error) {
    const stderr =
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      typeof error.stderr === 'string'
        ? error.stderr.trim()
        : ''

    const fallbackMessage = error instanceof Error ? error.message : 'Git command failed.'
    throw new Error(stderr || fallbackMessage)
  }
}

export const resolveGitRoot = async (candidatePath: string) => {
  try {
    const output = await runGit(candidatePath, ['rev-parse', '--show-toplevel'])
    return output.trim() || null
  } catch {
    return null
  }
}

const createDirectoryItem = (workspacePath: string): WorkspaceItem => ({
  kind: 'directory',
  path: workspacePath,
  name: path.basename(workspacePath),
  branch: null,
  head: null,
  isBare: false,
  isDetached: false,
  isLocked: false,
  isPrunable: false,
  isMain: true
})

const parseWorktrees = (output: string, repoPath: string): WorkspaceItem[] => {
  if (!output.trim()) {
    return []
  }

  return output
    .trim()
    .split(/\n(?=worktree )/g)
    .map((block) => {
      const entry: WorkspaceItem = {
        kind: 'worktree',
        path: '',
        name: '',
        branch: null,
        head: null,
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false,
        isMain: false
      }

      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) {
          entry.path = line.slice('worktree '.length)
          continue
        }

        if (line.startsWith('HEAD ')) {
          entry.head = line.slice('HEAD '.length)
          continue
        }

        if (line.startsWith('branch ')) {
          entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
          continue
        }

        if (line === 'bare') {
          entry.isBare = true
          continue
        }

        if (line === 'detached') {
          entry.isDetached = true
          continue
        }

        if (line.startsWith('locked')) {
          entry.isLocked = true
          continue
        }

        if (line.startsWith('prunable')) {
          entry.isPrunable = true
        }
      }

      entry.isMain = path.resolve(entry.path) === path.resolve(repoPath)
      entry.name = entry.branch ?? path.basename(entry.path)
      return entry
    })
    .sort((left, right) => {
      if (left.isMain) {
        return -1
      }

      if (right.isMain) {
        return 1
      }

      return left.path.localeCompare(right.path)
    })
}

export const listWorkspaceItems = async (rootPath: string, repoPath: string | null) => {
  if (!repoPath) {
    return [createDirectoryItem(rootPath)]
  }

  const output = await runGit(repoPath, ['worktree', 'list', '--porcelain'])
  return parseWorktrees(output, repoPath)
}

const splitGitLines = (output: string) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const listLocalBranches = async (repoPath: string) => {
  const output = await runGit(repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  return splitGitLines(output)
}

const listRemotes = async (repoPath: string) => {
  const output = await runGit(repoPath, ['remote'])
  return splitGitLines(output)
}

const resolveRemoteHead = async (repoPath: string) => {
  for (const remote of await listRemotes(repoPath)) {
    try {
      const ref = await runGit(repoPath, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`])
      const prefix = `refs/remotes/${remote}/`

      if (ref.startsWith(prefix)) {
        return {
          remote,
          branch: ref.slice(prefix.length)
        }
      }
    } catch {
      // Some remotes don't expose HEAD, so keep searching.
    }
  }

  return null
}

const resolvePrimaryBranch = async (repoPath: string) => {
  const remoteHead = await resolveRemoteHead(repoPath)
  if (remoteHead?.branch) {
    return remoteHead
  }

  const localBranches = await listLocalBranches(repoPath)
  if (localBranches.includes('main')) {
    return { remote: null, branch: 'main' }
  }

  if (localBranches.includes('master')) {
    return { remote: null, branch: 'master' }
  }

  throw new Error(
    'No pude detectar la rama principal. Probe con HEAD del remoto, main y master.'
  )
}

export const createWorktree = async (
  repoPath: string | null,
  worktreeRoot: string | null,
  input: CreateWorktreeInput
) => {
  if (!repoPath || !worktreeRoot) {
    throw new Error('La creacion de worktrees solo esta disponible en repositorios Git.')
  }

  const branchName = input.name.trim()

  if (!branchName) {
    throw new Error('Necesito un nombre de branch para crear el worktree.')
  }

  const targetPath = path.join(worktreeRoot, branchName)
  await mkdir(path.dirname(targetPath), { recursive: true })

  await runGit(repoPath, ['worktree', 'add', targetPath, '-b', branchName])

  const worktrees = await listWorkspaceItems(repoPath, repoPath)
  const created = worktrees.find((worktree) => path.resolve(worktree.path) === path.resolve(targetPath))

  if (!created) {
    throw new Error('El worktree se creo, pero no aparecio en el listado.')
  }

  return created
}

export const removeWorktree = async (
  repoPath: string | null,
  worktreePath: string
): Promise<DeleteWorktreeResult> => {
  if (!repoPath) {
    throw new Error('No hay worktrees Git que borrar en modo carpeta.')
  }

  const normalizedRepoPath = path.resolve(repoPath)
  const normalizedWorktreePath = path.resolve(worktreePath)

  if (normalizedRepoPath === normalizedWorktreePath) {
    throw new Error('No se puede borrar el workspace principal.')
  }

  const worktrees = await listWorkspaceItems(repoPath, repoPath)
  const targetWorktree = worktrees.find(
    (worktree) => path.resolve(worktree.path) === normalizedWorktreePath
  )

  if (!targetWorktree || targetWorktree.kind !== 'worktree') {
    throw new Error('No encontre ese worktree en el repositorio activo.')
  }

  await runGit(repoPath, ['worktree', 'remove', '--force', normalizedWorktreePath])
  await runGit(repoPath, ['worktree', 'prune'])

  let warning: string | null = null

  if (targetWorktree.branch) {
    try {
      await runGit(repoPath, ['branch', '-D', targetWorktree.branch])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No pude borrar la rama local.'
      warning = `El worktree se borro, pero no pude borrar la rama local ${targetWorktree.branch}: ${message}`
    }
  }

  return {
    removedPath: normalizedWorktreePath,
    removedBranch: targetWorktree.branch,
    warning
  }
}

export const checkoutMainWorkspace = async (
  repoPath: string | null
): Promise<CheckoutMainResult> => {
  if (!repoPath) {
    throw new Error('El checkout de la rama principal solo esta disponible en repositorios Git.')
  }

  const [{ branch, remote }, localBranches] = await Promise.all([
    resolvePrimaryBranch(repoPath),
    listLocalBranches(repoPath)
  ])

  if (localBranches.includes(branch)) {
    await runGit(repoPath, ['checkout', branch])
  } else if (remote) {
    await runGit(repoPath, ['checkout', '-b', branch, '--track', `${remote}/${branch}`])
  } else {
    throw new Error(`No encontre una rama local ${branch} para hacer checkout.`)
  }

  return { branch }
}
