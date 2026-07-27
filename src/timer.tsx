import { createContext, useContext, useEffect, useState } from 'react'

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

// Timer stores an absolute end timestamp so it survives page reloads and
// keeps correct time even if the tab is throttled in the background.
export function useTimerState(): TimerApi {
  const [timer, setTimer] = useState<TimerState | null>(() => {
    try {
      const t = JSON.parse(localStorage.getItem(TKEY) || 'null') as TimerState | null
      if (t && t.end > Date.now()) return t
    } catch {}
    return null
  })
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (timer && now >= timer.end) {
      timerDone()
      persist(null)
      setTimer(null)
    }
  }, [now, timer])

  const persist = (t: TimerState | null) => {
    if (t) localStorage.setItem(TKEY, JSON.stringify(t))
    else localStorage.removeItem(TKEY)
  }

  const start = (sec: number) => {
    void ensureNotifyPermission()
    const t = { end: Date.now() + sec * 1000, total: sec }
    persist(t)
    setTimer(t)
  }
  const reset = () => {
    if (timer) start(timer.total)
  }
  const stop = () => {
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

function beep() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
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

async function showNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const opts: NotificationOptions & { vibrate?: number[] } = {
    body: 'Rest is over — time for your next set!',
    icon: '/icon-192.png',
    tag: 'rest-timer',
    vibrate: [300, 150, 300, 150, 500],
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification('⏱️ Rest over!', opts)
      return
    }
  } catch {}
  try {
    new Notification('⏱️ Rest over!', opts)
  } catch {}
}

export function timerDone() {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 500])
  } catch {}
  beep()
  void showNotification()
}

export function TimerBar() {
  const { timer, now, start, reset, stop } = useTimer()
  if (!timer) return null
  const remainMs = Math.max(0, timer.end - now)
  const remain = Math.ceil(remainMs / 1000)
  const pct = Math.min(100, (remainMs / (timer.total * 1000)) * 100)
  const mm = Math.floor(remain / 60)
  const ss = String(remain % 60).padStart(2, '0')
  return (
    <div className="timerbar">
      <div className="timerbar-progress" style={{ width: pct + '%' }} />
      <div className="timerbar-row">
        <span className="timerbar-time">
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
