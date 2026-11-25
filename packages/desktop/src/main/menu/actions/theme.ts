import { ipcMain } from 'electron'

export const openThemeSettings = (): void => {
  ipcMain.emit('app-create-settings-window', 'theme')
}

export const createFromCurrentTheme = (): void => {
  ipcMain.emit('create-theme-from-current')
}

export const selectTheme = (theme: string): void => {
  ipcMain.emit('set-user-preference', { theme })
}

export const setFollowSystemTheme = (followSystemTheme: boolean): void => {
  ipcMain.emit('set-user-preference', { followSystemTheme })
}
