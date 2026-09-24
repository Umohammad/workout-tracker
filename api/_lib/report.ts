// Turns a synced backup into the progress report AI agents read from
// /api/progress. Kept free of runtime imports from src/ so the serverless bundle
// never depends on the app's extensionless ESM imports — the three small
// formulas below mirror src/ and test/report.test.ts checks they stay in step.
import type { AppData, Exercise, ExerciseType, MuscleGroup, Session, SessionEntry } from '../../src/types.js'

// Mirrors PER_SIDE_DEFAULT / sidesFor in src/types.ts.
const PER_SIDE_DEFAULT: Record<ExerciseType, boolean> = {
  barbell: false,
  ezbar: false,
  dumbbell: true,
  cable: false,
  landmine: false,
  calisthenics: false,
}

export function sidesFor(ex: Pick<Exercise, 'type' | 'perSide'> | undefined): 1 | 2 {
  if (!ex) return 1
  return (ex.perSide ?? PER_SIDE_DEFAULT[ex.type] ?? false) ? 2 : 1
}

// Mirrors entryStats in src/sessions.ts: a set counts once it has reps, and
// bodyweight work adds sets and reps but no tonnage.
export function entryStats(e: SessionEntry, sides: 1 | 2) {
  let sets = 0
  let reps = 0
  for (const r of e.reps) {
    if (r === null || r <= 0) continue
    sets++
    reps += r
  }
  return { sets, reps, volume: e.weight > 0 ? e.weight * reps * sides : 0 }
}

// Mirrors est1RM in src/views/Progress.tsx: Epley off the best set, per side.
export function est1RM(e: SessionEntry): number {
  let best = 0
  for (const r of e.reps) {
    if (r === null || r <= 0) continue
    const v = e.weight * (1 + Math.min(r, 12) / 30)
    if (v > best) best = v
  }
  return Math.round(best * 10) / 10
}

// ---- dates: sessions carry the phone's local YYYY-MM-DD, so all bucketing is
// done on those strings as whole days rather than on server clock time.

const DAY = 86400000

function dayNum(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY)
}

function dayStr(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10)
}

// Weeks start Monday, matching the app's Volume view. Day 0 was a Thursday.
function mondayOf(n: number): number {
  return n - ((n + 3) % 7)
}

const round = (v: number, dp = 0) => {
  const f = Math.pow(10, dp)
  return Math.round(v * f) / f
}

function pctChange(cur: number, prev: number): number | null {
  if (prev <= 0) return null
  return round(((cur - prev) / prev) * 100)
}

interface Totals {
  sessions: number
  sets: number
  reps: number
  volume: number
}

const zero = (): Totals => ({ sessions: 0, sets: 0, reps: 0, volume: 0 })

export interface ReportOptions {
  now: Date
  syncedAt: string | null
  baseUrl: string
  weeks: number
  sessions: number
}

