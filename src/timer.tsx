import { createContext, useContext, useEffect, useRef, useState } from 'react'

export interface TimerState {
  end: number // epoch ms when timer finishes
  total: number // duration in seconds
}

export interface TimerApi {
  timer: TimerState | null
  now: number
  start: (sec: number) => void
  reset: () => void
  stop: () => void
}

export const TimerCtx = createContext<TimerApi>(null!)
export const useTimer = () => useContext(TimerCtx)

const TKEY = 'workout-timer-v1'

// Once rest is up the timer keeps running and counts UP, so you can see how
// long the next set is overdue. Past this much overdue we drop it on reload —
// a timer left running yesterday isn't useful information today.
const OVERDUE_KEEP_MS = 60 * 60 * 1000
// Overdue past this many seconds escalates the bar from yellow to orange.
export const OVERDUE_LATE_SEC = 90

// Timer stores an absolute end timestamp so it survives page reloads and
// keeps correct time even if the tab is throttled in the background.
export function useTimerState(): TimerApi {
  const [timer, setTimer] = useState<TimerState | null>(() => {
    try {
      const t = JSON.parse(localStorage.getItem(TKEY) || 'null') as TimerState | null
      if (t && Date.now() - t.end < OVERDUE_KEEP_MS) return t
    } catch {}
    return null
  })
  const [now, setNow] = useState(Date.now())
  // Alert once per timer — and never re-alert for a timer that already expired
  // before this page load (e.g. reopening the app mid-overdue).
  const alerted = useRef<number | null>(timer && Date.now() >= timer.end ? timer.end : null)

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [])

  // A backgrounded tab gets its interval throttled — frozen outright on iOS —
  // so the tick that should have fired the alert may never run. Re-check the
  // clock the instant we're foregrounded again.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      setNow(Date.now())
      // If a timer lapsed while we were away, the alert fires on this tick —
      // leave its notification alone. Otherwise anything in the tray is stale
      // from an earlier set, so clear it rather than making the user do it.
      const pending = timer && Date.now() >= timer.end && alerted.current !== timer.end
      if (!pending) void clearRestNotifications()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [timer])

  useEffect(() => {
    if (timer && now >= timer.end && alerted.current !== timer.end) {
      alerted.current = timer.end
      timerDone(timer.end)
    }
  }, [now, timer])

  const persist = (t: TimerState | null) => {
    if (t) localStorage.setItem(TKEY, JSON.stringify(t))
    else localStorage.removeItem(TKEY)
  }

  const start = (sec: number) => {
    // Both of these have to ride on the tap that started the timer: iOS only
    // grants audio and the permission prompt from inside a user gesture.
    primeAudio()
    void ensureNotifyPermission()
    void clearRestNotifications()
    const t = { end: Date.now() + sec * 1000, total: sec }
    persist(t)
    setTimer(t)
  }
  const reset = () => {
    if (timer) start(timer.total)
  }
  const stop = () => {
    void clearRestNotifications()
    persist(null)
    setTimer(null)
  }

  return { timer, now, start, reset, stop }
}

export async function ensureNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  } catch {}
}

// ---------- audio ----------

let audioCtx: AudioContext | null = null

// One long-lived context, opened on a tap. A context built fresh at beep time
// comes up suspended on iOS (no gesture in scope) and never makes a sound.
export function primeAudio() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    audioCtx ||= new Ctx()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {}
}

function beep() {
  try {
    primeAudio()
    const ctx = audioCtx
    if (!ctx) return
    const t0 = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = 880
      g.gain.setValueAtTime(0.001, t0 + i * 0.35)
      g.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.35 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.35 + 0.3)
      o.connect(g)
      g.connect(ctx.destination)
      o.start(t0 + i * 0.35)
      o.stop(t0 + i * 0.35 + 0.32)
    }
  } catch {}
}

// ---------- notifications ----------

const NOTIF_TAG = 'rest-timer'

async function swReg(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker?.getRegistration()) ?? null
  } catch {
    return null
  }
}

// Drop any rest alerts still sitting in the notification tray.
export async function clearRestNotifications() {
  const reg = await swReg()
  if (!reg?.getNotifications) return
  try {
    for (const n of await reg.getNotifications()) {
      if (n.tag?.startsWith(NOTIF_TAG)) n.close()
    }
  } catch {}
}

async function showNotification(end: number) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  // This is why only the first alert of a workout used to land: an undismissed
  // notification with the same tag gets *replaced* silently — no sound, no
  // vibration — so every later set went unannounced unless the tray was
  // cleared by hand. Close the old one first, then post under a tag unique to
  // this timer with renotify set, so the platform treats it as a new alert.
  await clearRestNotifications()
  const opts: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: 'Rest is over — time for your next set!',
    icon: '/icon-192.png',
    tag: `${NOTIF_TAG}-${end}`,
    renotify: true,
    silent: false,
    vibrate: [300, 150, 300, 150, 500],
  }
  const reg = await swReg()
  if (reg) {
    try {
      await reg.showNotification('⏱️ Rest over!', opts)
      return
    } catch {}
  }
  try {
    new Notification('⏱️ Rest over!', opts)
  } catch {}
}

export function timerDone(end: number) {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 500])
  } catch {}
  beep()
  void showNotification(end)
}

// ---------- UI ----------

export function TimerBar() {
  const { timer, now, start, reset, stop } = useTimer()
  if (!timer) return null
  const diffMs = now - timer.end
  const overdue = diffMs >= 0
  // Counting down rounds up (3:00 → 2:59), counting up rounds down (+0:00 → +0:01)
  const secs = overdue ? Math.floor(diffMs / 1000) : Math.ceil(-diffMs / 1000)
  const pct = overdue ? 0 : Math.min(100, (-diffMs / (timer.total * 1000)) * 100)
  const mm = Math.floor(secs / 60)
  const ss = String(secs % 60).padStart(2, '0')
  const cls =
    'timerbar' + (overdue ? (secs >= OVERDUE_LATE_SEC ? ' overdue late' : ' overdue') : '')
  return (
    <div className={cls}>
      <div className="timerbar-progress" style={{ width: pct + '%' }} />
      <div className="timerbar-row">
        <span className="timerbar-time">
          {overdue ? '+' : ''}
          {mm}:{ss}
        </span>
        <div className="timerbar-btns">
          <button onClick={() => start(90)}>1:30</button>
          <button onClick={() => start(180)}>3:00</button>
          <button onClick={() => start(300)}>5:00</button>
          <button onClick={reset} aria-label="Restart timer">↺</button>
          <button onClick={stop} aria-label="Dismiss timer">✕</button>
        </div>
      </div>
    </div>
  )
}

export function TimerPresets() {
  const { timer, start } = useTimer()
  if (timer) return null
  return (
    <div className="card timer-idle">
      <span className="timer-idle-label">⏱ Rest timer</span>
      <div className="timer-idle-btns">
        <button onClick={() => start(90)}>1:30</button>
        <button onClick={() => start(180)}>3:00</button>
        <button onClick={() => start(300)}>5:00</button>
      </div>
    </div>
  )
}
