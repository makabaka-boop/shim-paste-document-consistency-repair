import { describe, it, expect } from 'vitest'
import { createSolverEngine } from './lib/engine'
import { INVALID_INPUT } from './lib/validation'

const VALID = JSON.stringify({ a: [0, 3], b: [1, 2], targets: [1, 100] })
const VALID_2 = JSON.stringify({ a: [10], b: [20], targets: [30] })

describe('engine — bitset reuse across batch and nearby queries', () => {
  it('has no cached input before the first valid solve', () => {
    const engine = createSolverEngine()
    expect(engine.hasInput()).toBe(false)
    expect(engine.nearby(1, 100)).toBeNull()
  })

  it('nearby reuses the index built by the last valid batch input', () => {
    const engine = createSolverEngine()
    const outcome = engine.solve(VALID)
    expect(engine.hasInput()).toBe(true)
    expect(outcome.reachable).toEqual([true, false])
    // sums of {0,3}+{1,2} are {1,2,3,4,5}; nearest to 100 within 100 is 5
    expect(engine.nearby(100, 100)).toEqual({ total: 5, a: 3, b: 2, deviation: -95 })
    // exact target resolves to a concrete pair with zero deviation
    expect(engine.nearby(1, 0)).toEqual({ total: 1, a: 0, b: 1, deviation: 0 })
  })

  it('a new valid input replaces the cached index', () => {
    const engine = createSolverEngine()
    engine.solve(VALID)
    engine.solve(VALID_2)
    expect(engine.nearby(28, 100)).toEqual({ total: 30, a: 10, b: 20, deviation: 2 })
    expect(engine.nearby(5, 100)).toEqual({ total: 30, a: 10, b: 20, deviation: 25 })
  })

  it('a new input that fails validation revokes the old witness basis', () => {
    const engine = createSolverEngine()
    engine.solve(VALID)
    expect(engine.nearby(100, 100)).not.toBeNull()
    expect(() => engine.solve('not json')).toThrow(INVALID_INPUT)
    expect(engine.hasInput()).toBe(false)
    expect(engine.nearby(100, 100)).toBeNull()
  })

  it('rejects out-of-contract tolerances without touching the cache', () => {
    const engine = createSolverEngine()
    engine.solve(VALID)
    expect(engine.nearby(100, -1)).toBeNull()
    expect(engine.nearby(100, 1001)).toBeNull()
    expect(engine.nearby(100, 1.5)).toBeNull()
    expect(engine.nearby(100, Number.NaN)).toBeNull()
    expect(engine.hasInput()).toBe(true)
    expect(engine.nearby(100, 1000)).toEqual({ total: 5, a: 3, b: 2, deviation: -95 })
  })
})
