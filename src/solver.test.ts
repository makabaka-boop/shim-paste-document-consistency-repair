import { describe, it, expect } from 'vitest'
import { solve, buildIndex, nearestReachable, type NearbyHit } from './lib/solver'

/**
 * Naive O(|A|·|B|) reference. Only used on small samples in tests;
 * the production solver must never enumerate pairs like this.
 */
function naiveReachable(a: number[], b: number[], targets: number[]): boolean[] {
  const sums = new Set<number>()
  for (const x of a) for (const y of b) sums.add(x + y)
  return targets.map((t) => sums.has(t))
}

interface CaseSpec {
  name: string
  a: number[]
  b: number[]
  targets: number[]
}

function checkExact({ a, b, targets }: CaseSpec) {
  const { reachable } = solve(a, b, targets)
  const expected = naiveReachable(a, b, targets)
  expect(reachable).toHaveLength(targets.length)
  expect(reachable).toEqual(expected)
}

describe('solver — naive small samples', () => {
  const smallCases: CaseSpec[] = [
    {
      name: 'basic mixed',
      a: [0, 3, 7, 50, 200],
      b: [1, 2, 9, 100],
      targets: [0, 1, 2, 3, 4, 5, 9, 10, 11, 52, 150, 201, 209, 300, 400000],
    },
    {
      name: 'zeroes only',
      a: [0],
      b: [0],
      targets: [0, 1, 200000, 400000],
    },
    {
      name: 'maximum boundary values',
      a: [200000],
      b: [200000],
      targets: [0, 199999, 200000, 399999, 400000],
    },
    {
      name: 'zero plus max',
      a: [0, 200000],
      b: [0, 200000],
      targets: [0, 1, 200000, 200001, 399999, 400000],
    },
    {
      name: 'duplicates collapse to same spec',
      a: [3, 3, 3, 7, 7],
      b: [1, 1, 5],
      targets: [3, 4, 6, 8, 10, 12, 13],
    },
    {
      name: 'duplicated targets keep order and identical verdicts',
      a: [1, 4, 6],
      b: [2, 8],
      targets: [3, 9, 3, 3, 14, 9, 0, 14, 7],
    },
    {
      name: 'unordered inputs',
      a: [200, 0, 50, 3, 7],
      b: [100, 2, 9, 1],
      targets: [201, 4, 0, 59, 300, 1],
    },
    {
      name: 'single element each',
      a: [123],
      b: [456],
      targets: [579, 578, 580, 0, 123, 456],
    },
    {
      name: 'bitset word boundary values',
      a: [31],
      b: [0, 1],
      targets: [31, 32, 1, 2, 31],
    },
    {
      name: 'adjacent small values',
      a: [0, 1, 2],
      b: [0, 1, 2],
      targets: [0, 1, 2, 3, 4, 5, 6],
    },
  ]

  for (const spec of smallCases) {
    it(spec.name, () => checkExact(spec))
  }

  it('symmetric in A and B', () => {
    const a = [2, 5, 9, 100]
    const b = [1, 7, 8, 60, 200]
    const targets = [0, 3, 6, 12, 62, 101, 207, 300]
    expect(solve(a, b, targets).reachable).toEqual(solve(b, a, targets).reachable)
  })
})

describe('solver — dense sets', () => {
  it('dense intervals: t reachable iff t in [lo, hi] integer', () => {
    // A = 0..50000, B = 0..50000  => every t in 0..100000 reachable
    const a: number[] = []
    const b: number[] = []
    for (let i = 0; i <= 50000; i++) {
      a.push(i)
      b.push(i)
    }
    const targets = [
      0, 1, 2, 99999, 100000, 100001, 200000, 400000, 25000, 75000, 50000,
    ]
    const { reachable } = solve(a, b, targets)
    expect(reachable).toEqual([
      true, true, true, true, true, false, false, false, true, true, true,
    ])
  })

  it('interval × even spread matches naive on sampled targets', () => {
    const a: number[] = []
    const b: number[] = []
    for (let i = 0; i < 3000; i++) a.push(i)
    for (let i = 0; i < 3000; i++) b.push((i * 2) % 200001) // spread evens, in range
    const targets: number[] = []
    for (let t = 0; t <= 400000; t += 997) targets.push(t)
    targets.push(0, 400000)
    checkExact({ name: '', a, b, targets })
  })

  it('two shifted dense intervals', () => {
    // A = 10000..40000, B = 5000..8000 => reachable 15000..48000
    const a: number[] = []
    const b: number[] = []
    for (let i = 10000; i <= 40000; i++) a.push(i)
    for (let i = 5000; i <= 8000; i++) b.push(i)
    const targets = [14999, 15000, 20000, 48000, 48001, 0, 100000]
    const { reachable } = solve(a, b, targets)
    expect(reachable).toEqual([false, true, true, true, false, false, false])
  })
})

