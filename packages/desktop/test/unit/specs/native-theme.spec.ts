import { describe, it, expect } from 'vitest'
import { getNativeThemeSource, isDarkApplicationTheme, resolveThemeBackground } from 'main_renderer/app/nativeTheme'
import { oneDarkThemes, railscastsThemes } from 'common/theme'
import type { LocalTheme } from '@shared/localTheme'

const localTheme: LocalTheme = {
  version: 1,
  id: 'local:light:11111111-1111-4111-8111-111111111111',
  name: 'Custom paper',
  base: 'light',
  values: {}
}

describe('Native theme source', () => {
  it('follows the system when configured to do so', () => {
    expect(getNativeThemeSource({ followSystemTheme: true, theme: 'dark' })).to.equal('system')
    expect(getNativeThemeSource({ followSystemTheme: true, theme: 'light' })).to.equal('system')
  })

  it('uses dark native menus for dark MarkText themes', () => {
    for (const theme of ['dark', 'dracula', 'nord', 'rose-pine', 'kanagawa', 'cyberdream']) {
      expect(isDarkApplicationTheme(theme)).to.equal(true)
      expect(getNativeThemeSource({ followSystemTheme: false, theme })).to.equal('dark')
    }
  })

  it('uses the shared MarkText dark theme classification', () => {
    for (const theme of [...railscastsThemes, ...oneDarkThemes]) {
      expect(isDarkApplicationTheme(theme)).to.equal(true)
      expect(getNativeThemeSource({ followSystemTheme: false, theme })).to.equal('dark')
    }
  })

  it('uses light native menus for light MarkText themes', () => {
    for (const theme of ['light', 'graphite', 'ulysses', 'tokyo-night-light', 'unknown-theme']) {
      expect(isDarkApplicationTheme(theme)).to.equal(false)
      expect(getNativeThemeSource({ followSystemTheme: false, theme })).to.equal('light')
    }
  })

  it('reclassifies edits to the active local theme by its literal CSS background', () => {
    const args = { theme: localTheme.id, localThemes: [{ ...localTheme, css: ':root { --editorBgColor: #171717 }' }] }
    expect(getNativeThemeSource(args)).toBe('dark')
    expect(getNativeThemeSource({ ...args, followSystemTheme: true })).toBe('system')

    args.localThemes[0].css = ':root { --editorBgColor: #808080 }'
    expect(getNativeThemeSource(args)).toBe('light')
  })

  it('falls back to the saved background and then the base theme for CSS variables', () => {
    const local = { ...localTheme, css: ':root { --paper: #121212; --editorBgColor: var(--paper) }' }
    const withBackground = { ...local, values: { background: '#202020' } }
    expect(resolveThemeBackground(local.id, [withBackground])).toBe('#202020')
    expect(getNativeThemeSource({ theme: local.id, localThemes: [withBackground] })).toBe('dark')
    expect(getNativeThemeSource({ theme: local.id, localThemes: [local] })).toBe('light')
  })
})
