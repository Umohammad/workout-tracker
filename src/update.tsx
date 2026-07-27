import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

// The app is installed as a PWA, so a deployed update only reaches the phone
// once the service worker swaps in the new build. We check for one on every
// launch (and hourly while open), then let the user pull it in when they're
// between sets rather than reloading under them mid-workout.
const CHECK_INTERVAL_MS = 60 * 60 * 1000

export default function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    let cleanup: (() => void) | null = null

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setReady(true)
      },
      onRegisteredSW(_swUrl, reg) {
        if (!reg) return
        const check = () => {
          if (document.visibilityState === 'visible') void reg.update()
        }
        const iv = setInterval(check, CHECK_INTERVAL_MS)
        document.addEventListener('visibilitychange', check)
        cleanup = () => {
          clearInterval(iv)
          document.removeEventListener('visibilitychange', check)
        }
      },
    })

    // registerSW returns the "activate the waiting worker and reload" function
    setUpdate(() => () => updateSW(true))

    return () => cleanup?.()
  }, [])

  if (!ready) return null

  return (
    <div className="updatebar">
      <span>✨ New version available</span>
      <button
        onClick={() => {
          setReloading(true)
          void update?.()
        }}
        disabled={reloading}
      >
        {reloading ? 'Updating…' : 'Update now'}
      </button>
    </div>
  )
}
