import { useStore } from '../store'
import { useNav } from '../nav'
import { createEmptySession, createSession, formatDate } from '../sessions'
import { Workout, pinnedFirst, uid } from '../types'

export default function Home() {
  const { data, update } = useStore()
  const { go } = useNav()

  const inProgress = data.sessions.filter(s => !s.finished)
  const recent = [...data.sessions]
    .filter(s => s.finished)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 5)

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const thisWeek = data.sessions.filter(s => s.finished && s.startedAt >= weekAgo).length

  const start = (w: Workout) => {
    const existing = inProgress.find(s => s.workoutId === w.id)
    if (existing) {
      go({ name: 'session', sessionId: existing.id })
      return
    }
    const session = createSession(data, w)
    update(d => ({ ...d, sessions: [...d.sessions, session] }))
    go({ name: 'session', sessionId: session.id })
  }

  const newWorkout = () => {
    const w: Workout = { id: uid(), name: 'New Workout', exerciseIds: [] }
    update(d => ({ ...d, workouts: [...d.workouts, w] }))
    go({ name: 'editWorkout', workoutId: w.id })
  }

  const startFreeform = () => {
    const session = createEmptySession()
    update(d => ({ ...d, sessions: [...d.sessions, session] }))
    go({ name: 'session', sessionId: session.id })
  }

  const togglePin = (id: string) =>
    update(d => ({
      ...d,
      workouts: d.workouts.map(w => (w.id === id ? { ...w, pinned: !w.pinned } : w)),
    }))

  return (
    <div className="page">
      <header className="pagehead">
        <h1>Train</h1>
        {thisWeek > 0 && <span className="weekchip">🔥 {thisWeek} this week</span>}
      </header>

      {inProgress.map(s => (
        <button key={s.id} className="card resumecard" onClick={() => go({ name: 'session', sessionId: s.id })}>
          <div>
            <strong>{s.workoutName}</strong>
            <div className="sub">In progress · {formatDate(s.date)} — tap to resume</div>
          </div>
          <span className="resumebadge">▶ Resume</span>
        </button>
      ))}

      <button className="freeformbtn" onClick={startFreeform}>▶ Start Empty Workout</button>

      <h2 className="sectionhead">Saved Workouts</h2>
      {data.workouts.length === 0 && (
        <p className="sub">No Saved Workouts yet — create one below, or just start an empty workout.</p>
      )}
      {pinnedFirst(data.workouts).map(w => {
        const names = w.exerciseIds
          .map(id => data.exercises.find(e => e.id === id)?.name)
          .filter(Boolean) as string[]
        const active = inProgress.find(s => s.workoutId === w.id)
        return (
          <div key={w.id} className={'card workoutcard' + (w.pinned ? ' pinned' : '')}>
            <button
              className={'pinbtn' + (w.pinned ? ' on' : '')}
              onClick={() => togglePin(w.id)}
              aria-label={w.pinned ? 'Unpin workout' : 'Pin workout'}
            >
              {w.pinned ? '★' : '☆'}
            </button>
            <div className="workoutcard-info" onClick={() => start(w)}>
              <strong>{w.name}</strong>
              <div className="sub">{names.length ? names.join(' · ') : 'No exercises yet — tap ✎ to add some'}</div>
            </div>
            <div className="workoutcard-btns">
              <button className="iconbtn" onClick={() => go({ name: 'editWorkout', workoutId: w.id })} aria-label="Edit workout">✎</button>
              <button className={'startbtn' + (active ? ' resume' : '')} onClick={() => start(w)}>
                {active ? 'Resume' : 'Start'}
              </button>
            </div>
          </div>
        )
      })}

      <button className="bigbtn" onClick={newWorkout}>＋ New Saved Workout</button>
      <button className="linkbtn" onClick={() => go({ name: 'exercises' })}>Manage exercise library ›</button>

      {recent.length > 0 && (
        <>
          <h2 className="sectionhead">Recent sessions</h2>
          {recent.map(s => (
            <button key={s.id} className="card historyrow" onClick={() => go({ name: 'history' })}>
              <span>{s.workoutName}</span>
              <span className="sub">{formatDate(s.date)}</span>
            </button>
          ))}
          <button className="linkbtn" onClick={() => go({ name: 'history' })}>Full history ›</button>
        </>
      )}
    </div>
  )
}