describe('solver — sparse sets', () => {
  // Deterministic xorshift so the test is reproducible.
  function xorshiftValues(n: number, max: number, seed: number): number[] {
    let x = seed >>> 0 || 1
    const out = new Set<number>()
    while (out.size < n) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      out.add(x % (max + 1))
    }
    return [...out]
  }

  it('medium sparse sets match naive on every target in range', () => {
    const a = xorshiftValues(300, 200000, 11)
    const b = xorshiftValues(250, 200000, 29)
    const targets: number[] = []
    for (let t = 0; t <= 400000; t += 1321) targets.push(t)
    checkExact({ name: '', a, b, targets })
  })

  it('extreme sparse: far-apart values and gaps', () => {
    const a = [0, 50000, 100000, 150000, 200000]
    const b = [0, 37, 99999, 200000]
    const targets = [0, 37, 50000, 50037, 149999, 150000, 200000, 250000, 300000, 399999, 400000]
    checkExact({ name: '', a, b, targets })
  })

  it('one tiny side, one large sparse side', () => {
    const small = [0, 7]
    const large = xorshiftValues(50000, 200000, 71)
    const targets = [0, 7, 8, 400000, 200000, 123457, 399993]
    checkExact({ name: '', a: small, b: large, targets })
  })

  it('full-scale sparse 100k x 100k: boundary targets and self-consistency', () => {
    const a = xorshiftValues(100000, 200000, 101)
    const b = xorshiftValues(100000, 200000, 202)
    const targets = [0, 1, 200000, 200001, 399999, 400000]
    const r1 = solve(a, b, targets).reachable
    const r2 = solve(a, b, targets).reachable
    // reproducible
    expect(r1).toEqual(r2)
    // 0 reachable only iff both contain 0
    const hasA0 = a.includes(0)
    const hasB0 = b.includes(0)
    expect(r1[0]).toBe(hasA0 && hasB0)
    // 400000 reachable only iff both contain 200000
    const hasAMax = a.includes(200000)
    const hasBMax = b.includes(200000)
    expect(r1[targets.length - 1]).toBe(hasAMax && hasBMax)
  })

  it('full-scale with boundary values present: zero and max reachable', () => {
    function withEndpoints(seed: number): number[] {
      const vals = xorshiftValues(99998, 199999, seed).map((v) => (v === 0 ? 1 : v))
      return [0, 200000, ...vals]
    }
    const a = withEndpoints(303)
    const b = withEndpoints(404)
    expect(a.length).toBe(100000)
    const { reachable } = solve(a, b, [0, 400000, 1, 399999])
    expect(reachable[0]).toBe(true)
    expect(reachable[1]).toBe(true)
  })
})

describe('solver — result shape', () => {
  it('returns sorted distinct spec lists', () => {
    const result = solve([9, 1, 9, 3], [5, 5, 2], [0, 3])
    expect(result.distinctA).toEqual([1, 3, 9])
    expect(result.distinctB).toEqual([2, 5])
  })

  it('repeated target verdicts are identical and in original order', () => {
    const a = [2, 8]
    const b = [3, 9]
    const targets = [11, 5, 11, 17, 5, 11]
    const { reachable } = solve(a, b, targets)
    expect(reachable).toEqual([true, true, true, true, true, true])
    const targets2 = [12, 11, 12, 4, 11]
    expect(solve(a, b, targets2).reachable).toEqual([false, true, false, false, true])
  })
})

/**
 * Naive O(|A|·|B|) reference for the nearby-spec query. Only used on small
 * samples in tests; the production query must never enumerate pairs.
 * Selection order: smallest |total - target|, then smaller total, then
 * smaller A-level spec.
 */
function naiveNearest(
  a: number[],
  b: number[],
  target: number,
  tolerance: number,
): NearbyHit | null {
  let best: NearbyHit | null = null
  for (const x of a) {
    for (const y of b) {
      const total = x + y
      const deviation = total - target
      if (Math.abs(deviation) > tolerance) continue
      if (
        best === null ||
        Math.abs(deviation) < Math.abs(best.deviation) ||
        (Math.abs(deviation) === Math.abs(best.deviation) && total < best.total) ||
        (Math.abs(deviation) === Math.abs(best.deviation) &&
          total === best.total &&
          x < best.a)
      ) {
        best = { total, a: x, b: y, deviation }
      }
    }
  }
  return best
}

function checkNearest(a: number[], b: number[], target: number, tolerance: number) {
  const hit = nearestReachable(buildIndex(a, b), target, tolerance)
  const expected = naiveNearest(a, b, target, tolerance)
  expect(hit).toEqual(expected)
  if (hit !== null) {
    // The witness must be a genuine pair from the two levels.
    expect(a).toContain(hit.a)
    expect(b).toContain(hit.b)
    expect(hit.a + hit.b).toBe(hit.total)
    expect(hit.deviation).toBe(hit.total - target)
  }
}

