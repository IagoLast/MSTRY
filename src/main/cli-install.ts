import { app, dialog } from 'electron'
import { exec } from 'node:child_process'
import { access, readlink } from 'node:fs/promises'
import path from 'node:path'

const SYMLINK_PATH = '/usr/local/bin/electree'

const getCliScriptPath = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'cli', 'electree.sh')
  }
  return path.join(__dirname, '../../resources/cli/electree.sh')
}

export const isCliInstalled = async (): Promise<boolean> => {
  try {
    await access(SYMLINK_PATH)
    const target = await readlink(SYMLINK_PATH)
    return target === getCliScriptPath()
  } catch {
    return false
  }
}

export const installCli = async (): Promise<void> => {
  const scriptPath = getCliScriptPath()

  try {
    await access(scriptPath)
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Error',
      message: 'No se encontró el script CLI.',
      detail: `Se esperaba en: ${scriptPath}`
    })
    return
  }

  const command = `ln -sf "${scriptPath}" "${SYMLINK_PATH}"`

  return new Promise((resolve) => {
    exec(`osascript -e 'do shell script "${command.replace(/"/g, '\\"')}" with administrator privileges'`, (error) => {
      if (error) {
        dialog.showMessageBox({
          type: 'error',
          title: 'Error',
          message: 'No se pudo instalar el comando.',
          detail: error.message
        })
      } else {
        dialog.showMessageBox({
          type: 'info',
          title: 'Comando instalado',
          message: 'El comando "electree" se ha instalado correctamente.',
          detail: 'Ahora puedes usar "electree ." desde tu terminal.'
        })
      }
      resolve()
    })
  })
}

export const uninstallCli = async (): Promise<void> => {
  const command = `rm -f "${SYMLINK_PATH}"`

  return new Promise((resolve) => {
    exec(`osascript -e 'do shell script "${command.replace(/"/g, '\\"')}" with administrator privileges'`, (error) => {
      if (error) {
        dialog.showMessageBox({
          type: 'error',
          title: 'Error',
          message: 'No se pudo desinstalar el comando.',
          detail: error.message
        })
      } else {
        dialog.showMessageBox({
          type: 'info',
          title: 'Comando desinstalado',
          message: 'El comando "electree" se ha eliminado del PATH.'
        })
      }
      resolve()
    })
  })
}
