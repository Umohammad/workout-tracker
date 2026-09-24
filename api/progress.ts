// GET  /api/progress  — public, read-only progress report for AI agents (no auth by design).
//      ?view=export    — the raw backup, same as Settings → Export backup.
// PUT  /api/progress  — the app uploads its data here. Requires
//      `Authorization: Bearer $SYNC_TOKEN`, so only your phone can overwrite it.
//
// Storage is a single private Vercel Blob; connect a Blob store to the project
// so BLOB_READ_WRITE_TOKEN is set.
import { createHash, timingSafeEqual } from 'node:crypto'
import { get, put } from '@vercel/blob'
import { isAppData } from './_lib/validate.js'
import { buildReport, DEFAULT_SESSIONS, DEFAULT_WEEKS, MAX_SESSIONS, MAX_WEEKS } from './_lib/report.js'
import type { AppData } from '../src/types.js'

const PATHNAME = 'progress/latest.json'

interface Stored {
  syncedAt: string
  data: AppData
}

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  // The link is meant to be handed to assistants, not found by search engines.
  'X-Robots-Tag': 'noindex, nofollow',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: HEADERS })

function clampInt(raw: string | null, def: number, max: number): number {
  const n = raw === null ? NaN : parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return def
  return Math.min(n, max)
}

function tokenMatches(header: string | null, expected: string): boolean {
  const given = header?.startsWith('Bearer ') ? header.slice(7) : ''
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return given.length > 0 && timingSafeEqual(a, b)
}

async function readStored(): Promise<Stored | null> {
  const res = await get(PATHNAME, { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200) return null
  return (await new Response(res.stream).json()) as Stored
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  let stored: Stored | null
  try {
    stored = await readStored()
  } catch (err) {
    console.error('blob read failed', err)
    return json({ error: 'Storage is not reachable. Connect a Vercel Blob store to this project.' }, 503)
  }
  if (!stored) {
    return json(
      {
        error: 'No workout data has been synced yet.',
        fix: 'In the app: Settings → AI access → enter the sync key. Data uploads automatically after that.',
      },
      404
    )
  }

  if (url.searchParams.get('view') === 'export') return json(stored.data)

  return json(
    buildReport(stored.data, {
      now: new Date(),
      syncedAt: stored.syncedAt,
      baseUrl: url.origin,
      weeks: clampInt(url.searchParams.get('weeks'), DEFAULT_WEEKS, MAX_WEEKS),
      sessions: clampInt(url.searchParams.get('sessions'), DEFAULT_SESSIONS, MAX_SESSIONS),
    })
  )
}

export async function PUT(request: Request): Promise<Response> {
  const expected = process.env.SYNC_TOKEN
  if (!expected) return json({ error: 'Sync is off on the server: SYNC_TOKEN is not set.' }, 503)
  if (!tokenMatches(request.headers.get('authorization'), expected)) {
    return json({ error: 'Wrong sync key.' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Body must be JSON.' }, 400)
  }
  if (!isAppData(body)) return json({ error: "That doesn't look like the app's backup format." }, 400)

  const stored: Stored = { syncedAt: new Date().toISOString(), data: body }
  try {
    await put(PATHNAME, JSON.stringify(stored), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
  } catch (err) {
    console.error('blob write failed', err)
    return json({ error: 'Storage is not reachable. Connect a Vercel Blob store to this project.' }, 503)
  }
  return json({ ok: true, syncedAt: stored.syncedAt, sessions: body.sessions.length })
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  })
}
