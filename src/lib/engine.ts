/**
 * Solver engine: holds the bitset index built from the most recent *valid*
 * input so that interactive nearby-spec queries reuse it instead of
 * re-encoding the shim lists. A new batch solve replaces the cache; a batch
 * whose input fails validation drops it, which revokes the basis of any
 * previously shown witness.
 */
import { parseInput, TOLERANCE_MAX, TOLERANCE_MIN } from './validation'
import {
  buildIndex,
  nearestReachable,
  reachableWithIndex,
  type NearbyHit,
  type ReachabilityIndex,
} from './solver'

export interface SolveOutcome {
  targets: number[]
  reachable: boolean[]
  distinctA: number
  distinctB: number
  elapsedMs: number
}

export interface SolverEngine {
  /**
   * Parse and solve a batch input. On success the new index becomes the one
   * used by nearby(). Throws InvalidInputError on any contract violation and
   * drops the cached index in that case.
   */
  solve(text: string): SolveOutcome
  /**
   * Nearest reachable total within target ± tolerance, computed on the
   * cached index of the last valid input. Returns null when no valid input
   * is cached, the tolerance is out of contract, or nothing is reachable.
   */
  nearby(target: number, tolerance: number): NearbyHit | null
  /** Whether a valid input's index is currently cached. */
  hasInput(): boolean
}

export function createSolverEngine(now: () => number = () => performance.now()): SolverEngine {
  let cached: ReachabilityIndex | null = null

  return {
    solve(text: string): SolveOutcome {
      try {
        const { a, b, targets } = parseInput(text)
        const started = now()
        const index = buildIndex(a, b)
        const reachable = reachableWithIndex(index, targets)
        const elapsedMs = now() - started
        cached = index
        return {
          targets,
          reachable,
          distinctA: index.distinctA.length,
          distinctB: index.distinctB.length,
          elapsedMs,
        }
      } catch (err) {
        cached = null
        throw err
      }
    },

    nearby(target: number, tolerance: number): NearbyHit | null {
      if (!cached) return null
      if (!Number.isInteger(tolerance) || tolerance < TOLERANCE_MIN || tolerance > TOLERANCE_MAX) {
        return null
      }
      return nearestReachable(cached, target, tolerance)
    },

    hasInput(): boolean {
      return cached !== null
    },
  }
}
