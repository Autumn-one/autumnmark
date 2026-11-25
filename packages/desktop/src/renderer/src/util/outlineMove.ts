import type { getStateSections } from '@muyajs/core'

type Outline = ReturnType<typeof getStateSections>
type SectionCuts = [from: number, pivot: number, to: number]
export type DropSide = 'before' | 'after'
export interface SectionEdit { from: number; to: number; text: string }

export interface OutlineMoveSession {
  outline: Outline
  apply(cuts: SectionCuts): void
}

export type BeginOutlineMove = (session: OutlineMoveSession) => void

export function sectionCuts(
  { outline: { headings, endScope, length } }: OutlineMoveSession,
  source: number,
  target: number,
  side: DropSide
): SectionCuts | undefined {
  if (!headings[source] || !headings[target] || source === target) return
  const afterSection = (index: number): number => {
    let end = index + 1
    while (end < headings.length && headings[end].lvl > headings[index].lvl) end++
    return end
  }
  const end = afterSection(source)
  const destination = side === 'after' ? afterSection(target) : target
  if ((target >= source && target < end) || (destination >= source && destination <= end)) return
  const cuts = [source, end, destination].sort((a, b) => a - b)
  const scopes = cuts.map(index => headings[index]?.scope ?? endScope)
  if (scopes.some(scope => scope !== scopes[0])) return
  const offset = (index: number) => headings[index]?.sectionStart ?? length
  return [offset(cuts[0]), offset(cuts[1]), offset(cuts[2])]
}

/** Keep the separator and the final newline in place, including when the last section ends at EOF. */
export function sectionEdit(markdown: string, [from, pivot, to]: SectionCuts): SectionEdit {
  const left = markdown.slice(from, pivot)
  const right = markdown.slice(pivot, to)
  const leftBody = left.replace(/\n+$/, '')
  const rightBody = right.replace(/\n+$/, '')
  return {
    from,
    to,
    text: rightBody + left.slice(leftBody.length) + leftBody + right.slice(rightBody.length)
  }
}
