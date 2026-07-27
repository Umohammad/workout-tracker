import { useRef, useState } from 'react'
import { useStore } from '../store'
import { AppData, Settings, todayStr } from '../types'
import { defaultSettings, demoData, seedData } from '../seed'
import { NumField } from '../components'
import { ensureNotifyPermission, timerDone } from '../timer'

export default function SettingsView() {
  const { data, update } = useStore()
  const s = data.settings
  const fileRef = useRef<HTMLInputElement>(null)
  const [notifState, setNotifState] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )

  const upd = (patch: Partial<Settings>) => update(d => ({ ...d, settings: { ...d.settings, ...patch } }))

  const setPlate = (i: number, patch: Partial<{ weight: number; pairs: number }>) =>
    upd({ plates: s.plates.map((p, j) => (j === i ? { ...p, ...patch } : p)) })
  const addPlate = () => upd({ plates: [...s.plates, { weight: 10, pairs: 1 }] })
  const rmPlate = (i: number) => upd({ plates: s.plates.filter((_, j) => j !== i) })

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `workout-backup-${todayStr()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importData = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AppData
        if (!Array.isArray(parsed.exercises) || !Array.isArray(parsed.workouts) || !Array.isArray(parsed.sessions)) {
          throw new Error('bad shape')
        }
        parsed.settings = { ...defaultSettings(), ...parsed.settings }
        if (!window.confirm('Replace ALL current data with this backup?')) return
        update(() => parsed)
        alert('Backup restored ✓')
      } catch {
        alert("That file doesn't look like a valid backup.")
      }
    }
    reader.readAsText(file)
  }

  const requestNotif = async () => {
    await ensureNotifyPermission()
    if (typeof Notification !== 'undefined') setNotifState(Notification.permission)
  }

  const resetAll = () => {
    if (window.confirm('Reset EVERYTHING? All workouts, history and settings will be wiped.')) {
      update(() => seedData())
    }
  }

  const loadDemo = () => {
    if (window.confirm('Load demo data? This REPLACES all current data with 8 weeks of sample training history.')) {
      update(() => demoData())
      alert('Demo data loaded ✓ — check the Progress and History tabs.')
    }
  }

  return (
    <div className="page">
      <header className="pagehead">
        <h1>Settings</h1>
      </header>

      <h2 className="sectionhead">Equipment</h2>
      <div className="card formcard">
        <div className="numrow">
          <NumField label={`Barbell (${s.unit})`} value={s.barWeight} onChange={v => upd({ barWeight: v })} min={0} step={5} />
          <NumField label={`EZ bar (${s.unit})`} value={s.ezBarWeight} onChange={v => upd({ ezBarWeight: v })} min={0} step={5} />
        </div>
        <div className="numrow">
          <NumField label={`Weight step (${s.unit})`} value={s.weightStep} onChange={v => upd({ weightStep: v })} min={0.5} step={2.5} />
        </div>
        <label className="fieldlabel">Unit</label>
        <div className="choicegrid two">
          <button className={'choice' + (s.unit === 'lb' ? ' active' : '')} onClick={() => upd({ unit: 'lb' })}>lb</button>
          <button className={'choice' + (s.unit === 'kg' ? ' active' : '')} onClick={() => upd({ unit: 'kg' })}>kg</button>
        </div>
      </div>

      <h2 className="sectionhead">My plates (pairs you own)</h2>
      <div className="card formcard">
        {s.plates.map((p, i) => (
          <div key={i} className="platerow">
            <NumField label={`Plate ${s.unit}`} value={p.weight} onChange={v => setPlate(i, { weight: v })} min={0.25} step={2.5} />
            <NumField label="Pairs" value={p.pairs} onChange={v => setPlate(i, { pairs: v })} min={0} step={1} />
            <button className="iconbtn danger" onClick={() => rmPlate(i)} aria-label="Remove plate size">✕</button>
          </div>
        ))}
        <button className="linkbtn" onClick={addPlate}>＋ Add plate size</button>
      </div>

      <h2 className="sectionhead">Rest timer</h2>
      <div className="card formcard">
        <div className="numrow">
          <NumField label="Default (seconds)" value={s.defaultTimerSec} onChange={v => upd({ defaultTimerSec: v })} min={15} step={15} />
        </div>
        <label className="fieldlabel">Notifications</label>
        {notifState === 'granted' ? (
          <p className="sub">✓ Enabled — you'll get a buzz + beep + notification when rest is over.</p>
        ) : notifState === 'denied' ? (
          <p className="sub">Blocked — enable notifications for this site in Android's app settings.</p>
        ) : (
          <button className="bigbtn" onClick={requestNotif}>Enable notifications</button>
        )}
        <button className="linkbtn" onClick={() => timerDone()}>Test sound & buzz</button>
      </div>

      <h2 className="sectionhead">Data</h2>
      <div className="card formcard">
        <p className="sub">
          All data lives on this device. Export a backup once in a while (it downloads a JSON file you can re-import
          on any device).
        </p>
        <button className="bigbtn" onClick={exportData}>⬇ Export backup</button>
        <button className="bigbtn" onClick={() => fileRef.current?.click()}>⬆ Import backup</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) importData(f)
            e.target.value = ''
          }}
        />
        <button className="linkbtn" onClick={loadDemo}>Load demo data (8 weeks of sample history)</button>
        <button className="linkbtn danger" onClick={resetAll}>Reset all data</button>
      </div>

      <h2 className="sectionhead">Install on your phone</h2>
      <div className="card">
        <p className="sub">
          <strong>Android:</strong> Chrome → ⋮ menu → <strong>Add to Home screen</strong> → Install.<br />
          <strong>iPhone:</strong> Safari → Share → <strong>Add to Home Screen</strong>.<br />
          It becomes a full-screen app with its own icon and works offline. When a new version ships you'll see an
          “update available” banner at the top — tap it to load the latest.
        </p>
      </div>
    </div>
  )
}
