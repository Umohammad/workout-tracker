import { useState } from 'react'
import { useStore } from '../store'
import { useNav } from '../nav'
import { EXERCISE_TYPE_LABELS, Workout, goalLabel, pinnedFirst, uid } from '../types'

export default function WorkoutEditor({ workoutId }: { workoutId: string }) {
  const { data, update } = useStore()
  const { go } = useNav()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const w = data.workouts.find(x => x.id === workoutId)
  if (!w) {
    return (
      <div className="page">
        <p className="sub">Workout not found.</p>
      </div>
    )
  }

  const updW = (fn: (w: Workout) => Workout) =>
    update(d => ({ ...d, workouts: d.workouts.map(x => (x.id === workoutId ? fn(x) : x)) }))

  const move = (i: number, dir: -1 | 1) =>
    updW(x => {
      const ids = [...x.exerciseIds]
      const j = i + dir
      if (j < 0 || j >= ids.length) return x
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      return { ...x, exerciseIds: ids }
    })

  const remove = (i: number) => updW(x => ({ ...x, exerciseIds: x.exerciseIds.filter((_, j) => j !== i) }))

  const add = (id: string) => {
    updW(x => ({ ...x, exerciseIds: [...x.exerciseIds, id] }))
    setSearch('')
  }

  const del = () => {
    if (window.confirm(`Delete the Saved Workout "${w.name}"? Past session history is kept.`)) {
      update(d => ({ ...d, workouts: d.workouts.filter(x => x.id !== workoutId) }))
      go({ name: 'home' })
    }
  }

  const available = pinnedFirst(
    data.exercises.filter(e => !w.exerciseIds.includes(e.id) && e.name.toLowerCase().includes(search.toLowerCase()))
  )

  const duplicate = () => {
    const copy: Workout = { id: uid(), name: `${w.name} (copy)`, exerciseIds: [...w.exerciseIds] }
    update(d => ({ ...d, workouts: [...d.workouts, copy] }))
    go({ name: 'editWorkout', workoutId: copy.id })
  }

  return (
    <div className="page">
      <header className="pagehead">
        <button className="backbtn" onClick={() => go({ name: 'home' })}>‹</button>
        <h1>Edit Saved Workout</h1>
      </header>

      <div className="card formcard">
        <label className="fieldlabel">Name</label>
        <input value={w.name} onChange={e => updW(x => ({ ...x, name: e.target.value }))} />
      </div>

      {w.exerciseIds.map((id, i) => {
        const ex = data.exercises.find(e => e.id === id)
        return (
          <div key={id + '-' + i} className="card exrow">
            <div
              className="exrow-info"
              onClick={() =>
                ex && go({ name: 'editExercise', exerciseId: ex.id, back: { name: 'editWorkout', workoutId } })
              }
            >
              <strong>{ex?.name ?? '(deleted exercise)'}</strong>
              <div className="sub">{ex && `${EXERCISE_TYPE_LABELS[ex.type]} · ${ex.muscleGroup} · ${goalLabel(ex.goal)}`}</div>
            </div>
            <div className="exrow-btns">
              <button className="iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="iconbtn" onClick={() => move(i, 1)} disabled={i === w.exerciseIds.length - 1} aria-label="Move down">↓</button>
              <button className="iconbtn danger" onClick={() => remove(i)} aria-label="Remove">✕</button>
            </div>
          </div>
        )
      })}

      {!pickerOpen && (
        <button className="bigbtn" onClick={() => setPickerOpen(true)}>＋ Add Exercise</button>
      )}
      {pickerOpen && (
        <div className="card picker">
          <input autoFocus placeholder="Search exercises…" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="pickerlist">
            {available.map(e => (
              <button key={e.id} className="pickeritem" onClick={() => add(e.id)}>
                <span>{e.pinned ? '★ ' : ''}{e.name}</span>
                <span className="sub">
                  {EXERCISE_TYPE_LABELS[e.type]} · {goalLabel(e.goal)}
                </span>
              </button>
            ))}
            {available.length === 0 && <p className="sub">No matches.</p>}
          </div>
          <div className="pickerfoot">
            <button
              className="linkbtn"
              onClick={() =>
                go({
                  name: 'editExercise',
                  exerciseId: null,
                  back: { name: 'editWorkout', workoutId },
                  addToWorkoutId: workoutId,
                })
              }
            >
              ＋ Create new exercise
            </button>
            <button className="linkbtn" onClick={() => setPickerOpen(false)}>Close</button>
          </div>
        </div>
      )}

      <button className="linkbtn" onClick={duplicate}>Duplicate Saved Workout</button>
      <button className="linkbtn danger" onClick={del}>Delete Saved Workout</button>
    </div>
  )
}
