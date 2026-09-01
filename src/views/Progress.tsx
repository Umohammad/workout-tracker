import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { entryRatio, formatDate, ratioColor, repsSummary } from '../sessions'
import { MUSCLE_GROUPS, SessionEntry, sidesFor } from '../types'

type Metric = 'weight' | '1rm' | 'volume'

interface Point {
  date: string
  weight: number
  ratio: number
  reps: (number | null)[]
  targetSets: number
  targetReps: number
  value: number // value under the current metric
}

// Epley estimate off the best single set. Deliberately per side: the 1RM of a
// single-arm press is what one arm can do, which is the number you program off.
function est1RM(e: SessionEntry): number {
  let best = 0
  for (const r of e.reps) {
    if (r === null || r <= 0) continue
    const v = e.weight * (1 + Math.min(r, 12) / 30)
    if (v > best) best = v
  }
  return Math.round(best * 10) / 10
}

// Total work: weight × reps summed, doubled for per-side work (a 30 lb dumbbell
// in each hand moves 60 lb a rep). For bodyweight work it's just total reps.
function volumeOf(e: SessionEntry, sides: 1 | 2): number {
  const totalReps = e.reps.reduce<number>((a, b) => a + (b ?? 0), 0)
  return e.weight > 0 ? e.weight * totalReps * sides : totalReps
}

