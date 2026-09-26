import { memo, useEffect, useRef, useState } from 'react'

export const ROW_HEIGHT = 30
const OVERSCAN = 10

/** Display state of one row's nearby-spec query. */
export type NearbyVerdict =
  | { status: 'pending' }
  | { status: 'found'; a: number; b: number; total: number; deviation: number }
  | { status: 'none' }

export interface ResultRowProps {
  index: number
  target: number
  reachable: boolean
  nearby: NearbyVerdict | undefined
  onQueryNearby: (rowIndex: number, target: number) => void
}

function formatDeviation(deviation: number): string {
  return deviation > 0 ? `+${deviation}` : `${deviation}`
}

function ResultRowComponent({ index, target, reachable, nearby, onQueryNearby }: ResultRowProps) {
  return (
    <div
      className={`result-row ${reachable ? 'is-reachable' : 'is-unreachable'}`}
      style={{ top: index * ROW_HEIGHT }}
    >
      <span className="cell-index">#{index + 1}</span>
      <span className="cell-target">{target}</span>
      <span className="cell-verdict">{reachable ? 'true' : 'false'}</span>
      <span className="cell-nearby">
        <button
          type="button"
          className="nearby-button"
          onClick={() => onQueryNearby(index, target)}
        >
          邻近查询
        </button>
        {nearby?.status === 'pending' && (
          <span className="nearby-result is-pending">查询中…</span>
        )}
        {nearby?.status === 'found' && (
          <span className="nearby-result is-found">
            A={nearby.a} B={nearby.b} 偏差{formatDeviation(nearby.deviation)}
          </span>
        )}
        {nearby?.status === 'none' && (
          <span className="nearby-result is-none">容差内无可达</span>
        )}
      </span>
    </div>
  )
}

const MemoizedRow = memo(ResultRowComponent)

interface VirtualResultsProps {
  targets: number[]
  reachable: boolean[]
  nearbyRows: ReadonlyMap<number, NearbyVerdict>
  onQueryNearby: (rowIndex: number, target: number) => void
}

export function VirtualResults({ targets, reachable, nearbyRows, onQueryNearby }: VirtualResultsProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const totalCount = targets.length

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Reset scroll when a fresh result set arrives.
  useEffect(() => {
    setScrollTop(0)
    if (viewportRef.current) viewportRef.current.scrollTop = 0
  }, [targets])

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(totalCount, start + visibleCount)
  const rows = []
  for (let i = start; i < end; i++) {
    rows.push(
      <MemoizedRow
        key={i}
        index={i}
        target={targets[i]}
        reachable={reachable[i]}
        nearby={nearbyRows.get(i)}
        onQueryNearby={onQueryNearby}
      />,
    )
  }

  return (
    <div
      className="results-viewport"
      ref={viewportRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="results-spacer" style={{ height: totalCount * ROW_HEIGHT }}>
        {rows}
      </div>
    </div>
  )
}
