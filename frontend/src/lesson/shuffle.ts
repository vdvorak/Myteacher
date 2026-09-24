// Seeded shuffling. The stored lesson stays canonical; the renderer derives the
// layout from the attempt's seed, so the same seed always reproduces the same order.

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(state: number): () => number {
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A permutation of `items` determined entirely by `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(hashSeed(seed))
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** Like `seededShuffle`, but never the `previous` order, so a repeat always looks new. */
export function reshuffle<T>(items: readonly T[], seed: string, previous: readonly T[]): T[] {
  const result = seededShuffle(items, seed)
  const same = result.length === previous.length && result.every((item, i) => item === previous[i])
  return same && result.length > 1 ? [...result.slice(1), result[0]] : result
}
