import { useQuery } from '@tanstack/react-query'

import { getElectronBridge } from '../../lib/electron-bridge'

export const directoryQueryKey = (workspacePath: string | null, relativePath: string) =>
  ['files', 'directory', workspacePath, relativePath] as const

export const useDirectory = (
  workspacePath: string | null,
  relativePath: string,
  enabled: boolean
) =>
  useQuery({
    queryKey: directoryQueryKey(workspacePath, relativePath),
    queryFn: async () => {
      if (!workspacePath) return []
      return getElectronBridge().files.listDirectory({
        cwd: workspacePath,
        relativePath
      })
    },
    enabled: enabled && workspacePath !== null,
    staleTime: 15_000
  })