describe('nearestReachable — small Cartesian product vs naive', () => {
  // Includes duplicates, zeroes, and uneven side lengths (which force the
  // internal A/B swap in both directions).
  const aCases = [
    [0],
    [5],
    [0, 1],
    [1, 3],
    [0, 2, 5],
    [3, 3, 7],
    [0, 4, 4, 9],
    [2, 5, 5, 8, 11],
  ]
  const bCases = [
    [0],
    [7],
    [0, 2],
    [1, 1, 4],
    [2, 5],
    [0, 0, 6],
    [1, 3, 3],
  ]
  const tolerances = [0, 1, 2, 3, 5, 8, 1000]

  for (const a of aCases) {
    for (const b of bCases) {
      for (let target = 0; target <= 16; target++) {
        for (const tolerance of tolerances) {
          it(`a=[${a}] b=[${b}] target=${target} tol=${tolerance}`, () => {
            checkNearest(a, b, target, tolerance)
          })
        }
      }
    }
  }
})

describe('nearestReachable — selection order', () => {
  it('prefers the smaller total when both sides deviate equally', () => {
    // sums: 8 and 12, both |dev| = 2 from target 10 → pick 8
    const hit = nearestReachable(buildIndex([0], [8, 12]), 10, 2)
    expect(hit).toEqual({ total: 8, a: 0, b: 8, deviation: -2 })
  })

  it('prefers the exact sum over any deviation', () => {
    const hit = nearestReachable(buildIndex([0, 4], [3, 9]), 7, 1000)
    expect(hit).toEqual({ total: 7, a: 4, b: 3, deviation: 0 })
  })

  it('prefers the smaller A spec when pairs share the same total', () => {
    // total 7 reachable as (1, 6) and (4, 3) → A = 1
    const hit = nearestReachable(buildIndex([1, 4], [3, 6]), 7, 0)
    expect(hit).toEqual({ total: 7, a: 1, b: 6, deviation: 0 })
  })

  it('keeps original A/B identity when the sides are swapped internally', () => {
    // |A| > |B| forces the swap; total 7 reachable as (1, 6) and (4, 3).
    const hit = nearestReachable(buildIndex([1, 4, 9], [3, 6]), 7, 0)
    expect(hit).toEqual({ total: 7, a: 1, b: 6, deviation: 0 })
    // Same sums with A as the reversed side: total 7 as (3, 4) and (6, 1).
    const hit2 = nearestReachable(buildIndex([3, 6], [1, 4, 9]), 7, 0)
    expect(hit2).toEqual({ total: 7, a: 3, b: 4, deviation: 0 })
  })

  it('returns null when nothing is reachable within tolerance', () => {
    expect(nearestReachable(buildIndex([0], [0]), 5, 3)).toBeNull()
    expect(nearestReachable(buildIndex([10], [20]), 0, 29)).toBeNull()
  })
})

describe('nearestReachable — zeroes, duplicates, boundaries', () => {
  it('zero shims sum to zero with zero deviation', () => {
    const hit = nearestReachable(buildIndex([0], [0]), 0, 0)
    expect(hit).toEqual({ total: 0, a: 0, b: 0, deviation: 0 })
  })

  it('target zero only searches upward', () => {
    const hit = nearestReachable(buildIndex([0, 4], [1, 9]), 0, 1000)
    expect(hit).toEqual({ total: 1, a: 0, b: 1, deviation: 1 })
  })

  it('duplicate specs collapse and still yield a usable pair', () => {
    const hit = nearestReachable(buildIndex([5, 5, 5], [7, 7]), 12, 0)
    expect(hit).toEqual({ total: 12, a: 5, b: 7, deviation: 0 })
  })

  it('tolerance 0 requires an exact hit', () => {
    expect(nearestReachable(buildIndex([0, 3], [1, 2]), 4, 0)).toEqual({
      total: 4,
      a: 3,
      b: 1,
      deviation: 0,
    })
    expect(nearestReachable(buildIndex([0, 3], [1, 2]), 6, 0)).toBeNull()
  })

  it('tolerance 1000 admits a deviation of exactly 1000', () => {
    const hit = nearestReachable(buildIndex([200000], [200000]), 399000, 1000)
    expect(hit).toEqual({ total: 400000, a: 200000, b: 200000, deviation: 1000 })
    expect(nearestReachable(buildIndex([200000], [200000]), 398999, 1000)).toBeNull()
  })

  it('maximum target boundary', () => {
    const hit = nearestReachable(buildIndex([200000], [200000]), 400000, 0)
    expect(hit).toEqual({ total: 400000, a: 200000, b: 200000, deviation: 0 })
  })

  it('reuses one index for batch and nearby queries consistently', () => {
    const a = [0, 3, 50, 200000]
    const b = [0, 1, 9, 100, 200000]
    const index = buildIndex(a, b)
    const targets = [0, 1, 3, 4, 53, 300, 200000, 400000, 0]
    const { reachable } = solve(a, b, targets)
    for (let i = 0; i < targets.length; i++) {
      const hit = nearestReachable(index, targets[i], 0)
      if (reachable[i]) {
        expect(hit).not.toBeNull()
        expect(hit!.deviation).toBe(0)
        expect(hit!.a + hit!.b).toBe(targets[i])
      } else {
        expect(hit).toBeNull()
      }
    }
  })
})
