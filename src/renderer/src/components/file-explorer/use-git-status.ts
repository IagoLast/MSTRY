import { useQuery } from '@tanstack/react-query'

import { getElectronBridge } from '../../lib/electron-bridge'

export const gitStatusQueryKey = (workspacePath: string | null) =>
  ['files', 'git-status', workspacePath] as const

export const useGitStatus = (workspacePath: string | null) =>
  useQuery({
    queryKey: gitStatusQueryKey(workspacePath),
    queryFn: async () => {
      if (!workspacePath) return []
      return getElectronBridge().files.getGitStatus({ cwd: workspacePath })
    },
    enabled: workspacePath !== null,
    refetchInterval: 3000,
    staleTime: 1500
  })
