// The progress report as plain Markdown: what /progress shows, what
// /progress.txt returns, and what the app copies for pasting into a chat.
// Prose and tables rather than JSON, because that is what chat assistants read
// most reliably.
import type { buildReport } from './report.js'

type Report = ReturnType<typeof buildReport>

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function day(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${date} (${WEEKDAYS[wd]})`
}

const num = (n: number) => n.toLocaleString('en-US')

// Table cells and headings must stay on one line and not break the pipe grid.
const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim()

const pct = (p: number | null) => (p === null ? 'n/a' : `${p > 0 ? '+' : ''}${p}%`)

const reps = (r: (number | null)[]) => r.map(v => (v === null ? '–' : String(v))).join(', ')

function muscles(m: Partial<Record<string, number>>): string {
  const parts = Object.entries(m)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, n]) => `${k} ${n}`)
  return parts.length ? parts.join(', ') : '—'
}

function table(head: string[], rows: (string | number)[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${r.map(c => cell(String(c))).join(' | ')} |`),
  ].join('\n')
}

export function renderMarkdown(r: Report): string {
  const u = r.unit
  const o = r.overview
  const out: string[] = []

  out.push('# Workout progress report')
  out.push(
    r.lastSyncedAt
      ? `Data as of **${r.lastSyncedAt.slice(0, 16).replace('T', ' ')} UTC** (last sync from the owner's phone). Weights in **${u}**.`
      : `Data as of **${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC** (copied straight from the app). Weights in **${u}**.`
  )

  out.push('## What this is and how to read it')
  out.push(r.about.what)
  out.push(r.about.howToRead.map(l => `- ${l}`).join('\n'))

  out.push('## Overview')
  out.push(
    [
      `- Workouts logged: **${o.totalSessions}**` +
        (o.firstSession ? ` (first ${day(o.firstSession)}, most recent ${day(o.lastSession!)})` : ''),
      o.daysSinceLastSession !== null ? `- Days since last workout: **${o.daysSinceLastSession}**` : null,
      `- Workouts in the last 7 days: **${o.sessionsLast7Days}**, last 28 days: **${o.sessionsLast28Days}**`,
      `- Average workouts per week over the last 12 weeks: **${o.avgSessionsPerWeekLast12Weeks}**`,
      `- Exercises in the library: ${o.exercisesInLibrary}`,
    ]
      .filter(Boolean)
      .join('\n')
  )

  const t = r.trend
  out.push('## Last 28 days vs the 28 days before')
  out.push(
    table(
      ['', 'Last 28 days', 'Previous 28 days', 'Change'],
      [
        ['Workouts', t.current.sessions, t.previous.sessions, pct(t.changePct.sessions)],
        ['Sets', t.current.sets, t.previous.sets, pct(t.changePct.sets)],
        ['Reps', num(t.current.reps), num(t.previous.reps), pct(t.changePct.reps)],
        [`Volume (${u})`, num(t.current.volume), num(t.previous.volume), pct(t.changePct.volume)],
      ]
    )
  )
  out.push(
    `Sets by muscle group, last 28 days: ${muscles(t.setsByMuscleGroup.current)}.\n` +
      `Previous 28 days: ${muscles(t.setsByMuscleGroup.previous)}.`
  )

  out.push('## Weekly totals')
  out.push('Weeks start on Monday. The last row is the current, unfinished week.')
  out.push(
    table(
      ['Week of', 'Workouts', 'Sets', 'Reps', `Volume (${u})`, 'Sets by muscle group'],
      r.weekly.map(w => [
        w.weekOf + ('inProgress' in w ? ' (this week)' : ''),
        w.sessions,
        w.sets,
        num(w.reps),
        num(w.volume),
        muscles(w.setsByMuscleGroup),
      ])
    )
  )

  out.push('## Exercises')
  out.push('Most recently trained first. Recent logs are newest first.')
  if (r.exercises.length === 0) out.push('No exercises logged yet.')
  for (const ex of r.exercises) {
    const b = ex.best
    const bests =
      'weight' in b
        ? `Best weight **${b.weight} ${u}** (${b.weightDate}); best estimated 1RM **${b.estimated1RM} ${u}** (${b.estimated1RMDate}); most reps in one set ${b.mostRepsInOneSet} (${b.mostRepsDate}).`
        : `Most reps in one set **${b.mostRepsInOneSet}** (${b.mostRepsDate}).`
    out.push(`### ${cell(ex.name)}`)
    out.push(
      `${ex.muscleGroup} · ${ex.equipment} · weight means ${ex.weightMeans}. ` +
        `Logged ${ex.timesLogged} time${ex.timesLogged === 1 ? '' : 's'}, ${ex.firstLogged} to ${ex.lastLogged}. ${bests}`
    )
    const weighted = 'weight' in b
    out.push(
      table(
        ['Date', `Weight (${u})`, 'Reps per set', 'Target', ...(weighted ? [`Est. 1RM (${u})`] : []), `Volume (${u})`],
        ex.recent.map(l => [
          day(l.date),
          l.weight,
          reps(l.reps),
          l.target,
          ...(weighted ? [('estimated1RM' in l ? l.estimated1RM : '') as string | number] : []),
          num(l.volume),
        ])
      )
    )
  }

  const describe = (s: Report['recentSessions'][number] | NonNullable<Report['workoutInProgress']>) => {
    const lines = s.exercises.map(
      e =>
        `- ${cell(e.name)}: ${e.weight > 0 ? `${e.weight} ${u}${'perSide' in e ? ' per side' : ''}` : 'bodyweight'} × ${reps(e.reps)} (target ${e.target})`
    )
    if (lines.length === 0) lines.push('- (nothing logged)')
    if (s.notes) lines.push(`- Notes: ${cell(s.notes)}`)
    return lines.join('\n')
  }

  out.push('## Recent workouts')
  out.push('Newest first.')
  if (r.recentSessions.length === 0) out.push('No finished workouts yet.')
  for (const s of r.recentSessions) {
    out.push(
      `### ${day(s.date)} — ${cell(s.workout)}\n` +
        `${s.totals.sets} sets, ${num(s.totals.reps)} reps, ${num(s.totals.volume)} ${u} volume.\n\n` +
        describe(s)
    )
  }

  if (r.workoutInProgress) {
    out.push('## Workout in progress (not counted above)')
    out.push(`### ${day(r.workoutInProgress.date)} — ${cell(r.workoutInProgress.workout)}\n\n` + describe(r.workoutInProgress))
  }

  out.push('## More data')
  out.push(
    [
      `- More history: ${r.about.endpoints.moreHistory}`,
      `- This report as JSON: ${r.about.endpoints.report}`,
      `- Raw backup file: ${r.about.endpoints.rawExport}`,
    ].join('\n')
  )

  return out.join('\n\n') + '\n'
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Inline Markdown in our own output: **bold** and bare links.
function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/https?:\/\/[^\s<>()]+[^\s<>().,;:]/g, u => `<a href="${u}">${u}</a>`)
}

