import chineseMarkdown from './ridge-notes.zh.md?raw'
import englishMarkdown from './ridge-notes.en.md?raw'

const chinese = { filename: '雾岭手记.md', markdown: chineseMarkdown }
const english = { filename: 'Ridge notes.md', markdown: englishMarkdown }

export const themeSample = (locale: string): typeof english => locale.startsWith('zh') ? chinese : english
