import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useNav } from '../nav'
import { TimerPresets, useTimer } from '../timer'
import { calcPlates, nextWeight, plateColor, plateHeight, weightStepFor } from '../plates'
import { entryRatio, formatDate, lastLogFor, makeEntry, ratioColor, repsSummary } from '../sessions'
import { EXERCISE_TYPE_LABELS, PlateInv, Session, SessionEntry, goalLabel, pinnedFirst } from '../types'

// Keep the screen awake mid-workout (chalky hands shouldn't have to unlock a phone)
function useWakeLock() {
  useEffect(() => {
    let lock: any = null
    const req = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen')
      } catch {}
    }
    void req()
    const onVis = () => {
      if (document.visibilityState === 'visible') void req()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      try {
        lock?.release?.()
      } catch {}
    }
  }, [])
}

export default function SessionView({ sessionId }: { sessionId: string }) {
  const { data, update } = useStore()
  const { go } = useNav()
  useWakeLock()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const session = data.sessions.find(s => s.id === sessionId)
  if (!session) {
    return (
      <div className="page">
        <p className="sub">Session not found.</p>
      </div>
    )
  }

  const updateSession = (fn: (s: Session) => Session) =>
    update(d => ({ ...d, sessions: d.sessions.map(s => (s.id === sessionId ? fn(s) : s)) }))

  const anyLogged = session.entries.some(e => e.reps.some(r => r !== null))
  const editingPast = session.finished
  const isFreeform = session.workoutId === ''
  const backTo = editingPast ? ({ name: 'history' } as const) : ({ name: 'home' } as const)

  const available = pinnedFirst(
    data.exercises.filter(
      e => !session.entries.some(en => en.exerciseId === e.id) && e.name.toLowerCase().includes(search.toLowerCase())
    )
  )

  const addExercise = (exId: string) => {
    const entry = makeEntry(data, exId)
    if (entry) update(d => ({
      ...d,
      sessions: d.sessions.map(s => (s.id === sessionId ? { ...s, entries: [...s.entries, entry] } : s)),
    }))
    setSearch('')
  }

  const finish = () => {
    if (!anyLogged) {
      if (window.confirm('Nothing logged — discard this workout?')) {
        update(d => ({ ...d, sessions: d.sessions.filter(s => s.id !== sessionId) }))
        go({ name: 'home' })
      }
      return
    }
    updateSession(s => ({ ...s, finished: true }))
    go({ name: 'home' })
  }

  const discard = () => {
    if (window.confirm(`Discard this ${session.workoutName} session? Everything logged today will be lost.`)) {
      update(d => ({ ...d, sessions: d.sessions.filter(s => s.id !== sessionId) }))
      go({ name: 'home' })
    }
  }

  const deleteFromHistory = () => {
    if (window.confirm(`Delete this ${session.workoutName} session from ${formatDate(session.date)}? This can't be undone.`)) {
      update(d => ({ ...d, sessions: d.sessions.filter(s => s.id !== sessionId) }))
      go({ name: 'history' })
    }
  }

  return (
    <div className="page">
      <header className="pagehead">
        <button className="backbtn" onClick={() => go(backTo)}>‹</button>
        <div>
          <h1>{session.workoutName}</h1>
          <div className="sub">{formatDate(session.date)}{editingPast ? ' · finished' : ''}</div>
        </div>
      </header>

      {editingPast && (
        <div className="card editbanner">
          ✎ Editing a past workout — changes save automatically.
        </div>
      )}

      {!editingPast && <TimerPresets />}

      {isFreeform && !editingPast && (
        <div className="card formcard">
          <label className="fieldlabel">Session name</label>
          <input
            value={session.workoutName}
            onChange={e => updateSession(s => ({ ...s, workoutName: e.target.value }))}
            placeholder="e.g. Quick Arms, Hotel Gym…"
          />
        </div>
      )}

      {session.entries.map((entry, i) => (
        <ExerciseTile key={entry.exerciseId + '-' + i} session={session} entry={entry} index={i} />
      ))}
      {session.entries.length === 0 && (
        <p className="sub">
          {isFreeform
            ? 'No exercises yet — tap ＋ Add Exercise below and log as you go.'
            : 'This workout has no exercises yet — add one below, or edit the Saved Workout.'}
        </p>
      )}

      {!pickerOpen && (
        <button className="bigbtn" onClick={() => setPickerOpen(true)}>＋ Add Exercise</button>
      )}
      {pickerOpen && (
        <div className="card picker">
          <input autoFocus placeholder="Search exercises…" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="pickerlist">
            {available.map(e => (
              <button key={e.id} className="pickeritem" onClick={() => addExercise(e.id)}>
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
                  back: { name: 'session', sessionId },
                  addToSessionId: sessionId,
                })
              }
            >
              ＋ Create new exercise
            </button>
            <button className="linkbtn" onClick={() => setPickerOpen(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="card notescard">
        <label className="fieldlabel">Notes</label>
        <textarea
          value={session.notes}
          onChange={e => updateSession(s => ({ ...s, notes: e.target.value }))}
          placeholder="How did it feel? PRs, form cues, aches…"
          rows={3}
        />
      </div>

      {editingPast ? (
        <>
          <button className="bigbtn finish" onClick={() => go({ name: 'history' })}>✓ Done editing</button>
          <button className="linkbtn danger" onClick={deleteFromHistory}>Delete this workout from history</button>
        </>
      ) : (
        <>
          <button className="bigbtn finish" onClick={finish}>✓ Finish Workout</button>
          <button className="bigbtn" onClick={() => go({ name: 'home' })}>💾 Save & continue later</button>
          <button className="linkbtn danger" onClick={discard}>Discard this workout</button>
        </>
      )}
    </div>
  )
}

function ExerciseTile({ session, entry, index }: { session: Session; entry: SessionEntry; index: number }) {
  const { data, update } = useStore()
  const { start } = useTimer()
  const s = data.settings
  const ex = data.exercises.find(e => e.id === entry.exerciseId)
  const isBarType = ex?.type === 'barbell' || ex?.type === 'ezbar'
  const barW = ex?.type === 'ezbar' ? s.ezBarWeight : s.barWeight
  const last = lastLogFor(data, entry.exerciseId, session.id)
  const interval = entry.goalKind === 'interval'
  const spec = entry.intervalSpec

  const updEntry = (fn: (e: SessionEntry) => SessionEntry) =>
    update(d => ({
      ...d,
      sessions: d.sessions.map(ss =>
        ss.id !== session.id ? ss : { ...ss, entries: ss.entries.map((en, i) => (i === index ? fn(en) : en)) }
      ),
    }))

  const step = weightStepFor(ex?.type, s.weightStep)
  const bumpWeight = (dir: 1 | -1) => {
    updEntry(en => ({ ...en, weight: nextWeight(en.weight, dir, step, isBarType ? barW : 0) }))
  }

  const tap = (i: number) => {
    const v = entry.reps[i]
    let next: number | null
    if (v === null) next = interval ? 1 : entry.targetReps
    else if (v === 0) next = null
    else next = interval ? null : v - 1
    updEntry(en => ({ ...en, reps: en.reps.map((r, j) => (j === i ? next : r)) }))
    if (v === null) start(interval && spec ? Math.max(5, spec.restSec) : s.defaultTimerSec)
  }

  const longPress = (i: number) => {
    if (interval) {
      tap(i)
      return
    }
    const v = entry.reps[i]
    const next = v === null ? entry.targetReps + 1 : v + 1
    updEntry(en => ({ ...en, reps: en.reps.map((r, j) => (j === i ? next : r)) }))
    if (v === null) start(s.defaultTimerSec)
  }

  const addSet = () => updEntry(en => ({ ...en, reps: [...en.reps, null] }))
  const removeExtraSet = () =>
    updEntry(en =>
      en.reps.length > en.targetSets && en.reps[en.reps.length - 1] === null
        ? { ...en, reps: en.reps.slice(0, -1) }
        : en
    )

  const hasExtraUnused = entry.reps.length > entry.targetSets && entry.reps[entry.reps.length - 1] === null
  const ratio = entryRatio(entry)
  const logged = entry.reps.some(r => r !== null)

  const removeEntry = () =>
    update(d => ({
      ...d,
      sessions: d.sessions.map(ss =>
        ss.id !== session.id ? ss : { ...ss, entries: ss.entries.filter((_, j) => j !== index) }
      ),
    }))

  return (
    <div className="card extile">
      <div className="extile-head">
        <div>
          <strong>{ex?.name ?? 'Unknown exercise'}</strong>
          <div className="sub">
            {ex ? EXERCISE_TYPE_LABELS[ex.type] : ''} · {ex?.muscleGroup} ·{' '}
            {interval && spec
              ? `${spec.intervals} × ${spec.activeSec}s on / ${spec.restSec}s off`
              : `${entry.targetSets}×${entry.targetReps}`}
          </div>
        </div>
        {logged ? (
          <span className="pct" style={{ color: ratioColor(ratio) }}>
            {Math.round(ratio * 100)}%
          </span>
        ) : (
          <button className="iconbtn danger" onClick={removeEntry} aria-label="Remove exercise from this session">✕</button>
        )}
      </div>

      {last && (
        <div className="lastlog">
          Last: {last.weight > 0 ? `${last.weight} ${s.unit} — ` : ''}
          {repsSummary(last.reps)} <span className="sub">({formatDate(last.date)})</span>
        </div>
      )}

      <div className="weightrow">
        <button className="stepbtn" onClick={() => bumpWeight(-1)} aria-label={`Decrease weight by ${step} ${s.unit}`}>−</button>
        <div className="weightval">
          <span className="weightnum">{entry.weight}</span>
          <span className="weightunit">
            {s.unit}
            {ex?.type === 'calisthenics' ? ' added' : ''} · ±{step}
          </span>
        </div>
        <button className="stepbtn" onClick={() => bumpWeight(1)} aria-label={`Increase weight by ${step} ${s.unit}`}>＋</button>
      </div>

      {isBarType && <PlateCalc total={entry.weight} bar={barW} plates={s.plates} unit={s.unit} />}

      <div className="circles">
        {entry.reps.map((v, i) => {
          const target = interval ? 1 : entry.targetReps
          const empty = v === null
          const over = v !== null && v > target
          const label = empty
            ? interval
              ? String(i + 1)
              : String(entry.targetReps)
            : interval
              ? '✓'
              : String(v)
          const bg = empty ? undefined : ratioColor(v! / target)
          return (
            <RepCircle
              key={i}
              label={label}
              empty={empty}
              over={over}
              bg={bg}
              onTap={() => tap(i)}
              onLongPress={() => longPress(i)}
            />
          )
        })}
        <button className="repcircle addset" onClick={addSet} aria-label="Add an extra set">＋</button>
        {hasExtraUnused && (
          <button className="repcircle removeset" onClick={removeExtraSet} aria-label="Remove extra set">−</button>
        )}
      </div>
      <div className="circleshint">tap = log set · tap again = −1 rep · hold = +1 rep</div>
    </div>
  )
}

function RepCircle({
  label,
  empty,
  over,
  bg,
  onTap,
  onLongPress,
}: {
  label: string
  empty: boolean
  over: boolean
  bg?: string
  onTap: () => void
  onLongPress: () => void
}) {
  const t = useRef<number | null>(null)
  const firedLong = useRef(false)

  const clear = () => {
    if (t.current !== null) {
      clearTimeout(t.current)
      t.current = null
    }
  }
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    firedLong.current = false
    clear()
    t.current = window.setTimeout(() => {
      firedLong.current = true
      onLongPress()
      try {
        navigator.vibrate?.(40)
      } catch {}
    }, 450)
  }
  const up = () => {
    clear()
    if (!firedLong.current) onTap()
    firedLong.current = false
  }
  const cancel = () => {
    clear()
    firedLong.current = true
  }

  return (
    <button
      className={'repcircle' + (empty ? ' empty' : ' filled') + (over ? ' over' : '')}
      style={empty ? undefined : { background: bg }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={e => e.preventDefault()}
    >
      {label}
    </button>
  )
}

function PlateCalc({ total, bar, plates, unit }: { total: number; bar: number; plates: PlateInv[]; unit: string }) {
  const res = calcPlates(total, bar, plates)
  const darkText = (w: number) => (w >= 10 && w < 25) || (w >= 35 && w < 45)
  return (
    <div className="platecalc">
      <div className="platecalc-visual">
        <div className="barstub" />
        {res.perSide.map((w, i) => (
          <div
            key={i}
            className="plate"
            style={{ background: plateColor(w), height: plateHeight(w), color: darkText(w) ? '#10131a' : '#fff' }}
          >
            {w}
          </div>
        ))}
        {res.perSide.length === 0 && (
          <span className="platecalc-empty">
            empty bar ({bar} {unit})
          </span>
        )}
      </div>
      <div className="platecalc-text">
        {res.perSide.length > 0 && (
          <>
            Per side: <strong>{res.perSide.join(' + ')}</strong>
          </>
        )}
        {!res.exact && (
          <span className="warn">
            {' '}
            · closest with your plates: {res.achieved} {unit}
          </span>
        )}
      </div>
    </div>
  )
}
