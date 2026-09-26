// @vitest-environment jsdom
/**
 * UI tests for the nearby-spec query: input replacement (换稿), post-failure
 * state, invalid-tolerance retention, and late worker responses.
 *
 * The Worker global is faked, but the fake drives the real engine and
 * protocol handler, so cache/revocation semantics are genuinely exercised.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import App from './App'
import { createSolverEngine } from './lib/engine'
import { handleRequest, type WorkerRequest, type WorkerResponse } from './lib/protocol'

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  readonly requests: WorkerRequest[] = []
  autoFlush = true

  private readonly engine = createSolverEngine()
  private readonly pending: WorkerResponse[] = []

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(req: WorkerRequest) {
    this.requests.push(req)
    const res = handleRequest(this.engine, req)
    if (this.autoFlush) this.deliver(res)
    else this.pending.push(res)
  }

  /** Deliver the oldest queued response, like a FIFO worker would. */
  flushNext() {
    const res = this.pending.shift()
    if (res) this.deliver(res)
  }

  flushAll() {
    while (this.pending.length > 0) this.flushNext()
  }

  nearbyRequestCount() {
    return this.requests.filter((r) => r.kind === 'nearby').length
  }

  private deliver(res: WorkerResponse) {
    const handler = this.onmessage
    if (!handler) return
    queueMicrotask(() => handler({ data: res } as MessageEvent<WorkerResponse>))
  }

  terminate() {}
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Let queued microtasks (worker deliveries + React renders) settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function worker(): FakeWorker {
  expect(FakeWorker.instances).toHaveLength(1)
  return FakeWorker.instances[0]
}

function jsonInput() {
  return screen.getByPlaceholderText('{"a":[0,3],"b":[1,2],"targets":[1,3,4]}')
}

function toleranceInput() {
  return screen.getByLabelText('邻近查询容差 (µm)')
}

function computeButton() {
  return screen.getByRole('button', { name: '计算可达性' })
}

function nearbyButtons() {
  return screen.queryAllByRole('button', { name: '邻近查询' })
}

function setJson(value: string) {
  fireEvent.change(jsonInput(), { target: { value } })
}

async function compute(value: string) {
  setJson(value)
  fireEvent.click(computeButton())
  await flush()
}

const INPUT_A = JSON.stringify({ a: [0, 3], b: [1, 2], targets: [4, 1, 4, 100] })
const INPUT_B = JSON.stringify({ a: [10], b: [20], targets: [30] })

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App — batch results and nearby-spec query', () => {
  it('keeps batch order/duplicates and answers a per-row nearby query', async () => {
    const { container } = render(<App />)
    await compute(INPUT_A)

    // Batch results: original order, duplicates kept.
    const targets = [...container.querySelectorAll('.results-viewport .cell-target')]
    expect(targets.map((el) => el.textContent)).toEqual(['4', '1', '4', '100'])
    const verdicts = [...container.querySelectorAll('.results-viewport .cell-verdict')]
    expect(verdicts.map((el) => el.textContent)).toEqual(['true', 'true', 'true', 'false'])

    // Query the unreachable row (target 100, tolerance 100): nearest sum of
    // {0,3}+{1,2} is 5 = 3+2.
    fireEvent.click(nearbyButtons()[3])
    await flush()
    expect(screen.getByText('A=3 B=2 偏差-95')).toBeTruthy()

    // Query a reachable row: exact pair with zero deviation.
    fireEvent.click(nearbyButtons()[1])
    await flush()
    expect(screen.getByText('A=0 B=1 偏差0')).toBeTruthy()

    // Batch rows are untouched by the nearby queries.
    const targetsAfter = [...container.querySelectorAll('.results-viewport .cell-target')]
    expect(targetsAfter.map((el) => el.textContent)).toEqual(['4', '1', '4', '100'])
  })

  it('reports 容差内无可达 when nothing is reachable within tolerance', async () => {
    render(<App />)
    await compute(JSON.stringify({ a: [0, 3], b: [1, 2], targets: [100] }))
    fireEvent.change(toleranceInput(), { target: { value: '10' } })
    fireEvent.click(nearbyButtons()[0])
    await flush()
    expect(screen.getByText('容差内无可达')).toBeTruthy()
  })
})

