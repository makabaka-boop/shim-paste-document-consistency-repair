/**
 * Exact reachability solver: for every target t, decide whether there
 * exists a value x in A and y in B such that x + y = t.
 *
 * The implementation never enumerates A × B pairs (which is up to
 * 10^10 combinations). Each shim set is encoded once as a bitset backed
 * by a native BigInt; membership queries are word-parallel bit operations.
 *
 * Encoding (per query, after one-time preprocessing):
 *   - maskA:    bit x is 1 iff x ∈ A
 *   - revB:     bit (maxB - y) is 1 iff y ∈ B
 *   For a target t the sumset exists iff
 *       (maskA << (maxB - t)) & revB !== 0     (t <= maxB)
 *       (maskA >> (t - maxB))     & revB !== 0  (t >  maxB)
 *   because a bit position where the shifted A-mask and reversed B-mask
 *   are both 1 corresponds to some x with x ∈ A and (t - x) ∈ B.
 *
 * Side with fewer *distinct* values is shifted (its mask tends to be
 * shorter/narrower). Repeated input values are the same shim specification
 * and are deduplicated. Targets keep original order and duplicates; their
 * answers are cached so repeated targets share one query.
 */

import { TARGET_MAX } from './validation'

const WORD_BITS = 30

/**
 * Build a BigInt bitset where bit v is set iff v is present in `values`.
 * `values` must be pre-deduplicated and within [0, maxValue].
 * A Uint32Array staging buffer keeps construction O(values.length + span).
 */
export function buildBitset(values: readonly number[], maxValue: number): bigint {
  const wordCount = ((maxValue / WORD_BITS) | 0) + 1
  const words = new Uint32Array(wordCount)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    words[(v / WORD_BITS) | 0] |= (1 << (v % WORD_BITS)) >>> 0
  }
  let mask = 0n
  for (let i = wordCount - 1; i >= 0; i--)
    mask = (mask << BigInt(WORD_BITS)) | BigInt(words[i])
  return mask
}

/**
 * Reversed bitset: bit (maxValue - v) is set iff v is present.
 * Used as the fixed operand of the per-target convolution check.
 */
export function buildReversedBitset(values: readonly number[], maxValue: number): bigint {
  const wordCount = ((maxValue / WORD_BITS) | 0) + 1
  const words = new Uint32Array(wordCount)
  for (let i = 0; i < values.length; i++) {
    const r = maxValue - values[i]
    words[(r / WORD_BITS) | 0] |= (1 << (r % WORD_BITS)) >>> 0
  }
  let mask = 0n
  for (let i = wordCount - 1; i >= 0; i--)
    mask = (mask << BigInt(WORD_BITS)) | BigInt(words[i])
  return mask
}

export function dedupeSorted(values: readonly number[]): number[] {
  if (values.length <= 1) return values.slice()
  const sorted = values.slice().sort((p, q) => p - q)
  const out: number[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== out[out.length - 1]) out.push(sorted[i])
  }
  return out
}

export interface SolveResult {
  /** reachable[i] corresponds to targets[i], in original order. */
  reachable: boolean[]
  /** Distinct shim values in each level, sorted ascending. */
  distinctA: number[]
  distinctB: number[]
}

/**
 * Preprocessed bitsets for one valid input. Built once per input and reused
 * by both the batch reachability pass and the interactive nearby-spec query,
 * so the nearby query never re-encodes the shim lists (and never enumerates
 * A × B pairs).
 */
export interface ReachabilityIndex {
  /** Bit x is 1 iff x is present in the side with fewer distinct values. */
  maskSmall: bigint
  /** Bit (maxLarge - y) is 1 iff y is present in the other side. */
  reversedLarge: bigint
  maxSmall: number
  maxLarge: number
  /** True when the A/B sides were swapped to make the shifted side narrower. */
  swapped: boolean
  distinctA: number[]
  distinctB: number[]
}

export function buildIndex(a: readonly number[], b: readonly number[]): ReachabilityIndex {
  const sortedA = dedupeSorted(a)
  const sortedB = dedupeSorted(b)

  // Shift the narrower side; reverse the wider side. Sumset is symmetric
  // so swapping sides does not change any answer.
  const swapped = sortedA.length > sortedB.length
  const small = swapped ? sortedB : sortedA
  const large = swapped ? sortedA : sortedB

  const maxSmall = small[small.length - 1]
  const maxLarge = large[large.length - 1]

  return {
    maskSmall: buildBitset(small, maxSmall),
    reversedLarge: buildReversedBitset(large, maxLarge),
    maxSmall,
    maxLarge,
    swapped,
    distinctA: sortedA,
    distinctB: sortedB,
  }
}

