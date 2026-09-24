import { describe, expect, it } from 'vitest'
import { buildReport, entryStats, est1RM, sidesFor } from '../api/_lib/report.js'
import { isAppData } from '../api/_lib/validate.js'
import { entryStats as appEntryStats } from '../src/sessions'
import { AppData, Exercise, ExerciseType, Session, SessionEntry, sidesFor as appSidesFor } from '../src/types'
import { defaultSettings, demoData } from '../src/seed'

const TYPES: ExerciseType[] = ['barbell', 'ezbar', 'dumbbell', 'cable', 'landmine', 'calisthenics']

const exercise = (id: string, name: string, type: ExerciseType, extra: Partial<Exercise> = {}): Exercise => ({
  id,
  name,
  type,
  muscleGroup: type === 'dumbbell' ? 'Shoulders' : 'Legs',
  goal: { kind: 'setsreps', sets: 3, reps: 5 },
  ...extra,
})

const entry = (exerciseId: string, weight: number, reps: (number | null)[]): SessionEntry => ({
  exerciseId,
  goalKind: 'setsreps',
  weight,
  targetSets: 3,
  targetReps: 5,
  reps,
})

const session = (id: string, date: string, entries: SessionEntry[], finished = true): Session => ({
  id,
  workoutId: '',
  workoutName: 'Day ' + id,
  date,
  startedAt: Date.parse(date + 'T17:00:00Z'),
  finished,
  entries,
  notes: '',
})

const opts = (now: string, extra = {}) => ({
  now: new Date(now),
  syncedAt: '2026-09-20T12:00:00.000Z',
  baseUrl: 'https://example.test',
  weeks: 4,
  sessions: 10,
  ...extra,
})

// Wed 2026-09-23. Its week starts Mon 2026-09-21.
const NOW = '2026-09-23T15:00:00Z'

function fixture(): AppData {
  return {
    exercises: [
      exercise('sq', 'Squat', 'barbell'),
      exercise('db', 'DB Press', 'dumbbell'),
      exercise('pu', 'Pull-ups', 'calisthenics'),
    ],
    workouts: [],
    sessions: [
      session('1', '2026-08-10', [entry('sq', 200, [5, 5, 5]), entry('pu', 0, [8, 7, null])]),
      session('2', '2026-09-14', [entry('sq', 210, [5, 5, 4]), entry('db', 40, [8, 8, 8])]),
      session('3', '2026-09-22', [entry('sq', 215, [5, 3, null]), entry('pu', 0, [10, 9, 8])]),
      session('4', '2026-09-23', [entry('sq', 300, [1, null, null])], false), // still in progress
    ],
    settings: defaultSettings(),
  }
}

describe('formulas mirror the app', () => {
  it('sidesFor matches src/types for every type and override', () => {
    for (const type of TYPES) {
      for (const perSide of [undefined, true, false]) {
        const ex = { type, perSide }
        expect(sidesFor(ex)).toBe(appSidesFor(ex))
      }
    }
    expect(sidesFor(undefined)).toBe(appSidesFor(undefined))
  })

  it('entryStats matches src/sessions', () => {
    const e = entry('x', 42.5, [5, null, 0, 7, 3])
    for (const sides of [1, 2] as const) {
      const app = appEntryStats(e, sides)
      expect(entryStats(e, sides)).toEqual({ sets: app.sets, reps: app.reps, volume: app.tonnage })
    }
  })

  it('est1RM is Epley on the best set, reps capped at 12', () => {
    expect(est1RM(entry('x', 200, [5, 3, null]))).toBe(233.3)
    expect(est1RM(entry('x', 100, [20]))).toBe(140)
    expect(est1RM(entry('x', 100, [null]))).toBe(0)
  })
})

