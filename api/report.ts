// Plain JSON endpoints for tools that call HTTP APIs directly, chiefly a
// ChatGPT Custom GPT "Action". Like the MCP server, these are server-to-server
// calls: no browser, no crawler cache, read fresh every time, never redirected.
//   GET /api/report                  live progress report (JSON)   ?weeks= ?sessions=
//   GET /api/report/exercise?name=   one exercise's full history   (rewritten by vercel.json)
//   GET /api/report/export           the raw backup                (rewritten by vercel.json)
//   GET /openapi.json                the OpenAPI spec to paste into a Custom GPT
import { exerciseHistory, freshness, report } from './_lib/agent.js'
import { MAX_SESSIONS, MAX_WEEKS } from './_lib/report.js'
import { NO_STORAGE, NOT_SYNCED, NOT_SYNCED_FIX, readStored, type Stored } from './_lib/store.js'

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'X-Robots-Tag': 'noindex, nofollow',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: HEADERS })

type View = 'report' | 'exercise' | 'export' | 'openapi'

function viewOf(url: URL): View {
  const v = url.searchParams.get('view')
  if (v === 'exercise' || v === 'export' || v === 'openapi') return v
  if (url.pathname.endsWith('/openapi.json')) return 'openapi'
  if (url.pathname.endsWith('/exercise')) return 'exercise'
  if (url.pathname.endsWith('/export')) return 'export'
  return 'report'
}

export function openapi(origin: string) {
  const fresh = {
    lastSyncedAt: { type: 'string', description: 'When the phone last uploaded. Later workouts are not included yet.' },
    servedAt: { type: 'string', description: 'When the server read the data for this response (now).' },
  }
  const ok = (description: string) => ({
    description,
    content: { 'application/json': { schema: { type: 'object', properties: fresh, additionalProperties: true } } },
  })
  return {
    openapi: '3.1.0',
    info: {
      title: 'Workout Tracker (live)',
      version: '1.0.0',
      description:
        "Read-only, live access to the owner's strength-training log. Every call reads the latest synced data; " +
        'call again for each new question instead of reusing an earlier response.',
    },
    servers: [{ url: origin }],
    paths: {
      '/api/report': {
        get: {
          operationId: 'getProgressReport',
          summary: 'Live progress report: overview, 28-day trend, weekly totals, per-exercise bests, recent workouts',
          parameters: [
            { name: 'weeks', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: MAX_WEEKS }, description: 'Weekly buckets (default 12)' },
            { name: 'sessions', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: MAX_SESSIONS }, description: 'Recent workouts in full (default 10)' },
          ],
          responses: { '200': ok('The report, with how-to-read notes in about.howToRead') },
        },
      },
      '/api/report/exercise': {
        get: {
          operationId: 'getExerciseHistory',
          summary: 'Every logged set of exercises whose name contains `name`, oldest first',
          parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string' }, description: 'e.g. squat' }],
          responses: { '200': ok('Matching exercises and their history; lists all names if none match') },
        },
      },
      '/api/report/export': {
        get: {
          operationId: 'getRawExport',
          summary: 'The complete raw backup (every workout ever logged). Large; prefer getProgressReport',
          responses: { '200': ok('Raw backup under `data`') },
        },
      },
    },
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const view = viewOf(url)
  console.log(`report ${view}${url.search} ua=${request.headers.get('user-agent') ?? '-'}`)
  if (view === 'openapi') return json(openapi(url.origin))

  let stored: Stored | null
  try {
    stored = await readStored()
  } catch (err) {
    console.error('blob read failed', err)
    return json({ error: NO_STORAGE }, 503)
  }
  if (!stored) return json({ error: NOT_SYNCED, fix: NOT_SYNCED_FIX }, 404)

  const f = freshness(stored)
  if (view === 'export') return json({ ...f, data: stored.data })
  if (view === 'exercise') {
    const name = url.searchParams.get('name') ?? ''
    if (!name.trim()) return json({ error: 'Pass ?name=<exercise>, e.g. ?name=squat' }, 400)
    return json({ ...f, ...exerciseHistory(stored.data, name) })
  }
  return json({ ...f, ...report(stored, url.origin, url.searchParams.get('weeks'), url.searchParams.get('sessions')) })
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' },
  })
}
