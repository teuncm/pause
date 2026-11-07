import { describe, expect, it } from 'vitest'
import { createClock, formatTime } from './clock.js'

describe('meditation clock', () => {
  it('finishes a timer even when the browser delays updates', () => {
    let now = 0
    const clock = createClock(60_000, () => now)
    clock.resume()
    now = 23_100
    expect(clock.read()).toEqual({ elapsed: 23_100, complete: false })
    now = 95_000
    expect(clock.read()).toEqual({ elapsed: 60_000, complete: true })
  })

  it('excludes paused time and tolerates repeated resume calls', () => {
    let now = 0
    const clock = createClock(60_000, () => now)
    clock.resume()
    now = 10_000
    clock.pause()
    now = 100_000
    expect(clock.read().elapsed).toBe(10_000)
    clock.resume()
    now = 110_000
    clock.resume()
    now = 115_000
    expect(clock.read()).toEqual({ elapsed: 25_000, complete: false })
  })

  it('keeps timeless mode running beyond a day', () => {
    let now = 0
    const clock = createClock(null, () => now)
    clock.resume()
    now = 90_061_000
    expect(clock.read()).toEqual({ elapsed: 90_061_000, complete: false })
    expect(formatTime(clock.read().elapsed)).toBe('25:01:01')
  })

  it('rounds a countdown up and elapsed time down', () => {
    expect(formatTime(59_999, true)).toBe('01:00')
    expect(formatTime(59_999)).toBe('00:59')
    expect(formatTime(0, true)).toBe('00:00')
    expect(formatTime(-1)).toBe('00:00')
    expect(formatTime(3_600_000)).toBe('1:00:00')
  })
})
