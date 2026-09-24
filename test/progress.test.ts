import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoData } from '../src/seed'

// In-memory stand-in for the private Blob store.
const store = new Map<string, string>()
let failStorage = false
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname: string, body: string, o: { access: string; allowOverwrite: boolean }) => {
    if (failStorage) throw new Error('No token found')
    expect(o).toMatchObject({ access: 'private', allowOverwrite: true, addRandomSuffix: false })
    store.set(pathname, body)
    return { pathname }
  }),
  get: vi.fn(async (pathname: string, o: { access: string; useCache: boolean }) => {
    if (failStorage) throw new Error('No token found')
    expect(o).toEqual({ access: 'private', useCache: false })
    const body = store.get(pathname)
    if (body === undefined) return null
    return { statusCode: 200, stream: new Response(body).body, blob: {} }
  }),
}))

const { GET, PUT, OPTIONS } = await import('../api/progress.js')

const URL_ = 'https://workouts.test/api/progress'
const put = (body: unknown, auth?: string) =>
  PUT(
    new Request(URL_, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
const get = (qs = '') => GET(new Request(URL_ + qs))

const KEY = 'Bearer 0123456789abcdef0123456789abcdef'
const OTHER = 'Bearer ffffffffffffffffffffffffffffffff'

beforeEach(() => {
  store.clear()
  failStorage = false
})
afterEach(() => vi.unstubAllEnvs())

const saved = () => JSON.parse(store.get('progress/latest.json')!)

describe('PUT /api/progress', () => {
  it('refuses a missing or too-short key', async () => {
    expect((await put(demoData())).status).toBe(401)
    expect((await put(demoData(), 'Bearer short')).status).toBe(401)
    expect((await put(demoData(), '0123456789abcdef0123456789abcdef')).status).toBe(401)
    expect(store.size).toBe(0)
  })

  it('rejects bodies that are not a backup', async () => {
    expect((await put('not json', KEY)).status).toBe(400)
    expect((await put({ hello: 1 }, KEY)).status).toBe(400)
    expect(store.size).toBe(0)
  })

  it('lets the first key claim the link, storing only its hash', async () => {
    const data = demoData()
    const res = await put(data, KEY)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, sessions: data.sessions.length })
    expect(saved().data).toEqual(data)
    expect(saved().keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(store.get('progress/latest.json')).not.toContain('0123456789abcdef')
  })

  it('then only accepts that key', async () => {
    await put(demoData(), KEY)
    const before = store.get('progress/latest.json')
    const res = await put({ exercises: [], workouts: [], sessions: [] }, OTHER)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/different key/)
    expect(store.get('progress/latest.json')).toBe(before)
    expect((await put({ exercises: [], workouts: [], sessions: [] }, KEY)).status).toBe(200)
    expect(saved().data.sessions).toEqual([])
  })

  it('SYNC_TOKEN on the server takes a lost link back', async () => {
    await put(demoData(), KEY)
    vi.stubEnv('SYNC_TOKEN', 'ffffffffffffffffffffffffffffffff')
    expect((await put(demoData(), OTHER)).status).toBe(200)
    vi.unstubAllEnvs()
    // the recovery key now owns it; the old one is locked out
    expect((await put(demoData(), OTHER)).status).toBe(200)
    expect((await put(demoData(), KEY)).status).toBe(401)
  })

  it('reports storage failures as 503', async () => {
    failStorage = true
    expect((await put(demoData(), KEY)).status).toBe(503)
  })
})

describe('GET /api/progress', () => {
  it('404s with instructions before the first sync', async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect((await res.json()).fix).toMatch(/Settings/)
  })

  it('serves the report publicly, uncached and unindexed', async () => {
    await put(demoData(), KEY)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/)
    const r = await res.json()
    expect(r.about.endpoints.report).toMatch(/^https:\/\/workouts\.test\/api\/progress/)
    expect(r.lastSyncedAt).toMatch(/^\d{4}-/)
    expect(r.weekly).toHaveLength(12)
    expect(r.recentSessions).toHaveLength(10)
  })

  it('respects weeks/sessions and clamps silly values', async () => {
    await put(demoData(), KEY)
    const r = await (await get('?weeks=3&sessions=2')).json()
    expect(r.weekly).toHaveLength(3)
    expect(r.recentSessions).toHaveLength(2)
    const d = await (await get('?weeks=-5&sessions=abc')).json()
    expect(d.weekly).toHaveLength(12)
    expect((await (await get('?weeks=9999')).json()).weekly).toHaveLength(104)
  })

  it('returns the raw backup for view=export', async () => {
    const data = demoData()
    await put(data, KEY)
    const exported = await (await get('?view=export')).json()
    expect(exported).toEqual(data)
    expect(exported).not.toHaveProperty('keyHash')
  })

  it('reports storage failures as 503', async () => {
    failStorage = true
    expect((await get()).status).toBe(503)
  })
})

describe('GET as a page or text', () => {
  const at = (path: string) => GET(new Request('https://workouts.test' + path))

  it('serves HTML at /progress and Markdown text at /progress.txt', async () => {
    await put(demoData(), KEY)
    const page = await at('/progress')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('<h2>Weekly totals</h2>')
    const txt = await at('/progress.txt')
    expect(txt.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await txt.text()).toMatch(/^# Workout progress report/)
  })

  it('honours the rewrite\'s ?format= and the usual limits', async () => {
    await put(demoData(), KEY)
    const md = await (await at('/api/progress?format=md&sessions=2')).text()
    expect(md.split('## Recent workouts')[1].match(/^### /gm)).toHaveLength(2)
    expect((await at('/api/progress?format=html')).headers.get('content-type')).toContain('text/html')
    expect((await at('/api/progress')).headers.get('content-type')).toContain('application/json')
  })

  it('explains an empty log in the same format', async () => {
    const res = await at('/progress')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('No workout data has been synced yet')
  })
})

it('answers CORS preflight for reads only', () => {
  const res = OPTIONS()
  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
})