describe('App — input replacement (换稿)', () => {
  it('a new valid compute revokes the old witness and queries use the new bitset', async () => {
    const { container } = render(<App />)
    await compute(INPUT_A)
    fireEvent.click(nearbyButtons()[3])
    await flush()
    expect(screen.getByText('A=3 B=2 偏差-95')).toBeTruthy()

    await compute(INPUT_B)

    // Old witness revoked; no nearby verdicts remain.
    expect(screen.queryByText('A=3 B=2 偏差-95')).toBeNull()
    expect(container.querySelectorAll('.nearby-result')).toHaveLength(0)

    // New batch results shown.
    const targets = [...container.querySelectorAll('.results-viewport .cell-target')]
    expect(targets.map((el) => el.textContent)).toEqual(['30'])

    // Nearby query now runs against the new input's bitset.
    fireEvent.click(nearbyButtons()[0])
    await flush()
    expect(screen.getByText('A=10 B=20 偏差0')).toBeTruthy()
  })

  it('a late nearby response from the old input never re-appears', async () => {
    const { container } = render(<App />)
    const w = worker()
    w.autoFlush = false

    // Batch #1 completes.
    setJson(JSON.stringify({ a: [0, 3], b: [1, 2], targets: [100] }))
    fireEvent.click(computeButton())
    await act(async () => {
      w.flushAll()
    })
    expect(screen.getByText('100')).toBeTruthy()

    // Nearby query issued; its response is still in flight.
    fireEvent.click(nearbyButtons()[0])
    expect(screen.getByText('查询中…')).toBeTruthy()

    // User replaces the input and recomputes before the response lands.
    setJson(INPUT_B)
    fireEvent.click(computeButton())
    expect(screen.queryByText('查询中…')).toBeNull()

    // The stale nearby response arrives first (FIFO) and must be dropped.
    await act(async () => {
      w.flushNext()
    })
    expect(screen.queryByText('A=3 B=2 偏差-95')).toBeNull()
    expect(container.querySelectorAll('.nearby-result')).toHaveLength(0)

    // Batch #2 completes; still no stale witness.
    await act(async () => {
      w.flushAll()
    })
    const targets = [...container.querySelectorAll('.results-viewport .cell-target')]
    expect(targets.map((el) => el.textContent)).toEqual(['30'])
    expect(screen.queryByText('A=3 B=2 偏差-95')).toBeNull()
  })
})

describe('App — failure handling', () => {
  it('INVALID_INPUT on the new input clears results and the old witness', async () => {
    render(<App />)
    await compute(INPUT_A)
    fireEvent.click(nearbyButtons()[3])
    await flush()
    expect(screen.getByText('A=3 B=2 偏差-95')).toBeTruthy()

    await compute('{invalid json')

    expect(screen.getAllByText('INVALID_INPUT').length).toBeGreaterThan(0)
    expect(screen.queryByText('A=3 B=2 偏差-95')).toBeNull()
    expect(nearbyButtons()).toHaveLength(0)

    // Recovery: a fresh valid input works and nearby uses its bitset.
    await compute(INPUT_B)
    fireEvent.click(nearbyButtons()[0])
    await flush()
    expect(screen.getByText('A=10 B=20 偏差0')).toBeTruthy()
  })
})

describe('App — invalid tolerance keeps the last valid nearby query', () => {
  it('retains the previous verdict and issues no new request', async () => {
    render(<App />)
    const w = worker()
    await compute(JSON.stringify({ a: [0, 3], b: [1, 2], targets: [100] }))

    fireEvent.click(nearbyButtons()[0])
    await flush()
    expect(screen.getByText('A=3 B=2 偏差-95')).toBeTruthy()
    expect(w.nearbyRequestCount()).toBe(1)

    // Out-of-range tolerance: previous verdict stays, hint shown, no request.
    fireEvent.change(toleranceInput(), { target: { value: '1001' } })
    fireEvent.click(nearbyButtons()[0])
    await flush()
    expect(screen.getByText('A=3 B=2 偏差-95')).toBeTruthy()
    expect(screen.getByText('容差需为 0–1000 的整数')).toBeTruthy()
    expect(w.nearbyRequestCount()).toBe(1)

    // Non-numeric tolerance behaves the same.
    fireEvent.change(toleranceInput(), { target: { value: 'abc' } })
    fireEvent.click(nearbyButtons()[0])
    await flush()
    expect(screen.getByText('A=3 B=2 偏差-95')).toBeTruthy()
    expect(w.nearbyRequestCount()).toBe(1)

    // A valid tolerance again replaces the verdict with the fresh answer.
    fireEvent.change(toleranceInput(), { target: { value: '0' } })
    fireEvent.click(nearbyButtons()[0])
    await flush()
    expect(w.nearbyRequestCount()).toBe(2)
    expect(screen.getByText('容差内无可达')).toBeTruthy()
    expect(screen.queryByText('A=3 B=2 偏差-95')).toBeNull()
  })
})
