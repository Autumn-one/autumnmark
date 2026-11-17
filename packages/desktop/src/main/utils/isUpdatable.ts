import path from 'path'
import { isFile } from 'common/filesystem'

export const isUpdatable = (): boolean => {
  const resources = process.resourcesPath
  if (!resources || !isFile(path.join(resources, 'app-update.yml'))) return false
  if (process.env.APPIMAGE) return true
  // Only NSIS installs carry this marker; ZIP builds have no installed app to replace.
  return process.platform === 'win32' && isFile(path.join(resources, 'nsis-installed'))
}
