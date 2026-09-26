/// <reference lib="webworker" />
/**
 * Worker: keeps the (up to 100k × 100k) computation off the UI thread so
 * the page stays responsive while exact reachability is solved.
 *
 * The engine caches the bitset index of the last valid input, so nearby-spec
 * queries reuse it and extract the actual hit witness here in the Worker
 * without re-encoding the shim lists or enumerating A × B pairs.
 */
import { createSolverEngine } from './lib/engine'
import { handleRequest, type WorkerRequest } from './lib/protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope
const engine = createSolverEngine(() => ctx.performance.now())

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  ctx.postMessage(handleRequest(engine, event.data))
}
