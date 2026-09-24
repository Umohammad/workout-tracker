import type { AppData } from '../../src/types'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Deep enough that a stored backup can't crash the report builder, loose enough
// that fields added to the app later don't get a sync rejected.
export function isAppData(v: unknown): v is AppData {
  if (!isObj(v)) return false
  if (!Array.isArray(v.exercises) || !Array.isArray(v.workouts) || !Array.isArray(v.sessions)) return false
  if (v.settings !== undefined && !isObj(v.settings)) return false
  const exercisesOk = v.exercises.every(
    e => isObj(e) && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.type === 'string'
  )
  const sessionsOk = v.sessions.every(
    s =>
      isObj(s) &&
      typeof s.date === 'string' &&
      typeof s.startedAt === 'number' &&
      Array.isArray(s.entries) &&
      s.entries.every(
        e =>
          isObj(e) &&
          typeof e.exerciseId === 'string' &&
          typeof e.weight === 'number' &&
          Array.isArray(e.reps) &&
          e.reps.every(r => r === null || typeof r === 'number')
      )
  )
  return exercisesOk && sessionsOk
}