export function buildReport(data: AppData, opts: ReportOptions) {
  const unit = data.settings?.unit ?? 'lb'
  const exById = new Map(data.exercises.map(e => [e.id, e]))
  const today = dayNum(opts.now.toISOString().slice(0, 10))

  const logged = (e: SessionEntry) => e.reps.some(r => r !== null && r > 0)
  const finished = data.sessions
    .filter(s => s.finished && /^\d{4}-\d{2}-\d{2}$/.test(s.date))
    .sort((a, b) => dayNum(a.date) - dayNum(b.date) || a.startedAt - b.startedAt)

  const sessionTotals = (s: Session): Totals & { setsByMuscle: Partial<Record<MuscleGroup, number>> } => {
    const t = { ...zero(), sessions: 1, setsByMuscle: {} as Partial<Record<MuscleGroup, number>> }
    for (const e of s.entries) {
      const ex = exById.get(e.exerciseId)
      const st = entryStats(e, sidesFor(ex))
      t.sets += st.sets
      t.reps += st.reps
      t.volume += st.volume
      if (ex && st.sets > 0) t.setsByMuscle[ex.muscleGroup] = (t.setsByMuscle[ex.muscleGroup] ?? 0) + st.sets
    }
    return t
  }

  const perSession = finished.map(s => ({ s, day: dayNum(s.date), t: sessionTotals(s) }))

  const span = (from: number, to: number) => {
    const w = { ...zero(), setsByMuscle: {} as Partial<Record<MuscleGroup, number>> }
    for (const { day, t } of perSession) {
      if (day < from || day >= to) continue
      w.sessions++
      w.sets += t.sets
      w.reps += t.reps
      w.volume += t.volume
      for (const [m, n] of Object.entries(t.setsByMuscle)) {
        w.setsByMuscle[m as MuscleGroup] = (w.setsByMuscle[m as MuscleGroup] ?? 0) + (n ?? 0)
      }
    }
    return w
  }

  // ---- overview
  const first = perSession[0]
  const last = perSession[perSession.length - 1]
  const last12 = span(today - 83, today + 1)
  const overview = {
    totalSessions: perSession.length,
    firstSession: first?.s.date ?? null,
    lastSession: last?.s.date ?? null,
    daysSinceLastSession: last ? today - last.day : null,
    sessionsLast7Days: span(today - 6, today + 1).sessions,
    sessionsLast28Days: span(today - 27, today + 1).sessions,
    avgSessionsPerWeekLast12Weeks: round(last12.sessions / 12, 1),
    exercisesInLibrary: data.exercises.length,
  }

  // ---- last 28 days against the 28 before
  const cur = span(today - 27, today + 1)
  const prev = span(today - 55, today - 27)
  const strip = ({ setsByMuscle, ...t }: Totals & { setsByMuscle: unknown }) => ({ ...t, volume: round(t.volume) })
  const trend = {
    window: 'last 28 days vs the 28 days before that',
    current: strip(cur),
    previous: strip(prev),
    changePct: {
      sessions: pctChange(cur.sessions, prev.sessions),
      sets: pctChange(cur.sets, prev.sets),
      reps: pctChange(cur.reps, prev.reps),
      volume: pctChange(cur.volume, prev.volume),
    },
    setsByMuscleGroup: { current: cur.setsByMuscle, previous: prev.setsByMuscle },
  }

  // ---- weekly buckets, oldest first, ending with the current week
  const thisMonday = mondayOf(today)
  const weekly = []
  for (let i = opts.weeks - 1; i >= 0; i--) {
    const start = thisMonday - 7 * i
    const w = span(start, start + 7)
    weekly.push({
      weekOf: dayStr(start),
      ...(i === 0 ? { inProgress: true } : {}),
      sessions: w.sessions,
      sets: w.sets,
      reps: w.reps,
      volume: round(w.volume),
      setsByMuscleGroup: w.setsByMuscle,
    })
  }

  // ---- per exercise
  const target = (e: SessionEntry) =>
    e.goalKind === 'interval' && e.intervalSpec
      ? `${e.intervalSpec.intervals} rounds × ${e.intervalSpec.activeSec}s on / ${e.intervalSpec.restSec}s off`
      : `${e.targetSets}×${e.targetReps}`

  const exercises = data.exercises
    .map(ex => {
      const logs = perSession.flatMap(({ s }) =>
        s.entries.filter(e => e.exerciseId === ex.id && logged(e)).map(e => ({ date: s.date, e }))
      )
      if (logs.length === 0) return null
      let bestWeight = logs[0]
      let bestE1rm = logs[0]
      let bestSet = { reps: 0, date: logs[0].date, weight: logs[0].e.weight }
      for (const l of logs) {
        if (l.e.weight > bestWeight.e.weight) bestWeight = l
        if (est1RM(l.e) > est1RM(bestE1rm.e)) bestE1rm = l
        for (const r of l.e.reps) {
          if (r !== null && r > bestSet.reps) bestSet = { reps: r, date: l.date, weight: l.e.weight }
        }
      }
      const weighted = logs.some(l => l.e.weight > 0)
      const recent = logs.slice(-5).reverse()
      return {
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        equipment: ex.type,
        weightMeans:
          ex.type === 'calisthenics' ? 'added weight on top of bodyweight (0 = bodyweight only)'
          : sidesFor(ex) === 2 ? 'load on ONE side (volume counts it twice)'
          : 'total load',
        timesLogged: logs.length,
        firstLogged: logs[0].date,
        lastLogged: logs[logs.length - 1].date,
        best: weighted
          ? {
              weight: bestWeight.e.weight,
              weightDate: bestWeight.date,
              estimated1RM: est1RM(bestE1rm.e),
              estimated1RMDate: bestE1rm.date,
              mostRepsInOneSet: bestSet.reps,
              mostRepsDate: bestSet.date,
            }
          : { mostRepsInOneSet: bestSet.reps, mostRepsDate: bestSet.date },
        recent: recent.map(({ date, e }) => ({
          date,
          weight: e.weight,
          reps: e.reps,
          target: target(e),
          ...(weighted ? { estimated1RM: est1RM(e) } : {}),
          volume: round(entryStats(e, sidesFor(ex)).volume),
        })),
      }
    })
    .filter(x => x !== null)
    .sort((a, b) => dayNum(b.lastLogged) - dayNum(a.lastLogged) || b.timesLogged - a.timesLogged)

  // ---- recent sessions, newest first
  const describeSession = (s: Session) => ({
    date: s.date,
    workout: s.workoutName,
    ...(s.notes ? { notes: s.notes } : {}),
    exercises: s.entries
      .filter(logged)
      .map(e => {
        const ex = exById.get(e.exerciseId)
        return {
          name: ex?.name ?? '(deleted exercise)',
          weight: e.weight,
          ...(ex && sidesFor(ex) === 2 ? { perSide: true } : {}),
          reps: e.reps,
          target: target(e),
        }
      }),
  })

  const recentSessions = perSession
    .slice(-opts.sessions)
    .reverse()
    .map(({ s, t }) => ({ ...describeSession(s), totals: { sets: t.sets, reps: t.reps, volume: round(t.volume) } }))

  const active = data.sessions.find(s => !s.finished)

  return {
    about: about(unit, opts),
    lastSyncedAt: opts.syncedAt,
    generatedAt: opts.now.toISOString(),
    unit,
    overview,
    trend,
    weekly,
    exercises,
    recentSessions,
    workoutInProgress: active ? describeSession(active) : null,
  }
}

