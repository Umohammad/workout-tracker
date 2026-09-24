import { useRef, useState } from 'react'
import { useStore } from '../store'
import { AppData, Settings, todayStr } from '../types'
import { defaultSettings, demoData, seedData } from '../seed'
import { NumField } from '../components'
import { ensureNotifyPermission, timerDone } from '../timer'
import { newSyncKey, progressUrl, pushNow, setSyncKey, useSyncState } from '../sync'

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
        <p className="sub">
          Barbell and EZ bar move in full steps ({s.weightStep} {s.unit}) since plates load in pairs. Dumbbells,
          cables and added weight move in half steps ({s.weightStep / 2} {s.unit}).
        </p>
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
        <button className="linkbtn" onClick={() => timerDone(Date.now())}>Test sound & buzz</button>
      </div>

      <AiAccess data={data} />

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

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    alert(`${what} copied ✓`)
  } catch {
    window.prompt(`Copy the ${what.toLowerCase()}:`, text)
  }
}

function AiAccess({ data }: { data: AppData }) {
  const sync = useSyncState()
  const [draft, setDraft] = useState('')
  const [haveKey, setHaveKey] = useState(false)
  const url = progressUrl()
  const prompt =
    `My workout log is at ${url} — fetch it, read its "about" section to learn the format, ` +
    `then answer: how's my progress?`

  const turnOn = (key: string) => {
    setSyncKey(key)
    setDraft('')
    setHaveKey(false)
    void pushNow(data, { force: true })
  }

  return (
    <>
      <h2 className="sectionhead">AI access</h2>
      <div className="card formcard">
        <p className="sub">
          Keeps a copy of your log on this app's server so any AI assistant (ChatGPT, Gemini, Claude) can read it
          from one link and answer “how's my progress?”. <strong>Anyone with the link can read it</strong> — it
          holds your workouts and settings, nothing else. Only this phone can change it.
        </p>
        {!sync.key ? (
          haveKey ? (
            <>
              <label className="fieldlabel">Sync key</label>
              <input
                type="password"
                autoComplete="off"
                placeholder="Paste the key from your old device"
                value={draft}
                onChange={e => setDraft(e.target.value)}
              />
              <button className="bigbtn" onClick={() => turnOn(draft.trim())} disabled={draft.trim().length < 16}>
                Turn on sync
              </button>
              <button className="linkbtn" onClick={() => setHaveKey(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="bigbtn" onClick={() => turnOn(newSyncKey())}>Turn on sync</button>
              <button className="linkbtn" onClick={() => setHaveKey(true)}>Moving from another device? Use its key</button>
            </>
          )
        ) : (
          <>
            <p className="sub">
              {sync.busy
                ? 'Syncing…'
                : sync.lastError
                  ? `⚠ ${sync.lastError}`
                  : sync.lastSyncedAt
                    ? `✓ Synced ${ago(sync.lastSyncedAt)} — updates automatically as you log.`
                    : 'Not synced yet.'}
            </p>
            <label className="fieldlabel">Link for your AI</label>
            <p className="sub"><code>{url}</code></p>
            <button className="bigbtn" onClick={() => void copy(prompt, 'AI prompt')}>
              📋 Copy prompt for your AI
            </button>
            <button className="linkbtn" onClick={() => void copy(url, 'Link')}>Copy link only</button>
            <button className="linkbtn" onClick={() => void pushNow(data, { force: true })} disabled={sync.busy}>
              Sync now
            </button>
            <button className="linkbtn" onClick={() => void copy(sync.key, 'Sync key')}>
              Copy sync key (needed to sync from a new phone)
            </button>
            <button
              className="linkbtn danger"
              onClick={() => {
                if (window.confirm('Stop syncing from this device? The last uploaded copy stays readable at the link. Copy your sync key first if you want to turn it back on later.')) {
                  setSyncKey('')
                }
              }}
            >
              Turn off sync
            </button>
          </>
        )}
      </div>
    </>
  )
}
