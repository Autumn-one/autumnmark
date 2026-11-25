import chineseMarkdown from './ridge-notes.zh.md?raw'
import englishMarkdown from './ridge-notes.en.md?raw'
import mapImage from './ridge-map.png?inline'

const chinese = { filename: '雾岭手记.md', markdown: chineseMarkdown.replace('[ridge-map]: ./ridge-map.png', `[ridge-map]: ${mapImage}`) }
const english = { filename: 'Ridge notes.md', markdown: englishMarkdown.replace('[ridge-map]: ./ridge-map.png', `[ridge-map]: ${mapImage}`) }

export const themeSample = (locale: string): typeof english => locale.startsWith('zh') ? chinese : english