describe('buildReport', () => {
  const r = buildReport(fixture(), opts(NOW))

  it('counts only finished sessions in the overview', () => {
    expect(r.overview).toMatchObject({
      totalSessions: 3,
      firstSession: '2026-08-10',
      lastSession: '2026-09-22',
      daysSinceLastSession: 1,
      sessionsLast7Days: 1,
      sessionsLast28Days: 2,
    })
  })

  it('compares the last 28 days to the 28 before', () => {
    // Current: sessions 2 and 3. Squat 210×14 + DB 40×24×2 + squat 215×8 (pull-ups add no volume)
    expect(r.trend.current).toEqual({ sessions: 2, sets: 11, reps: 73, volume: 210 * 14 + 40 * 24 * 2 + 215 * 8 })
    expect(r.trend.previous).toEqual({ sessions: 1, sets: 5, reps: 30, volume: 3000 })
    expect(r.trend.changePct.sessions).toBe(100)
    expect(r.trend.setsByMuscleGroup.current).toEqual({ Legs: 8, Shoulders: 3 })
  })

  it('buckets Monday-start weeks, oldest first, current week last', () => {
    expect(r.weekly.map(w => w.weekOf)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'])
    expect(r.weekly[3]).toMatchObject({ inProgress: true, sessions: 1, sets: 5 })
    expect(r.weekly[2]).toMatchObject({ sessions: 1, volume: 210 * 14 + 40 * 24 * 2 })
    expect(r.weekly[2]).not.toHaveProperty('inProgress')
  })

  it('summarises each exercise with bests and recent logs, newest first', () => {
    const squat = r.exercises.find(e => e.name === 'Squat')!
    expect(squat.timesLogged).toBe(3)
    expect(squat.best).toMatchObject({ weight: 215, weightDate: '2026-09-22', estimated1RM: 250.8, estimated1RMDate: '2026-09-22' })
    expect(squat.recent.map(x => x.date)).toEqual(['2026-09-22', '2026-09-14', '2026-08-10'])
    expect(squat.weightMeans).toBe('total load')

    const db = r.exercises.find(e => e.name === 'DB Press')!
    expect(db.weightMeans).toMatch(/ONE side/)
    expect(db.recent[0].volume).toBe(40 * 24 * 2)

    const pu = r.exercises.find(e => e.name === 'Pull-ups')!
    expect(pu.best).toEqual({ mostRepsInOneSet: 10, mostRepsDate: '2026-09-22' })
    expect(pu.recent[0]).not.toHaveProperty('estimated1RM')
  })

  it('lists recent sessions newest first and the in-progress one separately', () => {
    expect(r.recentSessions.map(s => s.date)).toEqual(['2026-09-22', '2026-09-14', '2026-08-10'])
    expect(r.recentSessions[1].exercises[1]).toMatchObject({ name: 'DB Press', perSide: true, reps: [8, 8, 8] })
    expect(r.workoutInProgress?.date).toBe('2026-09-23')
  })

  it('honours the sessions limit and explains itself', () => {
    const small = buildReport(fixture(), opts(NOW, { sessions: 1 }))
    expect(small.recentSessions).toHaveLength(1)
    expect(r.about.endpoints.rawExport).toBe('https://example.test/api/progress?view=export — the complete raw backup file, identical to the app\'s JSON export (every workout ever logged, raw IDs, no summaries)')
    expect(r.about.howToRead[0]).toContain('lb')
  })

  it('handles an empty log', () => {
    const empty = buildReport({ exercises: [], workouts: [], sessions: [], settings: defaultSettings() }, opts(NOW))
    expect(empty.overview.totalSessions).toBe(0)
    expect(empty.overview.lastSession).toBeNull()
    expect(empty.trend.changePct.volume).toBeNull()
    expect(empty.exercises).toEqual([])
  })

  it('runs over the demo history without surprises', () => {
    const demo = buildReport(demoData(), opts(new Date().toISOString(), { weeks: 12 }))
    expect(demo.overview.totalSessions).toBeGreaterThan(15)
    expect(demo.weekly).toHaveLength(12)
    expect(JSON.stringify(demo)).not.toMatch(/NaN|Infinity/)
  })
})

describe('isAppData', () => {
  it('accepts real app data', () => {
    expect(isAppData(fixture())).toBe(true)
    expect(isAppData(demoData())).toBe(true)
  })

  it('rejects malformed payloads', () => {
    expect(isAppData(null)).toBe(false)
    expect(isAppData({ exercises: [], workouts: [] })).toBe(false)
    const bad = fixture() as unknown as { sessions: { entries: { reps: unknown }[] }[] }
    bad.sessions[0].entries[0].reps = ['5']
    expect(isAppData(bad)).toBe(false)
  })
})
