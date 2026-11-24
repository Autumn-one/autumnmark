import fsPromises from 'fs/promises'
import { lstatSync, statSync } from 'fs'
import path from 'path'
import log from 'electron-log'
import iconv from 'iconv-lite'
import { LINE_ENDING_REG, LF_LINE_ENDING_REG, CRLF_LINE_ENDING_REG } from '../config'
import { isDirectory2, isFile2 } from 'common/filesystem'
import { hasMarkdownExtension, isMarkdownFile } from 'common/filesystem/paths'
import { isDrawingPath } from '@shared/drawing'
import { normalizeAndResolvePath, writeFile, writeFileChunks } from '../filesystem'
import { diskVideoReferences, diskVideoThreshold } from '@shared/diskVideo'
import { expandDiskVideos, readVideoMarkdown } from './diskVideo'
import { guessEncoding } from './encoding'
import { writePreservingHardlinks } from './hardlinkWrite'
import { getEncodingName, type Encoding } from 'common/encoding'
import type { LineEnding } from '@shared/types/files'
import type { DiskBaseline } from '@shared/types/files'
import { contentSha256 } from 'common/filesystem'

interface MarkdownDocumentOptions {
  adjustLineEndingOnSave: boolean
  lineEnding: LineEnding
  encoding: Encoding
}

interface MarkdownDocumentRaw {
  rawBaseline: DiskBaseline
  isPendingCreation?: boolean
  markdown: string
  filename: string
  pathname: string
  encoding: Encoding
  lineEnding: LineEnding
  adjustLineEndingOnSave: boolean
  trimTrailingNewline: number
  isMixedLineEndings: boolean
}

const getLineEnding = (lineEnding: LineEnding): string => {
  if (lineEnding === 'lf') {
    return '\n'
  } else if (lineEnding === 'crlf') {
    return '\r\n'
  }

  // This should not happen but use fallback value.
  log.error(`Invalid end of line character: expected "lf" or "crlf" but got "${lineEnding}".`)
  return '\n'
}

const convertLineEndings = (text: string, lineEnding: LineEnding): string => {
  return text.replace(LINE_ENDING_REG, getLineEnding(lineEnding))
}

// These examples only explain a failed full-document check. Limiting them
// must never determine whether a save is safe.
const getUnrepresentableCharacterSample = (content: string, encoding: string): string[] => {
  const checked = new Set<string>()
  const sample: string[] = []
  for (const character of content) {
    if (checked.has(character)) continue
    checked.add(character)
    const encoded = iconv.encode(character, encoding)
    if (iconv.decode(encoded, encoding, { stripBOM: false }) !== character) {
      sample.push(character)
      if (sample.length === 8) break
    }
  }
  return sample
}

/**
 * Special function to normalize directory and markdown file paths.
 * Returns the normalized path and a directory hint, or null if it's not a
 * directory or markdown file.
 */
export const normalizeMarkdownPath = (
  pathname: string
): { isDir: boolean; path: string } | null => {
  const isDir = isDirectory2(pathname)
  if (isDir || isMarkdownFile(pathname) || (isDrawingPath(pathname) && isFile2(pathname))) {
    const resolved = normalizeAndResolvePath(pathname)
    if (resolved) {
      return { isDir, path: resolved }
    } else {
      console.error(`[ERROR] Cannot resolve "${pathname}".`)
    }
  }
  return null
}

export const normalizeCliMarkdownPath = (pathname: string) => {
  try {
    lstatSync(pathname)
    return normalizeMarkdownPath(pathname)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error(err)
      return null
    }
    if (!hasMarkdownExtension(pathname)) return null
    try {
      if (!statSync(path.dirname(path.resolve(pathname))).isDirectory()) return null
    } catch (parentError) {
      log.error(parentError)
      return null
    }
    return { isDir: false, path: path.resolve(pathname), allowMissing: true }
  }
}

export const loadCliMarkdownFile = async(
  pathname: string,
  defaultEncoding: string,
  ...args: Parameters<typeof loadMarkdownFile> extends [string, ...infer Rest] ? Rest : never
): Promise<MarkdownDocumentRaw> => {
  try {
    return await loadMarkdownFile(pathname, ...args)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    await fsPromises.stat(path.dirname(pathname))
    return {
      pathname,
      filename: path.basename(pathname),
      markdown: '',
      rawBaseline: { exists: false },
      isPendingCreation: true,
      encoding: { encoding: defaultEncoding, isBom: false },
      lineEnding: args[0],
      adjustLineEndingOnSave: args[0] !== 'lf',
      trimTrailingNewline: args[2] ?? 2,
      isMixedLineEndings: false
    }
  }
}