export default function Progress({ initialExerciseId }: { initialExerciseId?: string }) {
  const { data } = useStore()
  const unit = data.settings.unit

  const entriesFor = (exId: string) =>
    [...data.sessions]
      .filter(s => s.finished)
      .sort((a, b) => a.startedAt - b.startedAt)
      .flatMap(s => {
        const e = s.entries.find(en => en.exerciseId === exId && en.reps.some(r => r !== null))
        return e ? [{ s, e }] : []
      })

  const firstWithData = data.exercises.find(e => entriesFor(e.id).length > 0)
  const [exId, setExId] = useState(initialExerciseId ?? firstWithData?.id ?? data.exercises[0]?.id ?? '')
  const [metric, setMetric] = useState<Metric>('weight')
  const [sel, setSel] = useState<number | null>(null)

  const ex = data.exercises.find(e => e.id === exId)
  const sides = sidesFor(ex)

  const raw = useMemo(() => (exId ? entriesFor(exId) : []), [exId, data.sessions])
  const isWeighted = raw.some(({ e }) => e.weight > 0)
  const effMetric: Metric = !isWeighted && metric === '1rm' ? 'weight' : metric

  const points: Point[] = raw.map(({ s, e }) => ({
    date: s.date,
    weight: e.weight,
    ratio: entryRatio(e),
    reps: e.reps,
    targetSets: e.targetSets,
    targetReps: e.targetReps,
    value: effMetric === 'weight' ? e.weight : effMetric === '1rm' ? est1RM(e) : volumeOf(e, sides),
  }))

  const selIdx = sel !== null && sel < points.length ? sel : points.length - 1
  const selPt = selIdx >= 0 ? points[selIdx] : null

  // PR = strictly better than everything before it (needs at least one prior point)
  const isPR = (i: number) => i > 0 && points[i].value > Math.max(...points.slice(0, i).map(p => p.value))

  const metricUnit = effMetric === 'volume' ? (isWeighted ? unit : 'reps') : unit

  // ---- chart geometry ----
  const W = 360
  const H = 230
  const L = 46
  const R = 16
  const T = 20
  const B = 30
  let chart = null
  if (points.length > 0) {
    const vs = points.map(p => p.value)
    let lo = Math.min(...vs)
    let hi = Math.max(...vs)
    const minSpan = effMetric === 'volume' ? Math.max(10, hi * 0.1) : 10
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2
      lo = mid - minSpan / 2
      hi = mid + minSpan / 2
    } else {
      const pad = (hi - lo) * 0.12
      lo -= pad
      hi += pad
    }
    if (lo < 0) lo = 0
    const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1))
    const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo))
    const gridVals = [0, 1, 2, 3].map(i => lo + ((hi - lo) * i) / 3)
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')

    chart = (
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#252b36" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="chartlabel">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {points.length > 1 && <path d={path} fill="none" stroke="#4a5568" strokeWidth={2} />}
        {points.map((p, i) => {
          const r = 4 + 5 * Math.min(1, p.ratio) + (p.ratio > 1 ? 2.5 : 0)
          const pr = isPR(i)
          return (
            <g key={i} onClick={() => setSel(i)} style={{ cursor: 'pointer' }}>
              {pr && <circle cx={x(i)} cy={y(p.value)} r={r + 4} fill="none" stroke="#fbbf24" strokeWidth={2} />}
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={r}
                fill={ratioColor(Math.min(1, p.ratio))}
                stroke={i === selIdx ? '#fff' : 'none'}
                strokeWidth={2}
              />
              {pr && (
                <text x={x(i)} y={y(p.value) - r - 7} textAnchor="middle" className="prlabel">
                  PR
                </text>
              )}
            </g>
          )
        })}
        <text x={L} y={H - 8} className="chartlabel">
          {formatDate(points[0].date)}
        </text>
        {points.length > 1 && (
          <text x={W - R} y={H - 8} textAnchor="end" className="chartlabel">
            {formatDate(points[points.length - 1].date)}
          </text>
        )}
      </svg>
    )
  }

  const best = points.length ? Math.max(...points.map(p => p.value)) : 0
  const last = points.length ? points[points.length - 1].value : 0

  const pinnedEx = data.exercises.filter(e => e.pinned)

  return (
    <div className="page">
      <div className="card formcard">
        <label className="fieldlabel">Exercise</label>
        <select
          value={exId}
          onChange={e => {
            setExId(e.target.value)
            setSel(null)
          }}
        >
          {pinnedEx.length > 0 && (
            <optgroup label="★ Pinned">
              {pinnedEx.map(e => (
                <option key={'pin-' + e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </optgroup>
          )}
          {MUSCLE_GROUPS.map(m => {
            const list = data.exercises.filter(e => e.muscleGroup === m)
            return list.length ? (
              <optgroup key={m} label={m}>
                {list.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ) : null
          })}
        </select>

        <div className="choicegrid metricrow">
          <button className={'choice' + (effMetric === 'weight' ? ' active' : '')} onClick={() => setMetric('weight')}>
            Weight
          </button>
          {isWeighted && (
            <button className={'choice' + (effMetric === '1rm' ? ' active' : '')} onClick={() => setMetric('1rm')}>
              Est. 1RM
            </button>
          )}
          <button className={'choice' + (effMetric === 'volume' ? ' active' : '')} onClick={() => setMetric('volume')}>
            Volume
          </button>
        </div>
      </div>

      {points.length === 0 ? (
        <div className="card">
          <p className="sub">No logged sessions for {ex?.name ?? 'this exercise'} yet. Finish a workout and your progress will show up here. (Tip: Settings → Load demo data to see the app in action.)</p>
        </div>
      ) : (
        <>
          <div className="card chartcard">
            {chart}
            <div className="chartlegend">
              <span><span className="dot" style={{ background: ratioColor(1) }} /> hit goal</span>
              <span><span className="dot small" style={{ background: ratioColor(0.4) }} /> partial</span>
              <span><span className="dot ring" /> PR</span>
            </div>
          </div>

          <div className="statrow">
            <div className="card stat">
              <span className="statnum">{Math.round(best * 10) / 10}</span>
              <span className="sub">best {metricUnit}</span>
            </div>
            <div className="card stat">
              <span className="statnum">{Math.round(last * 10) / 10}</span>
              <span className="sub">last {metricUnit}</span>
            </div>
            <div className="card stat">
              <span className="statnum">{points.length}</span>
              <span className="sub">sessions</span>
            </div>
          </div>

          {selPt && (
            <div className="card detailcard">
              <div className="detailhead">
                <strong>
                  {formatDate(selPt.date)}
                  {isPR(selIdx) ? ' 🏆' : ''}
                </strong>
                <span className="pct" style={{ color: ratioColor(Math.min(1, selPt.ratio)) }}>
                  {Math.round(selPt.ratio * 100)}% of goal
                </span>
              </div>
              <div className="sub">
                {selPt.weight} {unit}{sides === 2 ? ' per side' : ''} · target {selPt.targetSets}×{selPt.targetReps} · sets:{' '}
                {repsSummary(selPt.reps)}
              </div>
              <div className="sub dim">Tap any point on the graph for details.</div>
            </div>
          )}
        </>
      )}

    </div>
  )
}
