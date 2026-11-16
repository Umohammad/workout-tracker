// POST /api/mcp — a remote MCP server (Streamable HTTP, stateless, JSON
// responses) so an AI agent can read the workout log as a TOOL CALL. Unlike
// handing an agent the /progress link, a tool call goes straight from the
// assistant's backend to this function: no browsing tool, no crawler cache, no
// stored copy. Every call reads the synced blob fresh.
//
// Add it as a custom connector (no authentication):
//   Claude:   Settings → Connectors → Add custom connector → https://<host>/api/mcp
//   ChatGPT:  Settings → Apps & Connectors → (Developer mode) → Create → same URL
//
// Read-only and public, like the /progress link. Writes stay on PUT /api/progress.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { exerciseHistoryMarkdown, freshness, reportMarkdown, stamp } from './_lib/agent.js'
import { MAX_SESSIONS, MAX_WEEKS } from './_lib/report.js'
import { NO_STORAGE, NOT_SYNCED, NOT_SYNCED_FIX, readStored, type Stored } from './_lib/store.js'

const INSTRUCTIONS =
  "Live access to the owner's personal strength-training log, synced from their workout tracker app. " +
  'Call get_progress_report whenever the user asks about their training, and call it again for every new question: ' +
  'the data changes as they train, so never answer from an earlier result in the conversation. ' +
  'Use get_exercise_history for one lift in depth, get_raw_export for everything. All tools are read-only.'

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError } : {}) })

// Reads the blob, or explains why it can't, as tool output the model can relay.
async function withData<T>(tool: string, fn: (stored: Stored) => T): Promise<T | ReturnType<typeof text>> {
  console.log(`mcp tool ${tool}`)
  let stored: Stored | null
  try {
    stored = await readStored()
  } catch (err) {
    console.error('blob read failed', err)
    return text(NO_STORAGE, true)
  }
  if (!stored) return text(`${NOT_SYNCED} ${NOT_SYNCED_FIX}`, true)
  return fn(stored)
}

function buildServer(origin: string): McpServer {
  const server = new McpServer({ name: 'workout-tracker', version: '1.0.0' }, { instructions: INSTRUCTIONS })
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

  server.registerTool(
    'get_progress_report',
    {
      title: 'Get live workout progress report',
      description:
        "The owner's live workout progress report: how to read it, overview, last 28 days vs the 28 before, weekly totals by " +
        'muscle group, per-exercise bests (top weight, estimated 1RM) and the most recent workouts in full. ' +
        'Read fresh on every call; call it again rather than reusing an earlier result.',
      inputSchema: {
        weeks: z.number().int().min(1).max(MAX_WEEKS).optional().describe('Weekly buckets to include (default 12)'),
        sessions: z.number().int().min(1).max(MAX_SESSIONS).optional().describe('Recent workouts to list in full (default 10)'),
      },
      annotations: readOnly,
    },
    async ({ weeks, sessions }) =>
      withData('get_progress_report', s => text(`${stamp(s)}\n\n${reportMarkdown(s, origin, weeks, sessions)}`))
  )

  server.registerTool(
    'get_exercise_history',
    {
      title: 'Get one exercise’s full history',
      description:
        'Every logged set of the exercises whose name contains the given text (case-insensitive), oldest first: date, ' +
        'weight, reps per set, target. Use for "how is my squat going". Lists all exercise names if nothing matches.',
      inputSchema: { exercise: z.string().min(1).describe('Exercise name or part of it, e.g. "squat"') },
      annotations: readOnly,
    },
    async ({ exercise }) =>
      withData('get_exercise_history', s => text(`${stamp(s)}\n\n${exerciseHistoryMarkdown(s.data, exercise)}`))
  )

  server.registerTool(
    'get_raw_export',
    {
      title: 'Get the raw backup',
      description:
        "The complete raw backup as JSON, identical to the app's Export backup: every exercise, saved workout and session ever " +
        'logged, with raw IDs. Large; prefer get_progress_report unless you need everything.',
      inputSchema: {},
      annotations: readOnly,
    },
    async () =>
      withData('get_raw_export', s => text(JSON.stringify({ ...freshness(s), data: s.data })))
  )

  // ChatGPT's connectors (and deep research) look for this search/fetch pair.
  server.registerTool(
    'search',
    {
      title: 'Search the workout log',
      description:
        'Search the workout log. Returns the live progress report, plus one result per exercise whose name matches the query. ' +
        'Pass any result id to fetch for its full, live text.',
      inputSchema: { query: z.string().describe('What to look for, e.g. "squat" or "progress"') },
      annotations: readOnly,
    },
    async ({ query }) =>
      withData('search', s => {
        const q = query.trim().toLowerCase()
        const results = [
          { id: 'report', title: 'Workout progress report (live)', url: `${origin}/progress` },
          ...s.data.exercises
            .filter(e => q && (e.name.toLowerCase().includes(q) || q.includes(e.name.toLowerCase())))
            .map(e => ({ id: `exercise:${e.name}`, title: `${e.name} — full history (live)`, url: `${origin}/progress` })),
        ]
        return text(JSON.stringify({ results }))
      })
  )

  server.registerTool(
    'fetch',
    {
      title: 'Fetch a workout log document',
      description: 'Full live text for an id returned by search: "report", or "exercise:<name>".',
      inputSchema: { id: z.string().describe('An id from search') },
      annotations: readOnly,
    },
    async ({ id }) =>
      withData('fetch', s => {
        const isEx = id.startsWith('exercise:')
        const name = isEx ? id.slice('exercise:'.length) : ''
        const body = isEx ? exerciseHistoryMarkdown(s.data, name) : reportMarkdown(s, origin)
        return text(
          JSON.stringify({
            id,
            title: isEx ? `${name} — full history` : 'Workout progress report',
            text: `${stamp(s)}\n\n${body}`,
            url: `${origin}/progress`,
            metadata: freshness(s),
          })
        )
      })
  )

  return server
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Cache-Control': 'no-store',
}

async function handle(request: Request): Promise<Response> {
  console.log(`mcp ${request.method} ua=${request.headers.get('user-agent') ?? '-'}`)
  // Stateless: a fresh server per request, so any instance can answer any call.
  const server = buildServer(new URL(request.url).origin)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  const res = await transport.handleRequest(request)
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

export const POST = handle
export const GET = handle
export const DELETE = handle

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
}
