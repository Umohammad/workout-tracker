// GET  /api/progress  — public, read-only progress report for AI agents (no auth by design).
//      ?view=export    — the raw backup, same as Settings → Export backup.
// GET  /progress, /progress.txt — the same report as a web page / plain text
//      (rewritten here by vercel.json). Chat assistants read those far more
//      readily than a JSON endpoint.
// PUT  /api/progress  — the app uploads its data here with
//      `Authorization: Bearer <sync key>`. The first key to sync claims the
//      link (only its hash is kept); after that only that key can overwrite it.
//      If the key is ever lost, set SYNC_TOKEN on the server and sync once with
//      that value to take the link back.
//
// Storage is a single private Vercel Blob; connecting a Blob store to the
// project is the only setup.
import { createHash, timingSafeEqual } from 'node:crypto'
import { get, put } from '@vercel/blob'
import { isAppData } from './_lib/validate.js'
import { renderMarkdown, markdownToHtml } from './_lib/markdown.js'
import { buildReport, DEFAULT_SESSIONS, DEFAULT_WEEKS, MAX_SESSIONS, MAX_WEEKS } from './_lib/report.js'
import type { AppData } from '../src/types.js'

const PATHNAME = 'progress/latest.json'

interface Stored {
  syncedAt: string
  keyHash?: string
  data: AppData
}

// Phone-generated keys are 32 hex chars; refuse anything guessable.
const MIN_KEY_LENGTH = 16

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  // The link is meant to be handed to assistants, not found by search engines.
  'X-Robots-Tag': 'noindex, nofollow',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: HEADERS })

type Format = 'json' | 'md' | 'html'

// The rewrite passes ?format=, but fall back to the path in case the platform
// hands the function the original URL.
function formatOf(url: URL): Format {
  const f = url.searchParams.get('format')
  if (f === 'md' || f === 'html' || f === 'json') return f
  if (url.pathname.endsWith('/progress.txt')) return 'md'
  if (url.pathname.endsWith('/progress')) return url.pathname.startsWith('/api/') ? 'json' : 'html'
  return 'json'
}

function send(format: Format, markdown: string, jsonBody: unknown, status = 200): Response {
  if (format === 'json') return json(jsonBody, status)
  if (format === 'md') {
    return new Response(markdown, { status, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return new Response(markdownToHtml(markdown), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function clampInt(raw: string | null, def: number, max: number): number {
  const n = raw === null ? NaN : parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return def
  return Math.min(n, max)
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// Comparing digests keeps this constant-time regardless of input length.
const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))

async function readStored(): Promise<Stored | null> {
  const res = await get(PATHNAME, { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200) return null
  return (await new Response(res.stream).json()) as Stored
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const format = formatOf(url)
  let stored: Stored | null
  try {
    stored = await readStored()
  } catch (err) {
    console.error('blob read failed', err)
    const error = 'Storage is not reachable. Connect a Vercel Blob store to this project.'
    return send(format, `# Workout progress report\n\n${error}\n`, { error }, 503)
  }
  if (!stored) {
    const error = 'No workout data has been synced yet.'
    const fix = 'In the app: Settings → AI access → Turn on sync. Data uploads automatically after that.'
    return send(format, `# Workout progress report\n\n${error} ${fix}\n`, { error, fix }, 404)
  }

  if (url.searchParams.get('view') === 'export') return json(stored.data)

  const report = buildReport(stored.data, {
    now: new Date(),
    syncedAt: stored.syncedAt,
    baseUrl: url.origin,
    weeks: clampInt(url.searchParams.get('weeks'), DEFAULT_WEEKS, MAX_WEEKS),
    sessions: clampInt(url.searchParams.get('sessions'), DEFAULT_SESSIONS, MAX_SESSIONS),
  })
  return send(format, format === 'json' ? '' : renderMarkdown(report), report)
}

export async function PUT(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization')
  const key = auth?.startsWith('Bearer ') ? auth.slice(7) : ''
  if (key.length < MIN_KEY_LENGTH) return json({ error: 'Missing or too-short sync key.' }, 401)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Body must be JSON.' }, 400)
  }
  if (!isAppData(body)) return json({ error: "That doesn't look like the app's backup format." }, 400)

  const keyHash = sha256(key)
  const stored: Stored = { syncedAt: new Date().toISOString(), keyHash, data: body }
  try {
    const current = await readStored()
    const recovery = process.env.SYNC_TOKEN
    const allowed =
      !current?.keyHash ||
      sameHash(keyHash, current.keyHash) ||
      (!!recovery && sameHash(keyHash, sha256(recovery)))
    if (!allowed) {
      return json({ error: 'This link is already synced from a different key. Use the original key.' }, 401)
    }
    await put(PATHNAME, JSON.stringify(stored), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
  } catch (err) {
    console.error('blob access failed', err)
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
