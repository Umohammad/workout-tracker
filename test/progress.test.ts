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

beforeEach(() => {
  store.clear()
  failStorage = false
  vi.stubEnv('SYNC_TOKEN', 'correct-horse')
})
afterEach(() => vi.unstubAllEnvs())

describe('PUT /api/progress', () => {
  it('refuses when the server has no SYNC_TOKEN', async () => {
    vi.stubEnv('SYNC_TOKEN', '')
    const res = await put(demoData(), 'Bearer correct-horse')
    expect(res.status).toBe(503)
    expect(store.size).toBe(0)
  })

  it('refuses a missing or wrong key', async () => {
    expect((await put(demoData())).status).toBe(401)
    expect((await put(demoData(), 'Bearer wrong')).status).toBe(401)
    expect((await put(demoData(), 'correct-horse')).status).toBe(401)
    expect(store.size).toBe(0)
  })

  it('rejects bodies that are not a backup', async () => {
    expect((await put('not json', 'Bearer correct-horse')).status).toBe(400)
    expect((await put({ hello: 1 }, 'Bearer correct-horse')).status).toBe(400)
    expect(store.size).toBe(0)
  })

  it('stores a valid backup', async () => {
    const data = demoData()
    const res = await put(data, 'Bearer correct-horse')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({ ok: true, sessions: data.sessions.length })
    expect(JSON.parse(store.get('progress/latest.json')!).data).toEqual(data)
  })

  it('reports storage failures as 503', async () => {
    failStorage = true
    expect((await put(demoData(), 'Bearer correct-horse')).status).toBe(503)
  })
})

describe('GET /api/progress', () => {
  it('404s with instructions before the first sync', async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect((await res.json()).fix).toMatch(/Settings/)
  })

  it('serves the report publicly, uncached and unindexed', async () => {
    await put(demoData(), 'Bearer correct-horse')
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
    await put(demoData(), 'Bearer correct-horse')
    const r = await (await get('?weeks=3&sessions=2')).json()
    expect(r.weekly).toHaveLength(3)
    expect(r.recentSessions).toHaveLength(2)
    const d = await (await get('?weeks=-5&sessions=abc')).json()
    expect(d.weekly).toHaveLength(12)
    expect((await (await get('?weeks=9999')).json()).weekly).toHaveLength(104)
  })

  it('returns the raw backup for view=export', async () => {
    const data = demoData()
    await put(data, 'Bearer correct-horse')
    expect(await (await get('?view=export')).json()).toEqual(data)
  })

  it('reports storage failures as 503', async () => {
    failStorage = true
    expect((await get()).status).toBe(503)
  })
})

it('answers CORS preflight for reads only', () => {
  const res = OPTIONS()
  expect(res.status).toBe(204)
  expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
})
