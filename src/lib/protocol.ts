/**
 * Message protocol between the UI and the solver worker, plus the shared
 * request handler. Kept environment-free so both the worker and the UI
 * tests drive the exact same logic.
 */
import { InvalidInputError } from './validation'
import type { SolverEngine } from './engine'

export type SolveRequest = { kind: 'solve'; id: number; text: string }

export type NearbyRequest = {
  kind: 'nearby'
  id: number
  /** Batch generation the query belongs to; lets the UI drop late responses. */
  session: number
  rowIndex: number
  target: number
  tolerance: number
}

export type WorkerRequest = SolveRequest | NearbyRequest

export type SolveResponse =
  | {
      id: number
      kind: 'ok'
      targets: number[]
      reachable: boolean[]
      distinctA: number
      distinctB: number
      elapsedMs: number
    }
  | { id: number; kind: 'invalid' }
  | { id: number; kind: 'error'; message: string }

export type NearbyResponse =
  | {
      kind: 'nearby'
      id: number
      session: number
      rowIndex: number
      found: true
      a: number
      b: number
      total: number
      deviation: number
    }
  | { kind: 'nearby'; id: number; session: number; rowIndex: number; found: false }

export type WorkerResponse = SolveResponse | NearbyResponse

export function handleRequest(engine: SolverEngine, req: WorkerRequest): WorkerResponse {
  if (req.kind === 'nearby') {
    const hit = engine.nearby(req.target, req.tolerance)
    const base = {
      kind: 'nearby' as const,
      id: req.id,
      session: req.session,
      rowIndex: req.rowIndex,
    }
    return hit
      ? {
          ...base,
          found: true,
          a: hit.a,
          b: hit.b,
          total: hit.total,
          deviation: hit.deviation,
        }
      : { ...base, found: false }
  }

  try {
    const outcome = engine.solve(req.text)
    return {
      id: req.id,
      kind: 'ok',
      targets: outcome.targets,
      reachable: outcome.reachable,
      distinctA: outcome.distinctA,
      distinctB: outcome.distinctB,
      elapsedMs: outcome.elapsedMs,
    }
  } catch (err) {
    if (err instanceof InvalidInputError) {
      return { id: req.id, kind: 'invalid' }
    }
    return {
      id: req.id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
