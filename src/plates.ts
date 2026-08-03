import { ExerciseType, PlateInv } from './types'

// Barbells and EZ bars load symmetrically, so the smallest real jump is a whole
// pair of plates — they move in full steps (5 lb by default). Dumbbells, cables
// and hung weight move one increment at a time, so they can do half steps.
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

export interface PlateResult {
  perSide: number[] // plate weights for ONE side, heaviest first
  achieved: number // total weight actually loadable (bar + 2 * side)
  exact: boolean
}

// Greedy loadout: biggest plates first, limited by how many pairs the user owns.
export function calcPlates(total: number, bar: number, inventory: PlateInv[]): PlateResult {
  const perSideTarget = (total - bar) / 2
  const sorted = [...inventory]
    .filter(p => p.weight > 0 && p.pairs > 0)
    .sort((a, b) => b.weight - a.weight)

  const perSide: number[] = []
  let remaining = perSideTarget
  for (const p of sorted) {
    let count = 0
    while (count < p.pairs && p.weight <= remaining + 1e-9) {
      perSide.push(p.weight)
      remaining -= p.weight
      count++
    }
  }
  const sideSum = perSide.reduce((a, b) => a + b, 0)
  const achieved = bar + sideSum * 2
  return { perSide, achieved, exact: Math.abs(achieved - total) < 1e-9 }
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