function about(unit: string, opts: ReportOptions) {
  const api = `${opts.baseUrl}/api/progress`
  const page = `${opts.baseUrl}/progress`
  return {
    what:
      "A personal strength-training log, synced automatically from the owner's workout tracker app. " +
      'Use it to answer questions about their training: consistency, progress on lifts, volume trends, PRs, balance between muscle groups.',
    howToRead: [
      `All weights are in ${unit}. The app never converts units.`,
      'Only finished workouts are counted. A workout still being logged is listed separately as in progress.',
      'Reps are one number per set: reps completed. A skipped set is null in JSON and – in text. A set hit its goal when its reps equal the target reps.',
      'Volume = weight × reps, summed. For exercises where the weight is ONE side (dumbbells, single-arm work), volume counts the load twice. Bodyweight work (weight 0) adds sets and reps but no volume.',
      'Estimated 1RM uses the Epley formula on the best set (reps capped at 12). For one-side exercises it is the one-side estimate.',
      'Dates are the local calendar date of the workout. Weeks start on Monday, and the latest week is still in progress.',
      'The "data as of" / lastSyncedAt time is when the phone last uploaded. Workouts logged after that are not included yet.',
      'A change of n/a (null in JSON) means there was nothing in the earlier period to compare against.',
    ],
    endpoints: {
      page: `${page} — this report as a readable web page`,
      text: `${page}.txt — the same report as plain text (Markdown)`,
      report: `${api} — the same report as JSON`,
      moreHistory: `${page}?sessions=50&weeks=52 (also works on ${page}.txt and ${api}) — sessions: how many recent workouts to list in full (default ${DEFAULT_SESSIONS}, max ${MAX_SESSIONS}); weeks: weekly buckets (default ${DEFAULT_WEEKS}, max ${MAX_WEEKS})`,
      rawExport: `${api}?view=export — the complete raw backup file, identical to the app's JSON export (every workout ever logged, raw IDs, no summaries)`,
    },
  }
}

export const DEFAULT_WEEKS = 12
export const MAX_WEEKS = 104
export const DEFAULT_SESSIONS = 10
export const MAX_SESSIONS = 500
