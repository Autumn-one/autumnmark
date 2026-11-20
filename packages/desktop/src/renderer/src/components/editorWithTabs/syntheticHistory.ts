// Save tracking uses content IDs because engine undo depth is reused for divergent edits.
// Each distinct document gets a fresh ID; revisiting saved content restores its saved ID.
// The store consumes a single-entry history containing that ID, separately from engine undo.

// Use compact 64-bit content keys instead of retaining every document snapshot.
// The wider hash reduces collisions that could incorrectly mark divergent content clean.
const hashContent = (content: string): bigint => {
  // Save and engine round-trips can normalize trailing newlines without an edit.
  let end = content.length
  while (end > 0 && (content[end - 1] === '\n' || content[end - 1] === '\r')) end--
  let high = 0xcbf29ce4
  let low = 0x84222325
  // FNV-1a's prime is 2^40 + 435. The low product fits exactly in a Number,
  // so only the final key needs a BigInt allocation.
  for (let i = 0; i < end; i++) {
    low = (low ^ content.charCodeAt(i)) >>> 0
    const product = low * 435
    high = (Math.imul(high, 435) + (low << 8) + Math.floor(product / 0x100000000)) >>> 0
    low = product >>> 0
  }
  return (BigInt(high) << 32n) | BigInt(low)
}

export interface IFileHistoryLike {
  stack: Array<{ id: number | string; [key: string]: unknown }>
  index: number
  lastEditIndex: number
  lastInitIndex: number
}

// Per-tab content IDs; reset baseline to ID 0 after setContent clears engine history.
export class SyntheticHistory {
  private counter = 0
  private readonly idByContent = new Map<bigint, number>()

  constructor(baselineContent: string = '') {
    this.idByContent.set(hashContent(baselineContent), 0)
  }

  // Revisiting content reuses its original ID, including after undo or redo.
  idFor(content: string): number {
    const key = hashContent(content)
    let id = this.idByContent.get(key)
    if (id === undefined) {
      id = ++this.counter
      this.idByContent.set(key, id)
    }
    return id
  }

  // Only stack[lastEditIndex].id is read for save tracking; other fields preserve its contract.
  build(content: string): IFileHistoryLike {
    return {
      stack: [{ id: this.idFor(content) }],
      index: 0,
      lastEditIndex: 0,
      lastInitIndex: -1
    }
  }
}
