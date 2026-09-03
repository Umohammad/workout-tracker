import { useState } from 'react'
import { useStore } from '../store'
import { View, useNav } from '../nav'
import {
  EXERCISE_TYPE_LABELS,
  Exercise,
  ExerciseType,
  Goal,
  MUSCLE_GROUPS,
  MuscleGroup,
  PER_SIDE_DEFAULT,
  isPerSide,
  perSideChoice,
  supportsPerSide,
  uid,
} from '../types'
import { NumField } from '../components'
import { makeEntry } from '../sessions'

export default function ExerciseEditor({
  exerciseId,
  back,
  addToWorkoutId,
  addToSessionId,
}: {
  exerciseId: string | null
  back: View
  addToWorkoutId?: string
  addToSessionId?: string
}) {
  const { data, update } = useStore()
  const { go } = useNav()
  const existing = exerciseId ? data.exercises.find(e => e.id === exerciseId) : undefined
  const unit = data.settings.unit

  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<ExerciseType>(existing?.type ?? 'barbell')
  const [muscle, setMuscle] = useState<MuscleGroup>(existing?.muscleGroup ?? 'Chest')
  // New exercises start as 'barbell', which is never per-side; picking a type
  // below fills in that type's default.
  const [perSide, setPerSide] = useState(isPerSide(existing))
  const [goalKind, setGoalKind] = useState<'setsreps' | 'interval'>(existing?.goal.kind ?? 'setsreps')
  const [sets, setSets] = useState(existing?.goal.kind === 'setsreps' ? existing.goal.sets : 3)
  const [reps, setReps] = useState(existing?.goal.kind === 'setsreps' ? existing.goal.reps : 8)
  const [activeSec, setActiveSec] = useState(existing?.goal.kind === 'interval' ? existing.goal.activeSec : 30)
  const [restSec, setRestSec] = useState(existing?.goal.kind === 'interval' ? existing.goal.restSec : 30)
  const [intervals, setIntervals] = useState(existing?.goal.kind === 'interval' ? existing.goal.intervals : 4)

  // Switching type re-answers the per-side question with that type's default —
  // "Dumbbell" should mean two dumbbells without anyone having to think about it.
  const pickType = (t: ExerciseType) => {
    if (t === type) return
    setType(t)
    setPerSide(PER_SIDE_DEFAULT[t])
  }

  const save = () => {
    if (!name.trim()) {
      alert('Give the exercise a name first.')
      return
    }
    const goal: Goal =
      goalKind === 'setsreps'
        ? { kind: 'setsreps', sets: Math.max(1, sets), reps: Math.max(1, reps) }
        : { kind: 'interval', activeSec: Math.max(5, activeSec), restSec: Math.max(0, restSec), intervals: Math.max(1, intervals) }
    const ex: Exercise = { id: existing?.id ?? uid(), name: name.trim(), type, muscleGroup: muscle, goal }
    if (existing?.pinned) ex.pinned = true
    if (supportsPerSide(type)) ex.perSide = perSide
    update(d => {
      const exercises = existing ? d.exercises.map(e => (e.id === ex.id ? ex : e)) : [...d.exercises, ex]
      let workouts = d.workouts
      if (!existing && addToWorkoutId) {
        workouts = workouts.map(w =>
          w.id === addToWorkoutId ? { ...w, exerciseIds: [...w.exerciseIds, ex.id] } : w
        )
      }
      let sessions = d.sessions
      if (!existing && addToSessionId) {
        const entry = makeEntry({ ...d, exercises }, ex.id)
        if (entry) {
          sessions = sessions.map(s => (s.id === addToSessionId ? { ...s, entries: [...s.entries, entry] } : s))
        }
      }
      return { ...d, exercises, workouts, sessions }
    })
    go(back)
  }

  const del = () => {
    if (!existing) return
    if (!window.confirm(`Delete "${existing.name}"? It is removed from all workouts (logged history is kept).`)) return
    update(d => ({
      ...d,
      exercises: d.exercises.filter(e => e.id !== existing.id),
      workouts: d.workouts.map(w => ({ ...w, exerciseIds: w.exerciseIds.filter(id => id !== existing.id) })),
    }))
    go(back)
  }

  return (
    <div className="page">
      <header className="pagehead">
        <button className="backbtn" onClick={() => go(back)}>‹</button>
        <h1>{existing ? 'Edit Exercise' : 'New Exercise'}</h1>
      </header>

      <div className="card formcard">
        <label className="fieldlabel">Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Incline Bench Press" autoFocus={!existing} />

        <label className="fieldlabel">Type</label>
        <div className="choicegrid">
          {(Object.keys(EXERCISE_TYPE_LABELS) as ExerciseType[]).map(t => (
            <button key={t} className={'choice' + (type === t ? ' active' : '')} onClick={() => pickType(t)}>
              {EXERCISE_TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <label className="fieldlabel">Muscle group</label>
        <div className="choicegrid">
          {MUSCLE_GROUPS.map(m => (
            <button key={m} className={'choice' + (muscle === m ? ' active' : '')} onClick={() => setMuscle(m)}>
              {m}
            </button>
          ))}
        </div>

        {supportsPerSide(type) && (
          <>
            <label className="fieldlabel">{perSideChoice(type).label}</label>
            <div className="choicegrid two">
              <button className={'choice' + (perSide ? ' active' : '')} onClick={() => setPerSide(true)}>
                {perSideChoice(type).on}
              </button>
              <button className={'choice' + (!perSide ? ' active' : '')} onClick={() => setPerSide(false)}>
                {perSideChoice(type).off}
              </button>
            </div>
            <p className="sub">
              {perSide
                ? type === 'dumbbell'
                  ? `Volume counts double — a 30 ${unit} dumbbell in each hand moves 60 ${unit} every rep.`
                  : `Volume counts double — a 30 ${unit} set you repeat on the other arm moves 60 ${unit} every rep.`
                : type === 'dumbbell'
                  ? 'Volume counts the number as logged. Use this for one dumbbell held in both hands, like a goblet squat.'
                  : type === 'landmine'
                    ? 'Volume counts the number as logged. Use this for both hands on the sleeve, like a landmine squat or rotation.'
                    : 'Volume counts the number as logged. Use this for a stack you pull with both arms at once.'}
            </p>
          </>
        )}

        <label className="fieldlabel">Goal</label>
        <div className="choicegrid two">
          <button className={'choice' + (goalKind === 'setsreps' ? ' active' : '')} onClick={() => setGoalKind('setsreps')}>
            Sets × Reps
          </button>
          <button className={'choice' + (goalKind === 'interval' ? ' active' : '')} onClick={() => setGoalKind('interval')}>
            Intervals
          </button>
        </div>

        {goalKind === 'setsreps' ? (
          <div className="numrow">
            <NumField label="Sets" value={sets} onChange={setSets} min={1} />
            <NumField label="Reps" value={reps} onChange={setReps} min={1} />
          </div>
        ) : (
          <div className="numrow">
            <NumField label="Active (s)" value={activeSec} onChange={setActiveSec} min={5} step={5} />
            <NumField label="Rest (s)" value={restSec} onChange={setRestSec} min={0} step={5} />
            <NumField label="Rounds" value={intervals} onChange={setIntervals} min={1} />
          </div>
        )}
      </div>

      <button className="bigbtn finish" onClick={save}>Save</button>
      {existing && <button className="linkbtn danger" onClick={del}>Delete exercise</button>}
    </div>
  )
}
