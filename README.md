# Workout Tracker

A personal strength-training PWA. Local-first: **all data lives in your browser's localStorage** — there is no server, no account, no shared database. Live at https://workout-tracker-livid-five.vercel.app

- Saved Workouts (templates) + freeform sessions (add exercises as you go)
- Rep circles: tap = log target reps, tap again = −1, long-press = +1, `＋` adds an extra set
- Per-side loading: dumbbells count double toward volume by default, and cable/machine exercises get a **Per side / Total** switch — 10 reps of a 30 lb dumbbell in each hand is 600 lb moved, not 300
- Landmine exercises, with a **Single arm / Dual arm** toggle; single-arm work counts double toward volume the same way
- Plate calculator based on the plates you actually own
- Rest timer with beep/vibration/notification on **every** expiry, survives reloads
- Progress → **Volume**: total weight moved / sets / reps per week or month, stacked by muscle group, with trend vs the previous period
- Progress → **By exercise**: top weight, estimated 1RM (Epley), volume, PR markers
- History: month-grouped past sessions, editable in place
- JSON export/import for backup and migration

## Install on your phone

- **iPhone**: open the URL in Safari → Share → **Add to Home Screen**. (Timer banner notifications need iOS 16.4+ and the installed app; the in-app timer and sound always work.)
- **Android**: open in Chrome → ⋮ menu → **Add to Home screen** → Install.

Because data is per-device, installing from the same URL on two phones gives two completely independent copies.

## Importing existing workout logs (for humans and AI agents)

The app imports a single JSON file via **Settings → ⬆ Import backup**. Importing **replaces all current data** (the app warns first). To convert logs from another app or spreadsheet, generate a file matching the schema below — the canonical type definitions are in [`src/types.ts`](src/types.ts) (`AppData` and friends).

### Backup file schema

```jsonc
{
  "exercises": [        // the exercise library
    {
      "id": "sq1",                  // any unique string; referenced by workouts & sessions
      "name": "Squat",
      "type": "barbell",            // "barbell" | "ezbar" | "dumbbell" | "cable" |
                                    // "landmine" | "calisthenics"
      "muscleGroup": "Legs",        // "Chest" | "Back" | "Shoulders" | "Biceps" | "Triceps" |
                                    // "Legs" | "Glutes" | "Core" | "Full Body"
      "goal": { "kind": "setsreps", "sets": 5, "reps": 5 },
      // or an interval goal:
      // "goal": { "kind": "interval", "activeSec": 45, "restSec": 30, "intervals": 3 },
      "perSide": false,             // optional; true = the logged weight is one limb's load,
                                    // so volume counts it twice. Only meaningful for
                                    // "dumbbell", "cable" and "landmine" (where the editor
                                    // calls it Single arm / Dual arm). Omitted → defaults to
                                    // true for "dumbbell", false for every other type.
      "pinned": false               // optional
    }
  ],
  "workouts": [         // Saved Workout templates (can be empty [])
    {
      "id": "w1",
      "name": "Leg Day",
      "exerciseIds": ["sq1"],       // must reference exercises[].id
      "pinned": false               // optional
    }
  ],
  "sessions": [         // the actual training history
    {
      "id": "s1",
      "workoutId": "w1",            // "" for freeform sessions with no template
      "workoutName": "Leg Day",     // snapshot; shown even if the template is deleted
      "date": "2026-07-20",         // YYYY-MM-DD (local date of the session)
      "startedAt": 1784998800000,   // epoch milliseconds; used for ordering
      "finished": true,             // true for all historical sessions
      "notes": "",
      "entries": [
        {
          "exerciseId": "sq1",      // must reference exercises[].id
          "goalKind": "setsreps",
          "weight": 185,            // total bar weight (or added weight for calisthenics); 0 = bodyweight
          "targetSets": 5,          // goal snapshot at the time of the session
          "targetReps": 5,
          "reps": [5, 5, 5, 4, null] // one slot per set: reps done, null = set not attempted;
                                     // may be longer than targetSets (extra sets)
        }
        // interval entries instead use:
        // { "exerciseId": "...", "goalKind": "interval", "weight": 0,
        //   "targetSets": 3, "targetReps": 1, "reps": [1, 1, 1],
        //   "intervalSpec": { "activeSec": 45, "restSec": 30, "intervals": 3 } }
      ]
    }
  ],
  "settings": {         // optional — anything missing is backfilled with defaults
    "barWeight": 45, "ezBarWeight": 25, "weightStep": 5,
    "defaultTimerSec": 90, "unit": "lb",   // "lb" | "kg"
    "plates": [ { "weight": 45, "pairs": 2 }, { "weight": 25, "pairs": 1 } ]
  }
}
```

### Rules an agent must follow

1. `exercises`, `workouts`, and `sessions` must all be present as arrays (empty is fine); the import validates this.
2. Every `entries[].exerciseId` and `workouts[].exerciseIds` entry must match an `exercises[].id`, or those rows render as "(deleted exercise)".
3. IDs just need to be unique strings — `"bench"`, `"ex-001"`, anything.
4. Progress charts read `weight` and `reps` per session, ordered by `startedAt` — so give historical sessions accurate dates and monotonically ordered `startedAt` values (midnight of the date is fine: `new Date("2026-07-20").getTime()`).
5. Weights are in whatever `settings.unit` says; the app does not convert.
6. A set that "hit the goal" is `reps[i] === targetReps`; partial sets are smaller numbers; skipped sets are `null`.
7. For single-arm work, `weight` is the load on **one** side and `reps` are the reps **per** side — set `perSide: true` and the app doubles the tonnage for you. Don't pre-double either number yourself.

Sanity-check a generated file by importing it and looking at the Progress and History tabs.

## Run it yourself / make your own version

Requires Node 18+.

```bash
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
```

To run your own copy: **fork this repo**, then deploy the fork to any static host. On Vercel it's zero-config — import the fork at [vercel.com/new](https://vercel.com/new) and every push to `main` deploys automatically. Or deploy from the command line:

```bash
npm i -g vercel
vercel deploy --prod
```

Your deployment is fully independent — your data, your URL, your edits. Pull upstream changes whenever you want the latest features. To move your training data between deployments, use **Settings → Export backup** on the old one and **Import backup** on the new one.

## Stack

React 18 + TypeScript + Vite + [vite-plugin-pwa](https://vite-pwa-org.netlify.app/). No backend, no analytics, no dependencies beyond React.