/** Batch reachability for all targets, reusing a prebuilt index. */
export function reachableWithIndex(
  index: ReachabilityIndex,
  targets: readonly number[],
): boolean[] {
  const { maskSmall, reversedLarge, maxLarge } = index
  const spanMax = Math.min(index.maxSmall + maxLarge, TARGET_MAX)
  const delta = BigInt(maxLarge)

  const cache = new Map<number, boolean>()
  const reachable = new Array<boolean>(targets.length)

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const cached = cache.get(t)
    if (cached !== undefined) {
      reachable[i] = cached
      continue
    }
    let hit: boolean
    if (t > spanMax) {
      hit = false
    } else {
      const shifted =
        t <= maxLarge
          ? maskSmall << (delta - BigInt(t))
          : maskSmall >> (BigInt(t) - delta)
      hit = (shifted & reversedLarge) !== 0n
    }
    cache.set(t, hit)
    reachable[i] = hit
  }
  return reachable
}

/**
 * Decide reachability for all targets.
 * Worst case measured well under the 6-second budget at the maximum
 * 100 000 × 100 000 input on commodity hardware.
 */
export function solve(a: readonly number[], b: readonly number[], targets: readonly number[]): SolveResult {
  const index = buildIndex(a, b)

  // Note: reachability is symmetric, so swapping sides only decides which
  // mask gets shifted per query. The reported distinct lists always keep
  // their original A/B identity regardless of this internal swap.
  return {
    reachable: reachableWithIndex(index, targets),
    distinctA: index.distinctA,
    distinctB: index.distinctB,
  }
}

/** A concrete, usable pair of shim specs near a requested target. */
export interface NearbyHit {
  /** Achievable total thickness a + b. */
  total: number
  /** A-level spec (original identity, even if sides were swapped internally). */
  a: number
  /** B-level spec (original identity). */
  b: number
  /** Signed deviation total - target. */
  deviation: number
}

const WORD_MASK = (1n << BigInt(WORD_BITS)) - 1n

/** Index of the lowest set bit of a non-zero bigint. */
function lowestSetBit(x: bigint): number {
  let offset = 0
  while ((x & WORD_MASK) === 0n) {
    x >>= BigInt(WORD_BITS)
    offset += WORD_BITS
  }
  const word = Number(x & WORD_MASK)
  return offset + (31 - Math.clz32(word & -word))
}

/** Index of the highest set bit of a non-zero bigint. */
function highestSetBit(x: bigint): number {
  let offset = 0
  const top = 1n << BigInt(WORD_BITS)
  while (x >= top) {
    x >>= BigInt(WORD_BITS)
    offset += WORD_BITS
  }
  const word = Number(x)
  return offset + (31 - Math.clz32(word))
}

/**
 * Extract one witness pair for an exact sum s from the shared bitsets.
 * Returns null when s is not reachable. When several pairs sum to s, the
 * one with the smallest A-level spec is returned — without enumerating
 * pairs: each set bit of (shifted maskSmall AND reversedLarge) encodes one
 * pair, so a single lowest/highest bit lookup picks the right one.
 */
function witnessForSum(index: ReachabilityIndex, s: number): { a: number; b: number } | null {
  const { maskSmall, reversedLarge, maxLarge, swapped } = index
  const delta = BigInt(maxLarge)
  const t = BigInt(s)
  const shifted = s <= maxLarge ? maskSmall << (delta - t) : maskSmall >> (t - delta)
  const hit = shifted & reversedLarge
  if (hit === 0n) return null

  // A set bit at position p pairs small-side value (p - maxLarge + s) with
  // large-side value (maxLarge - p); they always sum to s. Minimizing the
  // original A spec means minimizing the small-side value when A is the
  // shifted side (lowest set bit) and minimizing maxLarge - p when A is the
  // reversed side (highest set bit).
  const p = swapped ? highestSetBit(hit) : lowestSetBit(hit)
  const smallVal = p - maxLarge + s
  const largeVal = maxLarge - p
  return swapped ? { a: largeVal, b: smallVal } : { a: smallVal, b: largeVal }
}

/**
 * Nearest reachable total thickness within target ± tolerance.
 * Selection order: smallest |total - target|, then smaller total, then
 * smaller A-level spec. Returns null when nothing is reachable in range.
 * Runs entirely on the prebuilt bitsets — no A × B pair enumeration.
 */
export function nearestReachable(
  index: ReachabilityIndex,
  target: number,
  tolerance: number,
): NearbyHit | null {
  const maxSum = index.maxSmall + index.maxLarge
  for (let d = 0; d <= tolerance; d++) {
    const lo = target - d
    const hi = target + d
    if (lo < 0 && hi > maxSum) break // wider deviations can only get worse
    if (lo >= 0) {
      const w = witnessForSum(index, lo)
      if (w) return { ...w, total: lo, deviation: lo - target }
    }
    if (d === 0) continue
    if (hi <= maxSum) {
      const w = witnessForSum(index, hi)
      if (w) return { ...w, total: hi, deviation: hi - target }
    }
  }
  return null
}