/** Writes the confirmed pathname verbatim; extension defaults belong in the save dialog. */
export const writeMarkdownFile = (
  pathname: string,
  content: string,
  options: MarkdownDocumentOptions
): Promise<void> => {
  const { adjustLineEndingOnSave, lineEnding } = options
  const { encoding, isBom } = options.encoding

  if (adjustLineEndingOnSave) {
    content = convertLineEndings(content, lineEnding)
  }

  const buffer = iconv.encode(content, encoding, { addBOM: isBom })
  // iconv substitutes unrepresentable characters silently (#5614). Only strip
  // a BOM we requested so a leading U+FEFF in the document remains significant.
  if (iconv.decode(buffer, encoding, { stripBOM: !!isBom }) !== content) {
    const sample = getUnrepresentableCharacterSample(content, encoding)
    const examples = sample.length
      ? ` (${sample.map(character => JSON.stringify(character)).join(', ')})`
      : ''
    const error = new Error(
      `Cannot save using "${getEncodingName(options.encoding)}" because some characters${examples} cannot be represented. Open the Command Palette, run "Change Encoding", select UTF-8, and save again.`
    )
    error.name = 'EncodingLossError'
    return Promise.reject(error)
  }

  return writePreservingHardlinks(pathname, target => diskVideoReferences().test(content)
    ? writeFileChunks(target, expandDiskVideos(content, encoding, !!isBom))
    : writeFile(target, buffer))
}

export const readMarkdownSource = async(pathname: string, autoGuessEncoding: boolean, requireLossless = false) => {
  const diskStat = await fsPromises.stat(path.resolve(pathname))
  const streamed = diskStat.size >= diskVideoThreshold ? await readVideoMarkdown(pathname) : null
  const buffer = streamed?.buffer ?? await fsPromises.readFile(pathname)

  const wideEncoding = streamed?.wideEncoding
  const encoding = wideEncoding
    ? { encoding: wideEncoding, isBom: buffer.indexOf(iconv.encode('\uFEFF', wideEncoding)) === 0 }
    : guessEncoding(buffer, autoGuessEncoding)
  const supported = iconv.encodingExists(encoding.encoding)
  if (!supported) {
    throw new Error(`"${encoding.encoding}" encoding is not supported.`)
  }

  const markdown = iconv.decode(buffer, encoding.encoding)
  if (requireLossless && !iconv.encode(markdown, encoding.encoding, { addBOM: encoding.isBom }).equals(buffer))
    throw new Error('Could not decode the document without changing its original bytes')
  return {
    markdown,
    encoding,
    rawBaseline: { exists: true as const, sizeBytes: streamed?.sizeBytes ?? buffer.byteLength, mtimeMs: diskStat.mtimeMs, rawSha256: streamed?.rawSha256 ?? contentSha256(buffer) }
  }
}

export const loadMarkdownFile = async(
  pathname: string,
  preferredEol: LineEnding,
  autoGuessEncoding: boolean = true,
  trimTrailingNewline: number = 2,
  autoNormalizeLineEndings: boolean = false
): Promise<MarkdownDocumentRaw> => {
  const source = await readMarkdownSource(pathname, autoGuessEncoding)
  const { encoding, rawBaseline } = source
  let { markdown } = source
  const isLf = LF_LINE_ENDING_REG.test(markdown)
  const isCrlf = CRLF_LINE_ENDING_REG.test(markdown)
  const isMixedLineEndings = isLf && isCrlf
  const isUnknownEnding = !isLf && !isCrlf
  let lineEnding: LineEnding = preferredEol
  if (isLf && !isCrlf) {
    lineEnding = 'lf'
  } else if (isCrlf && !isLf) {
    lineEnding = 'crlf'
  }

  let adjustLineEndingOnSave = false

  if (isMixedLineEndings || isUnknownEnding || lineEnding !== 'lf') {
    markdown = convertLineEndings(markdown, 'lf')
    // MarkText always uses LF internally. If the user did not request LF line
    // endings, we need to adjust on save.
    adjustLineEndingOnSave = !autoNormalizeLineEndings && lineEnding !== 'lf'
  }

  if (trimTrailingNewline === 2) {
    if (!markdown) {
      trimTrailingNewline = 3
    } else {
      const lastIndex = markdown.length - 1
      if (lastIndex >= 1 && markdown[lastIndex] === '\n' && markdown[lastIndex - 1] === '\n') {
        trimTrailingNewline = 2
      } else if (markdown[lastIndex] === '\n') {
        trimTrailingNewline = 1
      } else {
        trimTrailingNewline = 0
      }
    }
  }

  const filename = path.basename(pathname)

  return {
    markdown,
    rawBaseline,
    filename,
    pathname,
    encoding,
    lineEnding,
    adjustLineEndingOnSave,
    trimTrailingNewline,
    isMixedLineEndings
  }
}
