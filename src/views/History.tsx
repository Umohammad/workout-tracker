import { useState } from 'react'
import { useStore } from '../store'
import { useNav } from '../nav'
import { entryRatio, formatDate, ratioColor, repsSummary } from '../sessions'
import { Session } from '../types'

// Overall completion of a session: total reps done vs total reps targeted.
function sessionRatio(s: Session): number {
  let done = 0
  let target = 0
  for (const e of s.entries) {
    done += e.reps.reduce<number>((a, b) => a + (b ?? 0), 0)
    target += e.targetSets * e.targetReps
  }
  return target > 0 ? done / target : 0
}

function monthLabel(dateStr: string): string {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  } catch {
    return dateStr.slice(0, 7)
  }
}

export default function History() {
  const { data, update } = useStore()
  const { go } = useNav()
  const [openId, setOpenId] = useState<string | null>(null)

  const sessions = [...data.sessions].filter(s => s.finished).sort((a, b) => b.startedAt - a.startedAt)

  const del = (s: Session) => {
    if (window.confirm(`Delete this ${s.workoutName} session from ${formatDate(s.date)}? This can't be undone.`)) {
      update(d => ({ ...d, sessions: d.sessions.filter(x => x.id !== s.id) }))
    }
  }

  // Opens the session in edit mode; it stays "finished" so it never
  // reappears as in-progress on the home screen.
  const edit = (s: Session) => go({ name: 'session', sessionId: s.id })

  let lastMonth = ''

  return (
    <div className="page">
      <header className="pagehead">
        <h1>History</h1>
        {sessions.length > 0 && <span className="weekchip">{sessions.length} workouts</span>}
      </header>

      {sessions.length === 0 && (
        <div className="card">
          <p className="sub">No finished workouts yet. Your completed sessions will show up here.</p>
        </div>
      )}

      {sessions.map(s => {
        const month = monthLabel(s.date)
        const header = month !== lastMonth ? <h2 className="sectionhead" key={'m' + s.id}>{month}</h2> : null
        lastMonth = month
        const open = openId === s.id
        const ratio = sessionRatio(s)
        return (
          <div key={s.id}>
            {header}
            <div className={'card historycard' + (open ? ' open' : '')}>
              <button className="historycard-head" onClick={() => setOpenId(open ? null : s.id)}>
                <div>
                  <strong>{s.workoutName}</strong>
                  <div className="sub">{formatDate(s.date)} · {s.entries.length} exercises</div>
                </div>
                <span className="pct" style={{ color: ratioColor(Math.min(1, ratio)) }}>
                  {Math.round(ratio * 100)}%
                </span>
              </button>

              {open && (
                <div className="historydetail">
                  {s.entries.map((e, i) => {
                    const ex = data.exercises.find(x => x.id === e.exerciseId)
                    const r = entryRatio(e)
                    return (
                      <div key={i} className="historyentry">
                        <div className="historyentry-name">
                          <span>{ex?.name ?? 'Deleted exercise'}</span>
                          <span className="pct small" style={{ color: ratioColor(Math.min(1, r)) }}>
                            {Math.round(r * 100)}%
                          </span>
                        </div>
                        <div className="sub">
                          {e.weight > 0 ? `${e.weight} ${data.settings.unit} · ` : ''}
                          {e.goalKind === 'interval' && e.intervalSpec
                            ? `${e.reps.filter(x => x !== null).length}/${e.intervalSpec.intervals} rounds · ${e.intervalSpec.activeSec}s on / ${e.intervalSpec.restSec}s off`
                            : `target ${e.targetSets}×${e.targetReps} · sets: ${repsSummary(e.reps)}`}
                        </div>
                      </div>
                    )
                  })}
                  {s.notes && <div className="historynotes">📝 {s.notes}</div>}
                  <div className="historyactions">
                    <button className="linkbtn" onClick={() => edit(s)}>✎ Edit workout</button>
                    <button className="linkbtn danger" onClick={() => del(s)}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
