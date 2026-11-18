import { version } from '../../package.json'

export const APP_NAME = 'AutumnMark'
export const GITHUB_REPO_URL = 'https://github.com/Autumn-one/autumnmark'
const docsRef = /^\d+\.\d+\.\d+$/.test(version) ? `v${version}` : 'develop'
export const END_USER_DOCS_URL = `${GITHUB_REPO_URL}/blob/${docsRef}/packages/website/content/docs/end-user`
