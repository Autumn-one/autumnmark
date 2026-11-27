import path from 'path'
import { app } from 'electron'
import { isFile } from 'common/filesystem'

export const isPortableUpdatable = (): boolean => {
  const resources = process.resourcesPath
  return process.platform === 'win32' && process.arch === 'x64' && app.isPackaged &&
    !!resources && isFile(path.join(resources, 'app.asar')) &&
    !isFile(path.join(resources, 'nsis-installed'))
}

export const isUpdatable = (): boolean => {
  if (isPortableUpdatable()) return true
  const resources = process.resourcesPath
  if (!resources || !isFile(path.join(resources, 'app-update.yml'))) return false
  if (process.env.APPIMAGE) return true
  return process.platform === 'win32' && isFile(path.join(resources, 'nsis-installed'))
}
