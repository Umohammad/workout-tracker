import { useSyncExternalStore } from 'react'
import { AppData } from './types'

// Optional push of the whole backup to /api/progress so AI assistants can read
// it from a link. The sync key lives in its own storage slot, never inside
// AppData, so it isn't in exports and never gets uploaded itself.
const KEY = 'workout-tracker-sync'
const ENDPOINT = '/api/progress'
// Rep taps come in bursts mid-workout; wait for a lull rather than uploading
// every tap. Anything still pending is flushed when the app is backgrounded.
const DEBOUNCE_MS = 15000
// Browsers cap keepalive request bodies at 64 KiB.
const KEEPALIVE_MAX = 60000

export interface SyncState {
  key: string
  lastSyncedAt: number | null
  lastError: string | null
  // Hash of the last payload the server accepted, so an unchanged app launch
  // doesn't spend a write.
  lastHash: string | null
  busy: boolean
}

function load(): SyncState {
  const empty: SyncState = { key: '', lastSyncedAt: null, lastError: null, lastHash: null, busy: false }
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...empty, ...JSON.parse(raw), busy: false } : empty
  } catch {
    return empty
  }
}

let state = load()
const listeners = new Set<() => void>()

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  const { busy, ...persist } = state
  try {
    localStorage.setItem(KEY, JSON.stringify(persist))
  } catch {
    // storage full or blocked; the in-memory state still drives the UI
  }
  listeners.forEach(l => l())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    l => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

export function progressUrl(): string {
  return location.origin + ENDPOINT
}

export function setSyncKey(key: string) {
  // A new key means the server hasn't necessarily seen this data yet.
  set({ key: key.trim(), lastError: null, lastHash: null })
}

// FNV-1a; only used to notice "same as last time", not for security.
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16) + ':' + s.length
}

let pending: AppData | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export async function pushNow(data: AppData, opts: { force?: boolean; keepalive?: boolean } = {}): Promise<void> {
  pending = null
  if (timer) clearTimeout(timer)
  timer = null
  if (!state.key) return
  const body = JSON.stringify(data)
  const h = hash(body)
  if (!opts.force && h === state.lastHash) return
  set({ busy: true })
  try {
    const res = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.key}` },
      body,
      keepalive: !!opts.keepalive && body.length < KEEPALIVE_MAX,
    })
    if (!res.ok) {
      const msg = await res.json().then(j => j.error as string, () => `HTTP ${res.status}`)
      set({ busy: false, lastError: msg || `HTTP ${res.status}` })
      return
    }
    set({ busy: false, lastError: null, lastSyncedAt: Date.now(), lastHash: h })
  } catch {
    set({ busy: false, lastError: 'Offline — will retry' })
  }
}

export function scheduleSync(data: AppData) {
  if (!state.key) return
  pending = data
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void pushNow(data), DEBOUNCE_MS)
}

function flush() {
  if (pending) void pushNow(pending, { keepalive: true })
}

// Installed once from App. Returns a cleanup for effects.
export function installSyncTriggers(getData: () => AppData): () => void {
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  const onOnline = () => {
    if (state.lastError) void pushNow(getData())
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flush)
  window.addEventListener('online', onOnline)
  return () => {
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('online', onOnline)
  }
}
