import { describe, expect, it } from 'vitest'
import { generateBellTimbre } from './bell-timbre.js'
import { BELL_TIMBRE } from './constants.js'

describe('XY bell spectrum', () => {
  it('reproduces exactly the same spectrum at the same coordinates', () => {
    expect(generateBellTimbre({ x: 0.31, y: 0.72 })).toEqual(
      generateBellTimbre({ x: 0.31, y: 0.72 }),
    )
    expect(generateBellTimbre({ x: 0.31, y: 0.72 })).not.toEqual(
      generateBellTimbre({ x: 0.32, y: 0.72 }),
    )
  })
  it('stays continuous across random lattice boundaries in both axes', () => {
    for (const axis of ['x', 'y'])
      for (let i = 1; i < 6; i++) {
        const a = generateBellTimbre({ x: 0.42, y: 0.42, [axis]: i / 6 - 0.00001 })
        const b = generateBellTimbre({ x: 0.42, y: 0.42, [axis]: i / 6 + 0.00001 })
        for (let p = 0; p < a.partials.length; p++)
          for (let k = 0; k < 3; k++) {
            expect(Math.abs(a.partials[p][k] / b.partials[p][k] - 1)).toBeLessThan(0.001)
          }
        expect(Math.abs(a.attack - b.attack)).toBeLessThan(0.001)
      }
  })
  it('keeps the spectrum, gain, and envelopes bounded across the pad', () => {
    for (let x = 0; x <= 1; x += 0.05)
      for (let y = 0; y <= 1; y += 0.05) {
        const sound = generateBellTimbre({ x, y })
        expect(sound.partials).toHaveLength(BELL_TIMBRE.ratios.length)
        expect(sound.partials.reduce((sum, [, gain]) => sum + gain, 0)).toBeCloseTo(
          BELL_TIMBRE.totalGain,
          10,
        )
        for (const [hz, gain, decay] of sound.partials) {
          expect(hz).toBeGreaterThan(50)
          expect(hz).toBeLessThan(3000)
          expect(gain).toBeGreaterThan(0)
          expect(decay).toBeGreaterThan(sound.attack)
          expect(decay).toBeLessThanOrEqual(
            BELL_TIMBRE.minDecaySeconds + BELL_TIMBRE.decayRangeSeconds,
          )
        }
      }
  })
  it('clamps out-of-range coordinates and handles invalid input', () => {
    expect(generateBellTimbre({ x: -1, y: 2 })).toEqual(generateBellTimbre({ x: 0, y: 1 }))
    expect(generateBellTimbre({ x: NaN, y: Infinity })).toEqual(generateBellTimbre({ x: 0, y: 0 }))
  })
})
