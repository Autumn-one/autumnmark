import { beforeEach, describe, expect, it, vi } from 'vitest'

const { app, paths } = vi.hoisted(() => {
  const paths = { userData: '/profiles/marktext' }
  return {
    paths,
    app: {
      isPackaged: false,
      getPath: vi.fn(() => paths.userData),
      setName: vi.fn((name: string) => { paths.userData = `/profiles/${name}` }),
      setPath: vi.fn((_name: string, value: string) => { paths.userData = value }),
      getAppPath: () => '/app'
    }
  }
})
vi.mock('electron', () => ({ app }))
vi.mock('common/i18n', () => ({ setLocalesDirectory: vi.fn() }))

describe('AutumnMark profile compatibility', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it.each(['/profiles/marktext', '/custom/user-data'])('preserves %s while changing the displayed name', async(directory) => {
    paths.userData = directory
    await import('../../../src/main/globalSetting')
    expect(app.setName).toHaveBeenCalledWith('AutumnMark')
    expect(app.setPath).toHaveBeenCalledWith('userData', directory)
    expect(paths.userData).toBe(directory)
  })
})
