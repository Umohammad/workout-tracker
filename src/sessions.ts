import { AppData, Session, SessionEntry, Workout, todayStr, uid } from './types'

export interface LastLog {
  weight: number
  reps: (number | null)[]
  targetSets: number
  targetReps: number
  date: string
}

// Most recent logged performance of an exercise, for "Last time" hints and
// pre-filling the weight when a new session starts.
export function lastLogFor(data: AppData, exerciseId: string, excludeSessionId?: string): LastLog | null {
  const sorted = [...data.sessions].sort((a, b) => b.startedAt - a.startedAt)
  for (const s of sorted) {
    if (s.id === excludeSessionId) continue
    const e = s.entries.find(en => en.exerciseId === exerciseId && en.reps.some(r => r !== null))
    if (e) return { weight: e.weight, reps: e.reps, targetSets: e.targetSets, targetReps: e.targetReps, date: s.date }
  }
  return null
}

export function makeEntry(data: AppData, exerciseId: string): SessionEntry | null {
  const ex = data.exercises.find(e => e.id === exerciseId)
  if (!ex) return null
  const s = data.settings
  const last = lastLogFor(data, exerciseId)
  const defaultW = ex.type === 'barbell' ? s.barWeight : ex.type === 'ezbar' ? s.ezBarWeight : 0
  const weight = last ? last.weight : defaultW
  if (ex.goal.kind === 'interval') {
    const { activeSec, restSec, intervals } = ex.goal
    return {
      exerciseId,
      goalKind: 'interval',
      weight,
      targetSets: intervals,
      targetReps: 1,
      reps: Array(intervals).fill(null),
      intervalSpec: { activeSec, restSec, intervals },
    }
  }
  return {
    exerciseId,
    goalKind: 'setsreps',
    weight,
    targetSets: ex.goal.sets,
    targetReps: ex.goal.reps,
    reps: Array(ex.goal.sets).fill(null),
  }
}

// A freeform session: no template behind it, exercises get added as you go.
export function createEmptySession(): Session {
  return {
    id: uid(),
    workoutId: '',
    workoutName: 'Freeform Workout',
    date: todayStr(),
    startedAt: Date.now(),
    finished: false,
    entries: [],
    notes: '',
  }
}

export function createSession(data: AppData, w: Workout): Session {
  return {
    id: uid(),
    workoutId: w.id,
    workoutName: w.name,
    date: todayStr(),
    startedAt: Date.now(),
    finished: false,
    entries: w.exerciseIds.map(id => makeEntry(data, id)).filter((e): e is SessionEntry => e !== null),
    notes: '',
  }
}

// How "full" an entry was completed: 1.0 = hit the goal exactly, >1 = beyond.
export function entryRatio(e: SessionEntry): number {
  const done = e.reps.reduce<number>((a, b) => a + (b ?? 0), 0)
  const target = e.targetSets * e.targetReps
  return target > 0 ? done / target : 0
}

export function repsSummary(reps: (number | null)[]): string {
  return reps.map(r => (r === null ? '–' : String(r))).join(' · ')
}

export function ratioColor(ratio: number): string {
  const hue = 120 * Math.max(0, Math.min(1, ratio))
  return `hsl(${hue}, 75%, 50%)`
}

export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}
