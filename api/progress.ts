// GET  /api/progress  — public, read-only progress report for AI agents (no auth by design).
//      ?view=export    — the raw backup, same as Settings → Export backup.
// GET  /progress, /progress.txt — the same report as a web page / plain text
//      (rewritten here by vercel.json). Chat assistants read those far more
//      readily than a JSON endpoint.
// GET  /live/<stamp>[/progress.txt|/progress.json|/export.json] — the links the
//      app hands out. <stamp> is ignored; it sits in the PATH so every copied
//      link is a URL no AI fetch cache or search index has seen before (they
//      often drop query strings, so ?t= alone was not enough).
//      Every other GET (/progress, /progress.txt, /api/progress, ?view=export)
//      answers with a 302 to a brand-new /live/<stamp> URL, so old and bare
//      links still reach live data.
//
// Caching: a /live/<stamp> response MAY be stored by the reader. That is
// deliberate. ChatGPT's fetcher was seen receiving the live page (200, logged
// here) and still reporting "cache miss": its fetch layer only hands the model
// pages it was allowed to keep, and no-store / noindex told it not to. A stored
// copy of a /live URL is harmless, because the next copied link is a new URL.
// Vercel's own edge is still told not to cache (Vercel-CDN-Cache-Control).
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
import { buildReport, freshStamp, DEFAULT_SESSIONS, DEFAULT_WEEKS, MAX_SESSIONS, MAX_WEEKS } from './_lib/report.js'
import type { AppData } from '../src/types.js'

const PATHNAME = 'progress/latest.json'

interface Stored {
  syncedAt: string
  keyHash?: string
  data: AppData
}

// Phone-generated keys are 32 hex chars; refuse anything guessable.
const MIN_KEY_LENGTH = 16

// Redirects, errors, PUT replies: nobody may keep a copy.
const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
  'Access-Control-Allow-Origin': '*',
  // Bare links are not for search engines.
  'X-Robots-Tag': 'noindex, nofollow',
}

// A successful /live/<stamp> read: storable by the reader's fetch layer (see
// the header comment), never by Vercel's edge. No robots directives, which AI
// fetch layers can also treat as "do not keep".
const LIVE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'Vercel-CDN-Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
}

const json = (body: unknown, status = 200, headers = HEADERS) =>
  new Response(JSON.stringify(body, null, 2), { status, headers })

const isLive = (url: URL) => /^\/live\/[^/]+(\/|$)/.test(url.pathname)

// Where a bare link should go: the same view under a never-seen /live/<stamp>.
function liveLocation(url: URL, format: Format): string {
  const stamp = freshStamp(new Date()) + Math.random().toString(36).slice(2, 6)
  const suffix =
    format === 'html' ? '' : format === 'md' ? '/progress.txt' : url.searchParams.get('view') === 'export' ? '/export.json' : '/progress.json'
  const keep = new URLSearchParams()
  for (const k of ['sessions', 'weeks']) {
    const v = url.searchParams.get(k)
    if (v !== null) keep.set(k, v)
  }
  const qs = keep.toString()
  return `${url.origin}/live/${stamp}${suffix}${qs ? '?' + qs : ''}`
}

type Format = 'json' | 'md' | 'html'

// The rewrite passes ?format=, but fall back to the path in case the platform
// hands the function the original URL.
function formatOf(url: URL): Format {
  const f = url.searchParams.get('format')
  if (f === 'md' || f === 'html' || f === 'json') return f
  const live = /^\/live\/[^/]+(\/.*)?$/.exec(url.pathname)
  if (live) return live[1]?.endsWith('.txt') ? 'md' : live[1]?.endsWith('.json') ? 'json' : 'html'
  if (url.pathname.endsWith('/progress.txt')) return 'md'
  if (url.pathname.endsWith('/progress')) return url.pathname.startsWith('/api/') ? 'json' : 'html'
  return 'json'
}

function send(format: Format, markdown: string, jsonBody: unknown, status = 200, base = HEADERS): Response {
  if (format === 'json') return json(jsonBody, status, base)
  if (format === 'md') {
    return new Response(markdown, { status, headers: { ...base, 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return new Response(markdownToHtml(markdown), {
    status,
    headers: { ...base, 'Content-Type': 'text/html; charset=utf-8' },
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
  // One line per read, so a "my AI got old data" report can be checked against
  // what actually reached the server (and which fetcher it was).
  console.log(`read ${url.pathname}${url.search} ua=${request.headers.get('user-agent') ?? '-'}`)
  if (!isLive(url)) {
    return new Response(null, { status: 302, headers: { ...HEADERS, Location: liveLocation(url, format) } })
  }
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

  if (url.searchParams.get('view') === 'export' || url.pathname.endsWith('/export.json')) {
    return json(stored.data, 200, LIVE_HEADERS)
  }

  const report = buildReport(stored.data, {
    now: new Date(),
    syncedAt: stored.syncedAt,
    baseUrl: url.origin,
    weeks: clampInt(url.searchParams.get('weeks'), DEFAULT_WEEKS, MAX_WEEKS),
    sessions: clampInt(url.searchParams.get('sessions'), DEFAULT_SESSIONS, MAX_SESSIONS),
  })
  return send(format, format === 'json' ? '' : renderMarkdown(report), report, 200, LIVE_HEADERS)
}

// Some link fetchers probe with HEAD before downloading; answer as GET would.
export async function HEAD(request: Request): Promise<Response> {
  const res = await GET(request)
  return new Response(null, { status: res.status, headers: res.headers })
}

// One line per upload attempt, so "the link has old data" can be traced to a
// phone that never uploaded, or one whose uploads are refused. Never logs the key.
function logPut(outcome: string, body?: AppData) {
  const last = body?.sessions.reduce((m, s) => (s.date > m ? s.date : m), '') || '-'
  console.log(`sync ${outcome}${body ? ` sessions=${body.sessions.length} latest=${last}` : ''}`)
}

export async function PUT(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization')
  const key = auth?.startsWith('Bearer ') ? auth.slice(7) : ''
  if (key.length < MIN_KEY_LENGTH) {
    logPut('refused: no key')
    return json({ error: 'Missing or too-short sync key.' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    logPut('refused: body not JSON')
    return json({ error: 'Body must be JSON.' }, 400)
  }
  if (!isAppData(body)) {
    logPut('refused: not the backup format')
    return json({ error: "That doesn't look like the app's backup format." }, 400)
  }

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
      logPut('refused: different sync key', body)
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
  logPut('ok', body)
  return json({ ok: true, syncedAt: stored.syncedAt, sessions: body.sessions.length })
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Max-Age': '86400',
    },
  })
}
