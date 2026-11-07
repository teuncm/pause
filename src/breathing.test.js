import { describe, expect, it } from 'vitest'
import { getBreathingAnimation, getBreathingState, isValidBreathing } from './breathing.js'
import { createClock } from './clock.js'

const durations = { in: 4, inHold: 2, out: 6, outHold: 2 }

describe('breathing cycle', () => {
  it('tracks each phase and its remaining time through a complete cycle', () => {
    expect(getBreathingState(0, durations)).toMatchObject({
      key: 'in',
      secondsRemaining: 4,
      hold: false,
    })
    expect(getBreathingState(2000, durations).secondsRemaining).toBe(2)
    expect(getBreathingState(4500, durations)).toMatchObject({
      key: 'inHold',
      hold: true,
      nextUpdateMs: 500,
    })
    expect(getBreathingState(6000, durations)).toMatchObject({
      key: 'out',
      secondsRemaining: 6,
      hold: false,
    })
    expect(getBreathingState(9000, durations).secondsRemaining).toBe(3)
    expect(getBreathingState(12500, durations)).toMatchObject({
      key: 'outHold',
      hold: true,
    })
    expect(getBreathingState(14000, durations)).toEqual(getBreathingState(0, durations))
  })

  it('skips zero-duration holds without discontinuities or division by zero', () => {
    const noHolds = { ...durations, inHold: 0, outHold: 0 }
    expect(getBreathingState(4000, noHolds)).toMatchObject({ key: 'out', hold: false })
    expect(getBreathingState(10000, noHolds)).toMatchObject({ key: 'in', hold: false })
    const animation = getBreathingAnimation(noHolds)
    expect(animation.duration).toBe(10)
    expect(animation.scaleTimes).toEqual([0, 0.4, 0.4, 1, 1])
    expect(animation.glowValues.every((value) => value === 0)).toBe(true)
  })

  it('uses custom durations and catches up after long delays', () => {
    const custom = { in: 2, inHold: 1, out: 3, outHold: 1 }
    expect(getBreathingState(2000, custom).key).toBe('inHold')
    expect(getBreathingState(3000, custom).key).toBe('out')
    expect(getBreathingState(6000, custom).key).toBe('outHold')
    expect(getBreathingState(7 * 1000 * 123456 + 3500, custom)).toEqual(
      getBreathingState(3500, custom),
    )
  })

  it('freezes with the session clock and resumes from the same phase position', () => {
    let now = 0
    const clock = createClock(null, () => now)
    clock.resume()
    now = 1500
    clock.pause()
    const paused = getBreathingState(clock.read().elapsed, durations)
    now = 100_000
    expect(getBreathingState(clock.read().elapsed, durations)).toEqual(paused)
    clock.resume()
    now += 3000
    expect(getBreathingState(clock.read().elapsed, durations)).toMatchObject({
      key: 'inHold',
      hold: true,
    })
  })

  it('rejects empty, fractional, negative, or excessive values and zero-length breaths', () => {
    for (const [key, value] of [
      ['in', 0],
      ['out', 0],
      ['inHold', -1],
      ['outHold', 61],
      ['in', 1.5],
      ['inHold', ''],
    ]) {
      const invalid = { ...durations, [key]: value }
      expect(isValidBreathing(invalid)).toBe(false)
      expect(getBreathingState(0, invalid)).toBeNull()
      expect(getBreathingAnimation(invalid)).toBeNull()
    }
    expect(isValidBreathing({ in: 60, inHold: 0, out: 60, outHold: 0 })).toBe(true)
  })
})
