import { APP_NAME } from '@shared/brand'

export function buildWindowTitle(filename?: string): string {
  return filename ? `${filename} - ${APP_NAME}` : APP_NAME
}
