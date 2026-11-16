// The one synced copy of the app's data: a single private Vercel Blob, written
// by PUT /api/progress and read fresh (useCache: false) by every reader — the
// web page, the MCP server and the Custom GPT Action endpoint.
import { get } from '@vercel/blob'
import type { AppData } from '../../src/types.js'

export const PATHNAME = 'progress/latest.json'

export interface Stored {
  syncedAt: string
  keyHash?: string
  data: AppData
}

export async function readStored(): Promise<Stored | null> {
  const res = await get(PATHNAME, { access: 'private', useCache: false })
  if (!res || res.statusCode !== 200) return null
  return (await new Response(res.stream).json()) as Stored
}

export const NOT_SYNCED = 'No workout data has been synced yet.'
export const NOT_SYNCED_FIX = 'In the app: Settings → AI access → Turn on sync. Data uploads automatically after that.'
export const NO_STORAGE = 'Storage is not reachable. Connect a Vercel Blob store to this project.'
