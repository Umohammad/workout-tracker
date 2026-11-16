// What an AI agent gets when it asks, shared by the MCP server (api/mcp.ts)
// and the Custom GPT Action endpoint (api/report.ts). Every call reads the blob
// afresh: these are tool calls, so there is no browser or crawler cache
// between the agent and the data.
import type { AppData } from '../../src/types.js'
import { buildReport, DEFAULT_SESSIONS, DEFAULT_WEEKS, MAX_SESSIONS, MAX_WEEKS, sidesFor } from './report.js'
import { renderMarkdown } from './markdown.js'
import type { Stored } from './store.js'

export function clampInt(raw: unknown, def: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(n) || n < 1) return def
  return Math.min(Math.floor(n), max)
}

export function freshness(stored: Stored, now = new Date()) {
  return {
    lastSyncedAt: stored.syncedAt,
    servedAt: now.toISOString(),
    note:
      'Read live from the server just now. lastSyncedAt is when the phone last uploaded; ' +
      'workouts logged after that are not included yet.',
  }
}

export function report(stored: Stored, origin: string, weeks?: unknown, sessions?: unknown, now = new Date()) {
  return buildReport(stored.data, {
    now,
    syncedAt: stored.syncedAt,
    baseUrl: origin,
    weeks: clampInt(weeks, DEFAULT_WEEKS, MAX_WEEKS),
    sessions: clampInt(sessions, DEFAULT_SESSIONS, MAX_SESSIONS),
  })
}

export const reportMarkdown = (stored: Stored, origin: string, weeks?: unknown, sessions?: unknown) =>
  renderMarkdown(report(stored, origin, weeks, sessions))

// Every logged set of the exercises whose name contains `query`
// (case-insensitive), oldest first. Finished workouts only, like the report.
export function exerciseHistory(data: AppData, query: string, limit = 200) {
  const q = query.trim().toLowerCase()
  const exercises = data.exercises.filter(e => q && e.name.toLowerCase().includes(q))
  const sessions = data.sessions
    .filter(s => s.finished)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt)
  const matches = exercises.map(ex => {
    const entries = sessions.flatMap(s =>
      s.entries
        .filter(e => e.exerciseId === ex.id && e.reps.some(r => r !== null && r > 0))
        .map(e => ({
          date: s.date,
          workout: s.workoutName,
          weight: e.weight,
          reps: e.reps,
          target: e.goalKind === 'interval' ? 'interval' : `${e.targetSets}×${e.targetReps}`,
        }))
    )
    return {
      exercise: ex.name,
      type: ex.type,
      muscleGroup: ex.muscleGroup,
      perSide: sidesFor(ex) === 2,
      timesLogged: entries.length,
      entries: entries.slice(-limit),
    }
  })
  return {
    query,
    unit: data.settings?.unit ?? 'lb',
    matches,
    ...(matches.length ? {} : { exerciseNames: data.exercises.map(e => e.name).sort() }),
  }
}

export function exerciseHistoryMarkdown(data: AppData, query: string): string {
  const h = exerciseHistory(data, query)
  if (!h.matches.length) {
    return `No exercise matches "${query}". Exercises in the library: ${(h.exerciseNames ?? []).join(', ')}.`
  }
  return h.matches
    .map(m => {
      const lines = m.entries.map(
        e => `- ${e.date} (${e.workout}): ${e.weight} ${h.unit}${m.perSide ? '/side' : ''} × ${e.reps.map(r => (r === null ? '–' : r)).join(', ')} (target ${e.target})`
      )
      return [
        `## ${m.exercise} (${m.type}, ${m.muscleGroup}${m.perSide ? ', weight is per side' : ''})`,
        `Logged ${m.timesLogged} times.`,
        ...(lines.length ? lines : ['- Never logged in a finished workout.']),
      ].join('\n')
    })
    .join('\n\n')
}

export const stamp = (stored: Stored, now = new Date()) =>
  `Live data. Last phone sync: ${stored.syncedAt.slice(0, 16).replace('T', ' ')} UTC. Served: ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`
