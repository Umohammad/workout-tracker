import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { demoData } from '../src/seed'

const store = new Map<string, string>()
vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  get: vi.fn(async (pathname: string, o: { useCache: boolean }) => {
    expect(o.useCache).toBe(false)
    const body = store.get(pathname)
    return body === undefined ? null : { statusCode: 200, stream: new Response(body).body, blob: {} }
  }),
}))

const mcp = await import('../api/mcp.js')
const rest = await import('../api/report.js')

const SYNCED = '2026-11-16T22:22:56.000Z'
const sync = (data = demoData()) => store.set('progress/latest.json', JSON.stringify({ syncedAt: SYNCED, data }))

beforeEach(() => store.clear())

// A real MCP client, with fetch routed straight into the Vercel handlers.
async function connect() {
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const h = req.method === 'POST' ? mcp.POST : req.method === 'DELETE' ? mcp.DELETE : mcp.GET
    return h(req)
  }
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('https://w.test/api/mcp'), { fetch: fetchImpl as typeof fetch }))
  return client
}

const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0].text

describe('MCP server', () => {
  it('lists read-only tools, including the search/fetch pair ChatGPT expects', async () => {
    const c = await connect()
    const { tools } = await c.listTools()
    expect(tools.map(t => t.name).sort()).toEqual(['fetch', 'get_exercise_history', 'get_progress_report', 'get_raw_export', 'search'])
    expect(tools.every(t => t.annotations?.readOnlyHint)).toBe(true)
    expect(c.getInstructions()).toMatch(/never answer from an earlier result/)
  })

  it('reads the blob fresh on every call', async () => {
    const c = await connect()
    sync()
    const first = textOf(await c.callTool({ name: 'get_progress_report', arguments: {} }))
    expect(first).toMatch(/^Live data\. Last phone sync: 2026-11-16 22:22 UTC/)
    expect(first).toContain('# Workout progress report')
    const d = demoData()
    d.sessions = []
    sync(d)
    const second = textOf(await c.callTool({ name: 'get_progress_report', arguments: { weeks: 4 } }))
    expect(second).not.toEqual(first)
  })

  it('answers exercise history, raw export, search and fetch', async () => {
    sync()
    const c = await connect()
    const name = demoData().exercises[0].name
    const hist = textOf(await c.callTool({ name: 'get_exercise_history', arguments: { exercise: name.slice(0, 4) } }))
    expect(hist).toContain(`## ${name}`)
    const none = textOf(await c.callTool({ name: 'get_exercise_history', arguments: { exercise: 'zzzz' } }))
    expect(none).toMatch(/No exercise matches "zzzz"\. Exercises in the library:/)
    const raw = JSON.parse(textOf(await c.callTool({ name: 'get_raw_export', arguments: {} })))
    expect(raw.lastSyncedAt).toBe(SYNCED)
    expect(raw.data.sessions.length).toBe(demoData().sessions.length)
    const found = JSON.parse(textOf(await c.callTool({ name: 'search', arguments: { query: name } })))
    const ids = found.results.map((r: { id: string }) => r.id)
    expect(ids[0]).toBe('report')
    expect(ids).toContain(`exercise:${name}`)
    const doc = JSON.parse(textOf(await c.callTool({ name: 'fetch', arguments: { id: 'report' } })))
    expect(doc.text).toContain('# Workout progress report')
    expect(doc.metadata.lastSyncedAt).toBe(SYNCED)
  })

  it('says so plainly before the first sync', async () => {
    const c = await connect()
    const r = await c.callTool({ name: 'get_progress_report', arguments: {} })
    expect(r.isError).toBe(true)
    expect(textOf(r)).toMatch(/No workout data has been synced yet/)
  })
})

describe('Custom GPT Action endpoints', () => {
  const at = (path: string) => rest.GET(new Request('https://w.test' + path))

  it('serves the report as JSON, uncached and never redirected', async () => {
    sync()
    const res = await at('/api/report?sessions=2')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const r = await res.json()
    expect(r.lastSyncedAt).toBe(SYNCED)
    expect(r.servedAt).toMatch(/^\d{4}-/)
    expect(r.recentSessions).toHaveLength(2)
  })

  it('serves exercise history and the export from the rewritten paths', async () => {
    sync()
    const name = demoData().exercises[0].name
    const h = await (await at(`/api/report/exercise?name=${encodeURIComponent(name)}`)).json()
    expect(h.matches[0].exercise).toBe(name)
    expect((await at('/api/report/exercise')).status).toBe(400)
    const e = await (await at('/api/report/export')).json()
    expect(e.data.exercises.length).toBe(demoData().exercises.length)
  })

  it('publishes an OpenAPI spec pointing at this host', async () => {
    const spec = await (await at('/openapi.json')).json()
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.servers[0].url).toBe('https://w.test')
    expect(Object.values(spec.paths).map((p: any) => p.get.operationId)).toEqual(['getProgressReport', 'getExerciseHistory', 'getRawExport'])
  })
})
