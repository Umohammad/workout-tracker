import { describe, expect, it } from 'vitest'
import { buildReport } from '../api/_lib/report.js'
import { markdownToHtml, renderMarkdown } from '../api/_lib/markdown.js'
import { defaultSettings, demoData } from '../src/seed'
import type { AppData } from '../src/types'

const opts = { now: new Date('2026-09-23T15:00:00Z'), syncedAt: '2026-09-23T14:05:00.000Z', baseUrl: 'https://w.test', weeks: 4, sessions: 10 }

const data: AppData = {
  exercises: [
    { id: 'sq', name: 'Squat', type: 'barbell', muscleGroup: 'Legs', goal: { kind: 'setsreps', sets: 3, reps: 5 } },
    { id: 'db', name: 'DB | Press', type: 'dumbbell', muscleGroup: 'Shoulders', goal: { kind: 'setsreps', sets: 3, reps: 8 } },
    { id: 'pu', name: 'Pull-ups', type: 'calisthenics', muscleGroup: 'Back', goal: { kind: 'setsreps', sets: 3, reps: 8 } },
  ],
  workouts: [],
  sessions: [
    {
      id: '1', workoutId: '', workoutName: 'Leg <day>', date: '2026-09-22', startedAt: 1, finished: true,
      notes: 'felt strong\nnew belt',
      entries: [
        { exerciseId: 'sq', goalKind: 'setsreps', weight: 215, targetSets: 3, targetReps: 5, reps: [5, 3, null] },
        { exerciseId: 'db', goalKind: 'setsreps', weight: 40, targetSets: 3, targetReps: 8, reps: [8, 8, 8] },
        { exerciseId: 'pu', goalKind: 'setsreps', weight: 0, targetSets: 3, targetReps: 8, reps: [10, 9, 8] },
      ],
    },
  ],
  settings: defaultSettings(),
}

describe('renderMarkdown', () => {
  const md = renderMarkdown(buildReport(data, opts))

  it('states freshness, units and how to read it up front', () => {
    expect(md).toMatch(/^# Workout progress report\n\nData as of \*\*2026-09-23 14:05 UTC\*\*.*Weights in \*\*lb\*\*/)
    expect(md).toContain('## What this is and how to read it')
    expect(md).toContain('counts the load twice')
  })

  it('writes sessions as plain sentences a model can read', () => {
    expect(md).toContain('### 2026-09-22 (Tue) — Leg <day>')
    expect(md).toContain('- Squat: 215 lb × 5, 3, – (target 3×5)')
    expect(md).toContain('- DB / Press: 40 lb per side × 8, 8, 8 (target 3×8)')
    expect(md).toContain('- Pull-ups: bodyweight × 10, 9, 8 (target 3×8)')
    expect(md).toContain('- Notes: felt strong new belt')
  })

  it('keeps tables intact when names contain pipes', () => {
    const cols = (l: string) => l.split('|').length
    for (const block of md.split('\n\n').filter(b => b.startsWith('|'))) {
      const rows = block.split('\n')
      for (const r of rows) expect(cols(r)).toBe(cols(rows[0]))
    }
    expect(md).toContain('### DB / Press')
    expect(md).toContain('Best weight **215 lb** (2026-09-22); best estimated 1RM **250.8 lb**')
    expect(md).toContain('Most reps in one set **10** (2026-09-22)')
  })

  it('says when a comparison has no baseline', () => {
    expect(md).toContain('| Workouts | 1 | 0 | n/a |')
  })

  it('labels a phone-built report as coming from the app', () => {
    const local = renderMarkdown(buildReport(data, { ...opts, syncedAt: null }))
    expect(local).toContain('(copied straight from the app)')
  })

  it('renders the demo history without gaps', () => {
    const demo = renderMarkdown(buildReport(demoData(), { ...opts, now: new Date(), weeks: 12 }))
    expect(demo).not.toMatch(/undefined|NaN|\[object/)
    expect(demo.match(/^### /gm)!.length).toBeGreaterThan(15)
  })
})

describe('markdownToHtml', () => {
  const html = markdownToHtml(renderMarkdown(buildReport(data, opts)))

  it('is a complete, script-free HTML page', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>Workout progress report</title>')
    expect(html).not.toMatch(/<script/i)
  })

  it('escapes user text', () => {
    expect(html).toContain('Leg &lt;day&gt;')
    expect(html).not.toContain('Leg <day>')
  })

  it('turns headings, lists, tables and links into real HTML', () => {
    expect(html).toContain('<h1>Workout progress report</h1>')
    expect(html).toContain('<h2>Weekly totals</h2>')
    expect(html).toMatch(/<table><thead><tr><th>Week of<\/th>/)
    expect(html).toContain('<li>Squat: 215 lb × 5, 3, – (target 3×5)</li>')
    expect(html).toContain('<strong>215 lb</strong>')
    expect(html).toContain('<a href="https://w.test/api/progress?view=export">')
    expect(html).not.toMatch(/\*\*|^\| /m)
  })
})