// Just enough Markdown → HTML for renderMarkdown's output (headings, lists,
// tables, paragraphs), so the page is plain semantic HTML with no scripts.
export function markdownToHtml(md: string): string {
  const body: string[] = []
  for (const block of md.trim().split(/\n{2,}/)) {
    const lines = block.split('\n')
    const h = /^(#{1,3}) (.*)$/.exec(lines[0])
    if (h) {
      body.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
      if (lines.length > 1) body.push(`<p>${lines.slice(1).map(inline).join('<br>')}</p>`)
    } else if (lines.every(l => l.startsWith('|'))) {
      const rows = lines.filter(l => !/^\|(-{3}\|)+$/.test(l)).map(l => l.slice(2, -2).split(' | '))
      const [head, ...rest] = rows
      body.push(
        '<div class="scroll"><table><thead><tr>' +
          head.map(c => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rest.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>'
      )
    } else if (lines.every(l => l.startsWith('- '))) {
      body.push('<ul>' + lines.map(l => `<li>${inline(l.slice(2))}</li>`).join('') + '</ul>')
    } else {
      // A paragraph that may run straight into a list (session headers do).
      const firstItem = lines.findIndex(l => l.startsWith('- '))
      const para = firstItem === -1 ? lines : lines.slice(0, firstItem)
      if (para.length) body.push(`<p>${para.map(inline).join('<br>')}</p>`)
      if (firstItem !== -1) {
        body.push('<ul>' + lines.slice(firstItem).map(l => `<li>${inline(l.replace(/^- /, ''))}</li>`).join('') + '</ul>')
      }
    }
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workout progress report</title>
<meta name="description" content="Personal strength-training log: workouts, lifts, volume and trends.">
<style>
  :root { color-scheme: light dark; --fg: #1f2937; --bg: #ffffff; --line: #e5e7eb; --dim: #6b7280; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e5e7eb; --bg: #0f1115; --line: #2a2f3a; --dim: #9ca3af; } }
  body { font: 16px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--fg); background: var(--bg);
         max-width: 860px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.6em; margin: 0.4em 0; } h2 { margin-top: 1.8em; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  h3 { margin: 1.4em 0 0.3em; font-size: 1.05em; }
  .scroll { overflow-x: auto; } table { border-collapse: collapse; font-size: 14px; margin: 8px 0; }
  th, td { border: 1px solid var(--line); padding: 4px 8px; text-align: left; white-space: nowrap; }
  th { color: var(--dim); font-weight: 600; } a { color: inherit; word-break: break-all; }
  ul { padding-left: 1.2em; } li { margin: 2px 0; }
</style>
</head>
<body>
<main>
${body.join('\n')}
</main>
</body>
</html>
`
}
