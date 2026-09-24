import { describe, expect, it } from 'vitest'
import { calcPlates, loadStyleFor } from '../src/plates'
import { defaultSettings } from '../src/seed'

// 45×2, 35×1, 25×1, 10×2, 5×2, 2.5×1 pairs
const INV = defaultSettings().plates

describe('calcPlates on a bar (both sides)', () => {
  it('splits the load over two sleeves', () => {
    expect(calcPlates(225, 45, INV)).toEqual({ side: [45, 45], achieved: 225, exact: true })
    expect(calcPlates(185, 45, INV)).toEqual({ side: [45, 25], achieved: 185, exact: true })
  })

  it('is limited to the pairs you own', () => {
    // 45+45+35+25+10+10+5+5+2.5 per side = 182.5 max
    const r = calcPlates(500, 45, INV)
    expect(r.achieved).toBe(45 + 182.5 * 2)
    expect(r.exact).toBe(false)
  })
})

describe('calcPlates on one side (landmine sleeve, cable pin)', () => {
  it('puts the whole load on the one side', () => {
    expect(calcPlates(90, 0, INV, 1)).toEqual({ side: [45, 45], achieved: 90, exact: true })
    expect(calcPlates(70, 0, INV, 1)).toEqual({ side: [45, 25], achieved: 70, exact: true })
    expect(calcPlates(12.5, 0, INV, 1)).toEqual({ side: [10, 2.5], achieved: 12.5, exact: true })
  })

  it('can use both plates of every pair', () => {
    // Only one pair of 35s, but a single sleeve can take both.
    expect(calcPlates(70, 0, [{ weight: 35, pairs: 1 }], 1)).toEqual({ side: [35, 35], achieved: 70, exact: true })
    // A bar can't: one 35 per side.
    expect(calcPlates(70, 0, [{ weight: 35, pairs: 1 }], 2).side).toEqual([35])
    // 2 pairs of 45s = four plates on one sleeve.
    expect(calcPlates(180, 0, INV, 1).side).toEqual([45, 45, 45, 45])
  })

  it('reports the closest load when it cannot match', () => {
    expect(calcPlates(7, 0, INV, 1)).toEqual({ side: [5], achieved: 5, exact: false })
    expect(calcPlates(0, 0, INV, 1)).toEqual({ side: [], achieved: 0, exact: true })
  })
})

describe('loadStyleFor', () => {
  it('maps each exercise type', () => {
    expect(loadStyleFor('barbell')).toBe('bar')
    expect(loadStyleFor('ezbar')).toBe('bar')
    expect(loadStyleFor('landmine')).toBe('sleeve')
    expect(loadStyleFor('cable')).toBe('pin')
    expect(loadStyleFor('dumbbell')).toBeNull()
    expect(loadStyleFor('calisthenics')).toBeNull()
    expect(loadStyleFor(undefined)).toBeNull()
  })
})
