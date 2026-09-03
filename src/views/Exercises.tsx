import { useState } from 'react'
import { useStore } from '../store'
import { useNav } from '../nav'
import { EXERCISE_TYPE_LABELS, Exercise, MUSCLE_GROUPS, goalLabel, perSideNote } from '../types'

export default function ExercisesView() {
  const { data, update } = useStore()
  const { go } = useNav()
  const [search, setSearch] = useState('')

  const matches = (e: Exercise) => e.name.toLowerCase().includes(search.toLowerCase())
  const pinned = data.exercises.filter(e => e.pinned && matches(e))
  const groups = MUSCLE_GROUPS.filter(m => data.exercises.some(e => e.muscleGroup === m && matches(e)))

  const togglePin = (id: string) =>
    update(d => ({
      ...d,
      exercises: d.exercises.map(e => (e.id === id ? { ...e, pinned: !e.pinned } : e)),
    }))

  const row = (e: Exercise) => (
    <div key={e.id} className="card exrow">
      <button
        className={'pinbtn' + (e.pinned ? ' on' : '')}
        onClick={() => togglePin(e.id)}
        aria-label={e.pinned ? 'Unpin exercise' : 'Pin exercise'}
      >
        {e.pinned ? '★' : '☆'}
      </button>
      <div
        className="exrow-info"
        onClick={() => go({ name: 'editExercise', exerciseId: e.id, back: { name: 'exercises' } })}
      >
        <strong>{e.name}</strong>
        <div className="sub">
          {EXERCISE_TYPE_LABELS[e.type]}
          {perSideNote(e)} · {goalLabel(e.goal)}
        </div>
      </div>
      <button
        className="iconbtn"
        onClick={() => go({ name: 'progress', exerciseId: e.id })}
        aria-label="View progress"
      >
        📈
      </button>
      <span className="chev" onClick={() => go({ name: 'editExercise', exerciseId: e.id, back: { name: 'exercises' } })}>›</span>
    </div>
  )

  return (
    <div className="page">
      <header className="pagehead">
        <button className="backbtn" onClick={() => go({ name: 'home' })}>‹</button>
        <h1>Exercise Library</h1>
      </header>

      <input placeholder="Search exercises…" value={search} onChange={e => setSearch(e.target.value)} />

      {pinned.length > 0 && (
        <div>
          <h2 className="sectionhead">★ Pinned</h2>
          {pinned.map(row)}
        </div>
      )}

      {groups.map(m => (
        <div key={m}>
          <h2 className="sectionhead">{m}</h2>
          {data.exercises.filter(e => e.muscleGroup === m && matches(e)).map(row)}
        </div>
      ))}

      {pinned.length === 0 && groups.length === 0 && (
        <p className="sub">No exercises match “{search}”.</p>
      )}

      <button className="bigbtn" onClick={() => go({ name: 'editExercise', exerciseId: null, back: { name: 'exercises' } })}>
        ＋ New Exercise
      </button>
    </div>
  )
}
