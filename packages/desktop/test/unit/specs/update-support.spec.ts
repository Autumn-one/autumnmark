import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Set<string>())
const app = vi.hoisted(() => ({ isPackaged: false }))
vi.mock('electron', () => ({ app }))
vi.mock('common/filesystem', () => ({ isFile: (pathname: string) => files.has(pathname) }))
import { isPortableUpdatable, isUpdatable } from '../../../src/main/utils/isUpdatable'

describe('installed update support', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  const arch = Object.getOwnPropertyDescriptor(process, 'arch')
  const resourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

  beforeEach(() => {
    files.clear()
    app.isPackaged = false
    vi.stubEnv('APPIMAGE', '')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    Object.defineProperty(process, 'arch', { configurable: true, value: 'x64' })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/app/resources' })
  })

  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform)
    if (arch) Object.defineProperty(process, 'arch', arch)
    if (resourcesPath) Object.defineProperty(process, 'resourcesPath', resourcesPath)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs()
  })

  it('enables a Windows installation only when update metadata and its marker exist', () => {
    files.add(path.join(process.resourcesPath, 'app-update.yml'))
    expect(isUpdatable()).toBe(false)
    files.add(path.join(process.resourcesPath, 'nsis-installed'))
    expect(isUpdatable()).toBe(true)
    files.delete(path.join(process.resourcesPath, 'app-update.yml'))
    expect(isUpdatable()).toBe(false)
  })

  it('uses portable updates for a packaged Windows archive with or without installer metadata', () => {
    files.add(path.join(process.resourcesPath, 'app.asar'))
    expect(isUpdatable()).toBe(false)
    app.isPackaged = true
    expect(isUpdatable()).toBe(true)
    files.add(path.join(process.resourcesPath, 'app-update.yml'))
    expect(isPortableUpdatable()).toBe(true)
    files.add(path.join(process.resourcesPath, 'nsis-installed'))
    expect(isPortableUpdatable()).toBe(false)
    expect(isUpdatable()).toBe(true)
  })

  it('does not mistake bundled file-association icons for an installed application', () => {
    files.add(path.join(process.resourcesPath, 'app-update.yml'))
    files.add(path.join(process.resourcesPath, 'md.ico'))
    files.add(path.join(process.resourcesPath, 'icons', 'md.ico'))
    expect(isUpdatable()).toBe(false)
  })

  it('supports AppImages with update metadata', () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    vi.stubEnv('APPIMAGE', '/app/marktext.AppImage')
    expect(isUpdatable()).toBe(false)
    files.add(path.join(process.resourcesPath, 'app-update.yml'))
    expect(isUpdatable()).toBe(true)
  })
})
