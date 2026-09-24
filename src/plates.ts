import { ExerciseType, PlateInv } from './types'

// Barbells and EZ bars load symmetrically, so the smallest real jump is a whole
// pair of plates — they move in full steps (5 lb by default). Dumbbells, cables,
// landmines (plates go on one sleeve) and hung weight move one increment at a
// time, so they can do half steps.
export function weightStepFor(type: ExerciseType | undefined, step: number): number {
  return type === 'barbell' || type === 'ezbar' ? step : step / 2
}

// Next weight up/down, snapped to the step grid. Bar exercises are gridded from
// the empty bar (45 → 50 → 55), everything else from zero.
export function nextWeight(current: number, dir: 1 | -1, step: number, min: number): number {
  const n = (current - min) / step
  const steps = dir > 0 ? Math.floor(n + 1e-6) + 1 : Math.ceil(n - 1e-6) - 1
  const w = Math.round((min + steps * step) * 100) / 100
  return Math.max(min, w)
}

// Where the plates go. A bar loads both sleeves with half the plates each. A
// landmine sleeve or a plate-loaded cable pin takes the whole load on one
// side, with no bar weight counted, since those exercises are logged from zero.
export type LoadStyle = 'bar' | 'sleeve' | 'pin'

export function loadStyleFor(type: ExerciseType | undefined): LoadStyle | null {
  if (type === 'barbell' || type === 'ezbar') return 'bar'
  if (type === 'landmine') return 'sleeve'
  if (type === 'cable') return 'pin'
  return null
}

export interface PlateResult {
  side: number[] // plates on ONE side (the only side for a sleeve or pin), heaviest first
  achieved: number // total weight actually loadable: bar + side × sides
  exact: boolean
}

// Greedy loadout: biggest plates first, limited by the plates you own. A bar
// needs plates in matched pairs; loading a single side can use every plate.
export function calcPlates(total: number, bar: number, inventory: PlateInv[], sides: 1 | 2 = 2): PlateResult {
  const sideTarget = (total - bar) / sides
  const sorted = [...inventory]
    .filter(p => p.weight > 0 && p.pairs > 0)
    .sort((a, b) => b.weight - a.weight)

  const side: number[] = []
  let remaining = sideTarget
  for (const p of sorted) {
    const available = sides === 2 ? p.pairs : p.pairs * 2
    let count = 0
    while (count < available && p.weight <= remaining + 1e-9) {
      side.push(p.weight)
      remaining -= p.weight
      count++
    }
  }
  const sideSum = side.reduce((a, b) => a + b, 0)
  const achieved = Math.round((bar + sideSum * sides) * 100) / 100
  return { side, achieved, exact: Math.abs(achieved - total) < 1e-9 }
}

export function plateColor(w: number): string {
  if (w >= 45) return '#3b82f6' // blue
  if (w >= 35) return '#eab308' // yellow
  if (w >= 25) return '#22c55e' // green
  if (w >= 10) return '#e5e7eb' // white
  if (w >= 5) return '#ef4444' // red
  return '#94a3b8' // small change plates
}

export function plateHeight(w: number): number {
  // px height for the visual, clamped so tiny plates stay readable
  if (w >= 45) return 64
  if (w >= 35) return 56
  if (w >= 25) return 48
  if (w >= 10) return 38
  if (w >= 5) return 32
  return 26
}
