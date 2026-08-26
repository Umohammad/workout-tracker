import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { entryStats, sessionTime } from '../sessions'
import { MUSCLE_COLORS, MUSCLE_GROUPS, MuscleGroup } from '../types'

type Metric = 'tonnage' | 'sets' | 'reps'
type RangeKey = '4w' | '12w' | '6m' | '1y'
type Unit = 'week' | 'month'

const RANGES: { key: RangeKey; label: string; long: string; n: number; unit: Unit }[] = [
  { key: '4w', label: '4 wk', long: '4 weeks', n: 4, unit: 'week' },
  { key: '12w', label: '12 wk', long: '12 weeks', n: 12, unit: 'week' },
  { key: '6m', label: '6 mo', long: '6 months', n: 6, unit: 'month' },
  { key: '1y', label: '1 yr', long: 'year', n: 12, unit: 'month' },
]

const METRICS: { key: Metric; label: string }[] = [
  { key: 'tonnage', label: 'Volume' },
  { key: 'sets', label: 'Sets' },
  { key: 'reps', label: 'Reps' },
]

type Totals = Record<Metric, number>
const zero = (): Totals => ({ tonnage: 0, sets: 0, reps: 0 })

function addInto(a: Totals, b: Totals) {
  a.tonnage += b.tonnage
  a.sets += b.sets
  a.reps += b.reps
}

interface Bucket {
  start: number
  end: number
  label: string
  byMuscle: Map<MuscleGroup, Totals>
  total: Totals
  sessions: number
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // weeks start Monday
  return x
}

// n+1 boundaries covering the n periods that end with the one we're in now.
function bucketEdges(n: number, unit: Unit): number[] {
  const now = new Date()
  const edges: number[] = []
  for (let i = n - 1; i >= -1; i--) {
    if (unit === 'week') {
      const d = startOfWeek(now)
      d.setDate(d.getDate() - 7 * i)
      edges.push(d.getTime())
    } else {
      edges.push(new Date(now.getFullYear(), now.getMonth() - i, 1).getTime())
    }
  }
  return edges
}

function bucketLabel(start: number, unit: Unit): string {
  const d = new Date(start)
  if (unit === 'week') return `${d.getMonth() + 1}/${d.getDate()}`
  return d.toLocaleDateString(undefined, { month: 'short' })
}

// Tonnage runs into the tens of thousands, so axis and stat text get shortened.
function compact(v: number): string {
  if (v >= 100000) return Math.round(v / 1000) + 'k'
  if (v >= 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(Math.round(v))
}

// Gridlines land on round numbers instead of thirds of whatever the tallest
// bar happened to be (0 / 7017 / 14k / 21.1k).
function niceStep(max: number, divisions: number): number {
  const raw = max / divisions
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5]) {
    if (raw <= m * mag) return m * mag
  }
  return 10 * mag
}

function Delta({ cur, prev, show }: { cur: number; prev: number; show: boolean }) {
  if (!show) return null
  if (prev <= 0) return <span className="delta flat">new</span>
  const d = ((cur - prev) / prev) * 100
  if (Math.abs(d) < 0.5) return <span className="delta flat">even</span>
  const up = d > 0
  return (
    <span className={'delta ' + (up ? 'up' : 'down')}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(d))}%
    </span>
  )
}

