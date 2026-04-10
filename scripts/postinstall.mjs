import { spawnSync } from 'node:child_process'

if (process.platform === 'darwin') {
  const result = spawnSync('npm', ['rebuild', 'node-pty', '--build-from-source'], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
