export type ExerciseType = 'barbell' | 'ezbar' | 'dumbbell' | 'cable' | 'calisthenics'

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  barbell: 'Barbell',
  ezbar: 'EZ Bar',
  dumbbell: 'Dumbbell',
  cable: 'Cables',
  calisthenics: 'Calisthenics',
}

export const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Legs', 'Glutes', 'Core', 'Full Body',
] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]

// One colour per group so a muscle reads the same in every chart and legend.
export const MUSCLE_COLORS: Record<MuscleGroup, string> = {
  Chest: '#ef4444',
  Back: '#3b82f6',
  Shoulders: '#f59e0b',
  Biceps: '#a855f7',
  Triceps: '#ec4899',
  Legs: '#4ade80',
  Glutes: '#14b8a6',
  Core: '#eab308',
  'Full Body': '#94a3b8',
}

export interface SetsRepsGoal {
  kind: 'setsreps'
  sets: number
  reps: number
}

export interface IntervalGoal {
  kind: 'interval'
  activeSec: number
  restSec: number
  intervals: number
}

export type Goal = SetsRepsGoal | IntervalGoal

export interface Exercise {
  id: string
  name: string
  type: ExerciseType
  muscleGroup: MuscleGroup
  goal: Goal
  pinned?: boolean
  // True when the logged weight is one limb's load rather than the total: a
  // 30 lb dumbbell in each hand, or a single-arm cable set you repeat on the
  // other side. Either way the body moves twice the number you typed, so
  // volume counts it double. Undefined falls back to the type's default, which
  // keeps history logged before this existed counting correctly.
  perSide?: boolean
}

// Dumbbell work is two-handed unless you say otherwise; cable and machine work
// is two-armed unless you say otherwise.
export const PER_SIDE_DEFAULT: Record<ExerciseType, boolean> = {
  barbell: false,
  ezbar: false,
  dumbbell: true,
  cable: false,
  calisthenics: false,
}

// Only the types where the distinction is real get the choice. A barbell's
// weight is always the total, and calisthenics logs added weight.
export function supportsPerSide(t: ExerciseType): boolean {
  return t === 'dumbbell' || t === 'cable'
}

export function isPerSide(ex: Pick<Exercise, 'type' | 'perSide'> | undefined): boolean {
  if (!ex) return false
  return ex.perSide ?? PER_SIDE_DEFAULT[ex.type]
}

// How many times over the logged load actually gets moved: 2 for per-side work.
export function sidesFor(ex: Pick<Exercise, 'type' | 'perSide'> | undefined): 1 | 2 {
  return isPerSide(ex) ? 2 : 1
}

export interface Workout {
  id: string
  name: string
  exerciseIds: string[]
  pinned?: boolean
}

// A logged exercise inside one workout session. Goal fields are snapshotted so
// editing the exercise template later doesn't rewrite history.
export interface SessionEntry {
  exerciseId: string
  goalKind: 'setsreps' | 'interval'
  weight: number
  targetSets: number
  targetReps: number
  // One slot per set; null = not attempted yet. May grow beyond targetSets (extra sets).
  reps: (number | null)[]
  intervalSpec?: { activeSec: number; restSec: number; intervals: number }
}

export interface Session {
  id: string
  workoutId: string
  workoutName: string
  date: string // YYYY-MM-DD
  startedAt: number
  finished: boolean
  entries: SessionEntry[]
  notes: string
}

export interface PlateInv {
  weight: number
  pairs: number
}

export interface Settings {
  barWeight: number
  ezBarWeight: number
  plates: PlateInv[]
  weightStep: number
  defaultTimerSec: number
  unit: 'lb' | 'kg'
}

export interface AppData {
  exercises: Exercise[]
  workouts: Workout[]
  sessions: Session[]
  settings: Settings
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Stable sort with pinned items first
export function pinnedFirst<T extends { pinned?: boolean }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
}

export function goalLabel(g: Goal): string {
  if (g.kind === 'setsreps') return `${g.sets}×${g.reps}`
  return `${g.intervals} rounds · ${g.activeSec}s on / ${g.restSec}s off`
}