export default function Volume() {
  const { data } = useStore()
  const [rangeKey, setRangeKey] = useState<RangeKey>('12w')
  const [metric, setMetric] = useState<Metric>('tonnage')
  const [focus, setFocus] = useState<MuscleGroup | null>(null)
  const [sel, setSel] = useState<number | null>(null)

  const cfg = RANGES.find(r => r.key === rangeKey)!
  const unitLabel = data.settings.unit

  // Build twice the range, so the previous equal-length period comes for free
  // and every headline number can be shown as a trend rather than a bare total.
  const { buckets, prev } = useMemo(() => {
    const edges = bucketEdges(cfg.n * 2, cfg.unit)
    const all: Bucket[] = []
    for (let i = 0; i < edges.length - 1; i++) {
      all.push({
        start: edges[i],
        end: edges[i + 1],
        label: bucketLabel(edges[i], cfg.unit),
        byMuscle: new Map(),
        total: zero(),
        sessions: 0,
      })
    }
    const muscleOf = new Map(data.exercises.map(e => [e.id, e.muscleGroup]))
    for (const s of data.sessions) {
      if (!s.finished) continue
      const t = sessionTime(s)
      const b = all.find(x => t >= x.start && t < x.end)
      if (!b) continue
      let logged = false
      for (const e of s.entries) {
        const st = entryStats(e)
        if (st.sets === 0) continue
        logged = true
        const m: MuscleGroup = muscleOf.get(e.exerciseId) ?? 'Full Body'
        let acc = b.byMuscle.get(m)
        if (!acc) {
          acc = zero()
          b.byMuscle.set(m, acc)
        }
        addInto(acc, st)
        addInto(b.total, st)
      }
      if (logged) b.sessions++
    }
    return { prev: all.slice(0, cfg.n), buckets: all.slice(cfg.n) }
  }, [data.sessions, data.exercises, cfg])

  const sumBuckets = (bs: Bucket[]) => {
    const t = zero()
    for (const b of bs) addInto(t, b.total)
    return t
  }
  const muscleTotals = (bs: Bucket[]) => {
    const m = new Map<MuscleGroup, Totals>()
    for (const b of bs) {
      for (const [k, v] of b.byMuscle) {
        let a = m.get(k)
        if (!a) {
          a = zero()
          m.set(k, a)
        }
        addInto(a, v)
      }
    }
    return m
  }

  const cur = sumBuckets(buckets)
  const pre = sumBuckets(prev)
  const curMuscle = muscleTotals(buckets)
  const preMuscle = muscleTotals(prev)
  const curSessions = buckets.reduce((a, b) => a + b.sessions, 0)
  const preSessions = prev.reduce((a, b) => a + b.sessions, 0)

  const metricLabel = metric === 'tonnage' ? unitLabel : metric
  const groups = MUSCLE_GROUPS.filter(
    m => (curMuscle.get(m)?.sets ?? 0) > 0 || (preMuscle.get(m)?.sets ?? 0) > 0
  )
  const stackGroups = focus ? [focus] : groups
  const maxMuscle = Math.max(1, ...groups.map(g => curMuscle.get(g)?.[metric] ?? 0))

  // Value of one bucket under the current metric, honouring the muscle focus.
  const valueOf = (b: Bucket) => (focus ? (b.byMuscle.get(focus)?.[metric] ?? 0) : b.total[metric])

  const weeksElapsed = Math.max(1, (Date.now() - buckets[0].start) / (7 * 24 * 3600 * 1000))
  const perWeek = cur[metric] / weeksElapsed
  const hasData = curSessions > 0 || preSessions > 0
  // With no prior period on record every row would read "new", which says more
  // about the window than the training. Drop the trend chips instead.
  const comparable = preSessions > 0
  // Weight moved only counts weighted work, so say so rather than letting a
  // week of calisthenics look like it never happened.
  const bodyweightOnly = metric === 'tonnage' && cur.tonnage === 0 && cur.sets > 0

  // ---- chart geometry ----
  const W = 360
  const H = 200
  const L = 44
  const R = 8
  const T = 12
  const B = 26
  const plotW = W - L - R
  const plotH = H - T - B
  const step = plotW / buckets.length
  const bw = Math.min(30, step * 0.62)
  const gridStep = niceStep(Math.max(1, ...buckets.map(valueOf)), 3)
  const max = gridStep * 3
  const cx = (i: number) => L + step * (i + 0.5)
  const y = (v: number) => T + plotH * (1 - v / max)
  const labelEvery = Math.ceil(buckets.length / 5)

  const selB = sel !== null && sel < buckets.length ? buckets[sel] : null

  return (
    <div className="page">
      <div className="card formcard">
        <label className="fieldlabel">Range</label>
        <div className="choicegrid">
          {RANGES.map(r => (
            <button
              key={r.key}
              className={'choice' + (rangeKey === r.key ? ' active' : '')}
              onClick={() => {
                setRangeKey(r.key)
                setSel(null)
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="fieldlabel">Measure</label>
        <div className="choicegrid">
          {METRICS.map(m => (
            <button
              key={m.key}
              className={'choice' + (metric === m.key ? ' active' : '')}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
              {m.key === 'tonnage' ? ` (${unitLabel})` : ''}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="card">
          <p className="sub">
            No finished workouts in this window yet. Log a session and your total workload starts charting here.
            (Tip: Settings → Load demo data to see the app in action.)
          </p>
        </div>
      ) : (
        <>
          <div className="statrow">
            <div className="card stat">
              <span className="statnum">{compact(cur[metric])}</span>
              <span className="sub">{metricLabel} total</span>
              <Delta cur={cur[metric]} prev={pre[metric]} show={comparable} />
            </div>
            <div className="card stat">
              <span className="statnum">{compact(perWeek)}</span>
              <span className="sub">{metricLabel} / week</span>
            </div>
            <div className="card stat">
              <span className="statnum">{curSessions}</span>
              <span className="sub">sessions</span>
              <Delta cur={curSessions} prev={preSessions} show={comparable} />
            </div>
          </div>
          <p className="sub dim">
            {comparable
              ? `Trend compares against the previous ${cfg.long}. `
              : 'No training logged in the period before this one, so there is nothing to trend against yet. '}
            This {cfg.unit} is still in progress, so it reads low.
          </p>

          <div className="card chartcard">
            <svg viewBox={`0 0 ${W} ${H}`} className="chart">
              {[0, 1, 2, 3].map(i => {
                const v = gridStep * i
                return (
                  <g key={i}>
                    <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#252b36" strokeWidth={1} />
                    <text x={L - 6} y={y(v) + 4} textAnchor="end" className="chartlabel">
                      {compact(v)}
                    </text>
                  </g>
                )
              })}
              {buckets.map((b, i) => {
                const val = valueOf(b)
                let acc = 0
                return (
                  <g key={i} onClick={() => setSel(sel === i ? null : i)} style={{ cursor: 'pointer' }}>
                    {/* full-height hit target: a lean week is a 2px bar otherwise */}
                    <rect x={cx(i) - step / 2} y={T} width={step} height={plotH} fill="transparent" />
                    {stackGroups.map(m => {
                      const v = b.byMuscle.get(m)?.[metric] ?? 0
                      if (v <= 0) return null
                      const y0 = y(acc)
                      acc += v
                      const y1 = y(acc)
                      return (
                        <rect
                          key={m}
                          x={cx(i) - bw / 2}
                          y={y1}
                          width={bw}
                          height={Math.max(1, y0 - y1)}
                          fill={MUSCLE_COLORS[m]}
                          opacity={sel === null || sel === i ? 1 : 0.4}
                        />
                      )
                    })}
                    {sel === i && val > 0 && (
                      <rect
                        x={cx(i) - bw / 2 - 2.5}
                        y={y(val) - 2.5}
                        width={bw + 5}
                        height={T + plotH - y(val) + 2.5}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={1.5}
                        rx={2}
                      />
                    )}
                    {(buckets.length - 1 - i) % labelEvery === 0 && (
                      <text x={cx(i)} y={H - 8} textAnchor="middle" className="chartlabel">
                        {b.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
            <div className="chartlegend">
              {stackGroups.map(m => (
                <span key={m}>
                  <span className="dot" style={{ background: MUSCLE_COLORS[m] }} />
                  {m}
                </span>
              ))}
            </div>
            <p className="sub dim charthint">
              {focus
                ? `${focus} only — tap it again below to bring every group back.`
                : `Tap a bar for that ${cfg.unit}'s breakdown, or a muscle below to isolate it.`}
            </p>
          </div>

          {selB && (
            <div className="card detailcard">
              <div className="detailhead">
                <strong>
                  {cfg.unit === 'week' ? 'Week of ' : ''}
                  {new Date(selB.start).toLocaleDateString(undefined, {
                    month: 'short',
                    day: cfg.unit === 'week' ? 'numeric' : undefined,
                    year: cfg.unit === 'month' ? 'numeric' : undefined,
                  })}
                </strong>
                <span className="pct">
                  {focus ? focus + ' ' : ''}
                  {compact(valueOf(selB))} {metricLabel}
                </span>
              </div>
              <div className="sub">
                {selB.sessions} session{selB.sessions === 1 ? '' : 's'} · {selB.total.sets} sets ·{' '}
                {selB.total.reps} reps
                {selB.total.tonnage > 0 ? ` · ${compact(selB.total.tonnage)} ${unitLabel} moved` : ''}
              </div>
              <div className="sub dim">
                {[...selB.byMuscle.entries()]
                  .filter(([, v]) => v[metric] > 0)
                  .sort((a, b) => b[1][metric] - a[1][metric])
                  .map(([m, v]) => `${m} ${compact(v[metric])}`)
                  .join(' · ') || 'No logged sets.'}
              </div>
            </div>
          )}

          <h2 className="sectionhead">By muscle group · {cfg.long}</h2>
          <div className="card splitcard">
            {groups.length === 0 && <p className="sub">No sets logged in this window.</p>}
            {groups
              .map(m => ({
                m,
                v: curMuscle.get(m)?.[metric] ?? 0,
                p: preMuscle.get(m)?.[metric] ?? 0,
                // Bodyweight work moves no weight, so a bare "0" under Volume
                // would read as "you skipped it" rather than "it doesn't apply".
                bw: metric === 'tonnage' && (curMuscle.get(m)?.tonnage ?? 0) === 0,
              }))
              .sort((a, b) => b.v - a.v)
              .map(({ m, v, p, bw }) => (
                <button
                  key={m}
                  className={'splitrow musclerow' + (focus === m ? ' focused' : '')}
                  onClick={() => setFocus(focus === m ? null : m)}
                >
                  <span className="splitname">
                    <span className="dot" style={{ background: MUSCLE_COLORS[m] }} />
                    {m}
                  </span>
                  <div className="splitbar-track">
                    {!bw && (
                      <div
                        className="splitbar"
                        style={{ width: `${(v / maxMuscle) * 100}%`, background: MUSCLE_COLORS[m] }}
                      />
                    )}
                  </div>
                  <span className="musclevals">
                    <span className={'splitval' + (bw ? ' bwval' : '')}>{bw ? 'bodyweight' : compact(v)}</span>
                    {!bw && <Delta cur={v} prev={p} show={comparable} />}
                  </span>
                </button>
              ))}
          </div>

          {bodyweightOnly && (
            <p className="sub dim">
              Everything logged in this window was bodyweight, so there is no weight moved to total. Switch to Sets or
              Reps to see it.
            </p>
          )}
        </>
      )}
    </div>
  )
}
