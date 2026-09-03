import { AppData, Exercise, Session, SessionEntry, Settings, Workout, uid } from './types'

function ex(name: string, type: Exercise['type'], muscleGroup: Exercise['muscleGroup'], sets: number, reps: number): Exercise {
  return { id: uid(), name, type, muscleGroup, goal: { kind: 'setsreps', sets, reps } }
}

function landmine(name: string, muscleGroup: Exercise['muscleGroup'], sets: number, reps: number, perSide: boolean): Exercise {
  return { ...ex(name, 'landmine', muscleGroup, sets, reps), perSide }
}

export function defaultSettings(): Settings {
  return {
    barWeight: 45,
    ezBarWeight: 25,
    plates: [
      { weight: 45, pairs: 2 },
      { weight: 35, pairs: 1 },
      { weight: 25, pairs: 1 },
      { weight: 10, pairs: 2 },
      { weight: 5, pairs: 2 },
      { weight: 2.5, pairs: 1 },
    ],
    weightStep: 5,
    defaultTimerSec: 90,
    unit: 'lb',
  }
}

export function seedData(): AppData {
  const squat = ex('Squat', 'barbell', 'Legs', 5, 5)
  const bench = ex('Bench Press', 'barbell', 'Chest', 5, 5)
  const deadlift = ex('Deadlift', 'barbell', 'Full Body', 1, 5)
  const ohp = ex('Overhead Press', 'barbell', 'Shoulders', 5, 5)
  const row = ex('Barbell Row', 'barbell', 'Back', 5, 5)
  const pullups = ex('Pull-ups', 'calisthenics', 'Back', 3, 8)
  const dips = ex('Dips', 'calisthenics', 'Triceps', 3, 10)
  const curls = ex('EZ Bar Curl', 'ezbar', 'Biceps', 3, 10)
  const pushdown = ex('Tricep Pushdown', 'cable', 'Triceps', 3, 12)
  const latpull = ex('Lat Pulldown', 'cable', 'Back', 3, 10)
  const dbPress = ex('DB Shoulder Press', 'dumbbell', 'Shoulders', 3, 8)
  const lmPress = landmine('Landmine Press', 'Shoulders', 3, 10, true)
  const lmRow = landmine('Landmine Row', 'Back', 3, 10, true)
  const lmSquatPress = landmine('Landmine Squat to Press', 'Full Body', 3, 8, false)
  const lmTwist = landmine('Landmine Rotation', 'Core', 3, 10, false)
  const plank: Exercise = {
    id: uid(), name: 'Plank', type: 'calisthenics', muscleGroup: 'Core',
    goal: { kind: 'interval', activeSec: 45, restSec: 30, intervals: 3 },
  }

  const exercises = [
    squat, bench, deadlift, ohp, row, pullups, dips, curls, pushdown, latpull, dbPress, plank,
    lmPress, lmRow, lmSquatPress, lmTwist,
  ]

  const workouts: Workout[] = [
    { id: uid(), name: 'Push Day', exerciseIds: [bench.id, ohp.id, dips.id, pushdown.id] },
    { id: uid(), name: 'Pull Day', exerciseIds: [row.id, pullups.id, latpull.id, curls.id] },
    { id: uid(), name: 'Leg Day', exerciseIds: [squat.id, deadlift.id, plank.id] },
  ]

  return { exercises, workouts, sessions: [], settings: defaultSettings() }
}

// ~8 weeks of plausible training history over the seed workouts, for trying the
// app out (charts, history, PRs) without logging real sessions first.
export function demoData(): AppData {
  const base = seedData()
  const { exercises, workouts } = base

  // Starting weight and per-completed-session increment for each exercise
  const plan: Record<string, { start: number; inc: number }> = {}
  const p = (name: string, start: number, inc: number) => {
    const ex = exercises.find(e => e.name === name)
    if (ex) plan[ex.id] = { start, inc }
  }
  p('Squat', 135, 5)
  p('Bench Press', 95, 5)
  p('Deadlift', 185, 10)
  p('Overhead Press', 65, 2.5)
  p('Barbell Row', 95, 5)
  p('Pull-ups', 0, 0)
  p('Dips', 0, 0.5)
  p('EZ Bar Curl', 45, 1.25)
  p('Tricep Pushdown', 40, 1.25)
  p('Lat Pulldown', 90, 2.5)
  p('DB Shoulder Press', 30, 0.5)

  const timesDone: Record<string, number> = {}
  const sessions: Session[] = []
  const now = new Date()

  // Mon/Wed/Fri pattern for 8 weeks, cycling Push/Pull/Legs; skip a couple of
  // sessions so the history looks human.
  let cycle = 0
  for (let daysAgo = 56; daysAgo >= 1; daysAgo--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo)
    const dow = d.getDay()
    if (dow !== 1 && dow !== 3 && dow !== 5) continue
    cycle++
    if (cycle === 7 || cycle === 16) continue // missed days

    const w = workouts[cycle % workouts.length]
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const startedAt = d.getTime() + (17 * 60 + (cycle * 7) % 50) * 60 * 1000 // ~5pm-ish

    const entries: SessionEntry[] = []
    for (const exId of w.exerciseIds) {
      const ex = exercises.find(e => e.id === exId)!
      const n = timesDone[exId] ?? 0
      timesDone[exId] = n + 1

      if (ex.goal.kind === 'interval') {
        const { activeSec, restSec, intervals } = ex.goal
        entries.push({
          exerciseId: exId,
          goalKind: 'interval',
          weight: 0,
          targetSets: intervals,
          targetReps: 1,
          reps: Array(intervals).fill(1),
          intervalSpec: { activeSec, restSec, intervals },
        })
        continue
      }

      const pl = plan[exId] ?? { start: 0, inc: 0 }
      // Deload every 6th time an exercise comes up, otherwise steady progress
      const deload = n > 0 && n % 6 === 5
      const weight = Math.max(0, pl.start + pl.inc * n - (deload ? pl.inc * 2 : 0))
      const { sets, reps } = ex.goal
      const rep: (number | null)[] = []
      for (let si = 0; si < sets; si++) {
        // Struggle on the last sets as weight climbs; deload weeks feel easy
        const fade = !deload && n % 3 === 2 && si >= sets - 2 ? (si === sets - 1 ? 2 : 1) : 0
        rep.push(Math.max(1, reps - fade))
      }
      // The occasional bonus set on light days
      if (deload && sets <= 3) rep.push(reps)
      entries.push({
        exerciseId: exId,
        goalKind: 'setsreps',
        weight,
        targetSets: sets,
        targetReps: reps,
        reps: rep,
      })
    }

    sessions.push({
      id: uid(),
      workoutId: w.id,
      workoutName: w.name,
      date: dateStr,
      startedAt,
      finished: true,
      entries,
      notes: cycle === 12 ? 'Felt strong today — bench moving fast.' : '',
    })
  }

  return { ...base, sessions }
}
