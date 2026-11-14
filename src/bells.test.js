import { describe, expect, it, vi } from 'vitest'
import { BELL_SOUNDS, createBellPlayer, scheduleBell } from './bells.js'
import { generateBellTimbre } from './bell-timbre.js'

function audioContext() {
  const oscillators = []
  const gains = []
  const effects = []
  const context = {
    currentTime: 0,
    state: 'suspended',
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running'
    }),
    close: vi.fn(async () => {
      context.state = 'closed'
    }),
    createOscillator() {
      const oscillator = {
        frequency: {
          setValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }
      oscillators.push(oscillator)
      return oscillator
    },
    createGain() {
      const gain = {
        gain: {
          value: 0.1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }
      gains.push(gain)
      return gain
    },
    createDelay() {
      const node = { delayTime: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
      effects.push(node)
      return node
    },
    createStereoPanner() {
      const node = { pan: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
      effects.push(node)
      return node
    },
  }
  return {
    context,
    oscillators,
    gains,
    effects,
    starts: () =>
      oscillators
        .filter((o) => o.frequency.setValueAtTime.mock.calls[0][0] > 1)
        .filter((_, i) => i % 4 === 0)
        .map((o) => o.start.mock.calls[0][0]),
  }
}

describe('interval bells', () => {
  it('sustains preview partials without decay or retriggering, including after their normal lifetimes', () => {
    const audio = audioContext()
    const sound = generateBellTimbre({ x: 0.2, y: 0.4 })
    const bell = scheduleBell(audio.context, 0, sound, { sustain: true })
    for (const oscillator of audio.oscillators) expect(oscillator.stop).not.toHaveBeenCalled()
    for (const gain of audio.gains)
      expect(gain.gain.exponentialRampToValueAtTime).not.toHaveBeenCalled()
    const count = audio.oscillators.length
    audio.context.currentTime = 60
    const next = generateBellTimbre({ x: 0.8, y: 0.7 })
    bell.update(next)
    expect(audio.oscillators).toHaveLength(count)
    const partials = audio.oscillators.filter((o) => o.frequency.setTargetAtTime.mock.calls.length)
    expect(partials).toHaveLength(next.partials.length)
    for (const [index, oscillator] of partials.entries()) {
      expect(oscillator.frequency.setTargetAtTime.mock.calls[0][0]).toBe(next.partials[index][0])
      const gain = oscillator.connect.mock.calls[0][0].gain
      expect(gain.setTargetAtTime.mock.calls[0][0]).toBe(next.partials[index][1])
      expect(gain.exponentialRampToValueAtTime).not.toHaveBeenCalled()
    }
    bell.stop(0.1)
    for (const oscillator of audio.oscillators) {
      expect(oscillator.stop).toHaveBeenCalledOnce()
      oscillator.onended()
    }
    expect(bell.ended).toBe(true)
  })
  it('uses a generated spectrum for session bells and morphs a ringing custom bell', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    const sound = generateBellTimbre({ x: 0.2, y: 0.4 })
    await player.prepare()
    player.begin({
      intervalMs: null,
      durationMs: 60_000,
      soundId: sound,
      startBell: true,
      endBell: true,
    })
    const partials = audio.oscillators.filter(
      (o) => o.frequency.setValueAtTime.mock.calls[0][0] > 1,
    )
    expect(partials.map((o) => o.frequency.setValueAtTime.mock.calls[0][0])).toEqual([
      ...sound.partials.map(([hz]) => hz),
      ...sound.partials.map(([hz]) => hz),
    ])
    const ringing = scheduleBell(audio.context, 0, sound)
    audio.context.currentTime = 1
    const next = generateBellTimbre({ x: 0.3, y: 0.5 })
    ringing.update(next)
    const morphing = audio.oscillators
      .slice(-8)
      .filter((o) => o.frequency.setTargetAtTime.mock.calls.length)
    expect(morphing.map((o) => o.frequency.setTargetAtTime.mock.calls[0][0])).toEqual(
      next.partials.map(([hz]) => hz),
    )
    ringing.stop()
    await player.close()
  })
  it('aligns start, interval, and end bells to the shared transport start time', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({
      intervalMs: 60_000,
      durationMs: 120_000,
      startBell: true,
      endBell: true,
      startTime: 0.1,
    })
    expect(audio.starts().sort((a, b) => a - b)).toEqual([0.1 + 0.02, 60.1, 120.1])
    await player.close({ closeContext: false })
    expect(audio.context.close).not.toHaveBeenCalled()
  })

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'never repeats with start=%s and end=%s while preserving boundary bells',
    async (startBell, endBell) => {
      const audio = audioContext()
      const player = createBellPlayer(() => audio.context)
      await player.prepare()
      player.begin({ intervalMs: null, durationMs: 180_000, startBell, endBell })
      const expected = [...(startBell ? [0.02] : []), ...(endBell ? [180] : [])]
      expect(audio.starts()).toEqual(expected)
      for (const seconds of [60, 120, 179]) {
        audio.context.currentTime = seconds
        player.sync(seconds * 1000)
        expect(audio.starts()).toEqual(expected)
      }
      audio.context.currentTime = 180
      player.finish()
      expect(audio.starts()).toEqual(expected)
    },
  )

  it('keeps repeat disabled through pause, resume, and clock re-alignment', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: null, durationMs: 180_000, endBell: true })
    audio.context.currentTime = 30
    player.stop()
    audio.context.currentTime = 300
    player.begin({ intervalMs: null, durationMs: 180_000, elapsedMs: 30_000, endBell: true })
    expect(audio.starts()).toEqual([180, 450])
    audio.context.currentTime = 320
    player.sync(100_000)
    expect(audio.starts()).toEqual([180, 450, 400])
  })

  it('never repeats in timeless mode but still plays the manual end bell', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: null, startBell: true, endBell: true })
    audio.context.currentTime = 7200
    player.sync(7_200_000)
    expect(audio.starts()).toEqual([0.02])
    player.finish({ manual: true })
    expect(audio.starts()).toEqual([0.02, 7200.02])
  })

  it.each(BELL_SOUNDS.slice(5))(
    'plays $label as a single sustained strike without a note sequence',
    (sound) => {
      const audio = audioContext()
      scheduleBell(audio.context, 2, sound.id)
      const partials = audio.oscillators.filter(
        (node) => node.frequency.setValueAtTime.mock.calls[0][0] > 1,
      )
      for (const oscillator of partials) {
        expect(oscillator.start).toHaveBeenCalledExactlyOnceWith(2)
        expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledOnce()
        const envelope = oscillator.connect.mock.calls[0][0].gain
        expect(envelope.linearRampToValueAtTime).toHaveBeenCalledOnce()
        expect(envelope.exponentialRampToValueAtTime).toHaveBeenCalledOnce()
        expect(envelope.linearRampToValueAtTime.mock.calls[0][1]).toBeGreaterThanOrEqual(2.3)
        expect(oscillator.stop.mock.calls[0][0]).toBeGreaterThan(6)
      }
    },
  )

  it.each(BELL_SOUNDS)(
    'uses $label for preview, session bells, resume, and manual end',
    async (sound) => {
      const audio = audioContext()
      const player = createBellPlayer(() => audio.context)
      const fundamentals = () =>
        audio.oscillators
          .filter((node) => node.frequency.setValueAtTime.mock.calls[0][0] > 1)
          .filter((_, index) => index % 4 === 0)
          .map((node) => node.frequency.setValueAtTime.mock.calls[0][0])
      await player.prepare()
      player.preview(sound.id)
      expect(fundamentals()).toEqual([sound.partials[0][0]])
      player.begin({
        intervalMs: 60_000,
        durationMs: 180_000,
        startBell: true,
        endBell: true,
        soundId: sound.id,
      })
      expect(fundamentals()).toHaveLength(5)
      audio.context.currentTime = 30
      player.stop()
      audio.context.currentTime = 300
      player.begin({
        intervalMs: 60_000,
        durationMs: 180_000,
        elapsedMs: 30_000,
        endBell: true,
        soundId: sound.id,
      })
      expect(fundamentals()).toHaveLength(8)
      player.finish({ manual: true })
      expect(fundamentals()).toHaveLength(9)
      expect(fundamentals().every((frequency) => frequency === sound.partials[0][0])).toBe(true)
    },
  )

  it.each(BELL_SOUNDS.slice(1))('cleans up all $label audio nodes after decay', (sound) => {
    const audio = audioContext()
    const bell = scheduleBell(audio.context, 1, sound.id)
    expect(bell.ended).toBe(false)
    for (const oscillator of audio.oscillators) oscillator.onended()
    expect(bell.ended).toBe(true)
    for (const node of [...audio.oscillators, ...audio.gains, ...audio.effects])
      expect(node.disconnect).toHaveBeenCalledOnce()
  })

  it('creates and resumes audio only on demand, and schedules precise interval boundaries', async () => {
    const audio = audioContext()
    const factory = vi.fn(() => audio.context)
    const player = createBellPlayer(factory)
    expect(factory).not.toHaveBeenCalled()
    await player.prepare()
    expect(audio.context.resume).toHaveBeenCalledOnce()
    player.begin({ intervalMs: 60_000, durationMs: 180_000 })
    expect(audio.starts()).toEqual([60, 120])
    audio.context.currentTime = 60
    player.sync(60_000)
    expect(audio.starts()).toEqual([60, 120])
    audio.context.currentTime = 120
    player.sync(120_000)
    expect(audio.starts()).toEqual([60, 120])
  })

  it('cancels pending sounds on pause and preserves time until the next bell on resume', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000 })
    audio.context.currentTime = 30
    player.stop()
    for (const oscillator of audio.oscillators) {
      const isModulator = oscillator.frequency.setValueAtTime.mock.calls[0][0] < 1
      expect(oscillator.stop).toHaveBeenLastCalledWith(isModulator ? 30.06 : 30.02)
    }
    audio.context.currentTime = 300
    await player.prepare()
    player.begin({ intervalMs: 60_000, elapsedMs: 30_000 })
    expect(audio.starts()).toEqual([60, 120, 330, 390])
  })

  it('skips missed intervals after a delayed update without a catch-up burst', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000 })
    audio.context.currentTime = 250
    player.sync(250_000)
    expect(audio.starts()).toEqual([60, 120, 300, 360])
  })

  it('re-aligns to active session time after the audio clock falls behind', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000 })
    audio.context.currentTime = 20
    player.sync(250_000)
    expect(audio.starts()).toEqual([60, 120, 70, 130])
    expect(audio.oscillators[2].stop).toHaveBeenLastCalledWith(20.02)
  })

  it('lets a bell at timer completion decay and schedules no later bells', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000, durationMs: 60_000, endBell: true })
    const stops = audio.oscillators.map((o) => o.stop.mock.calls.length)
    audio.context.currentTime = 60
    player.finish()
    player.sync(120_000)
    expect(audio.starts()).toEqual([60])
    expect(audio.oscillators.map((o) => o.stop.mock.calls.length)).toEqual(stops)
  })

  it('keeps the next interval when clocks diverge before the first bell', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000 })
    audio.context.currentTime = 1
    player.sync(10_000)
    expect(audio.starts()).toEqual([60, 120, 51, 111])
  })

  it('schedules no interval bells when the timer is shorter than the interval', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 300_000, durationMs: 60_000 })
    expect(audio.starts()).toEqual([])
  })

  it('reports interruption and closes the context with pending sounds cancelled', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000 })
    audio.context.state = 'suspended'
    expect(() => player.sync(1_000)).toThrow('interrupted')
    await player.close()
    expect(audio.context.close).toHaveBeenCalledOnce()
    await expect(player.prepare()).rejects.toThrow('closed')
  })

  it('disconnects oscillators and gains after the bell finishes', () => {
    const audio = audioContext()
    const bell = scheduleBell(audio.context, 1)
    expect(bell.ended).toBe(false)
    for (const oscillator of audio.oscillators) oscillator.onended()
    expect(bell.ended).toBe(true)
    for (const gain of audio.gains) expect(gain.disconnect).toHaveBeenCalledOnce()
    for (const effect of audio.effects) expect(effect.disconnect).toHaveBeenCalledOnce()
  })

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('honors start=%s and end=%s independently', async (startBell, endBell) => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000, durationMs: 60_000, startBell, endBell })
    const expected = [...(startBell ? [0.02] : []), ...(endBell ? [60] : [])]
    expect(audio.starts()).toEqual(expected)
    audio.context.currentTime = 60
    player.finish()
    player.finish()
    expect(audio.starts()).toEqual(expected)
  })

  it.each([false, true])(
    'honors end=%s for manual end in timeless mode and rings at most once',
    async (endBell) => {
      const audio = audioContext()
      const player = createBellPlayer(() => audio.context)
      await player.prepare()
      player.begin({ intervalMs: 60_000, endBell })
      audio.context.currentTime = 15
      player.finish({ manual: true })
      player.finish({ manual: true })
      expect(audio.starts()).toEqual(endBell ? [60, 120, 15.02] : [60, 120])
      for (const oscillator of audio.oscillators.slice(0, 12)) {
        const modulator = oscillator.frequency.setValueAtTime.mock.calls[0][0] < 1
        expect(oscillator.stop).toHaveBeenLastCalledWith(modulator ? 15.06 : 15.02)
      }
    },
  )

  it('reschedules the end bell after a pause without repeating the start bell', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 60_000, durationMs: 120_000, startBell: true, endBell: true })
    audio.context.currentTime = 30
    player.stop()
    const beforeResume = audio.starts().length
    audio.context.currentTime = 300
    player.begin({ intervalMs: 60_000, durationMs: 120_000, elapsedMs: 30_000, endBell: true })
    expect(
      audio
        .starts()
        .slice(beforeResume)
        .sort((a, b) => a - b),
    ).toEqual([330, 390])
  })

  it('plays one end bell now instead of leaving a stale future end bell scheduled', async () => {
    const audio = audioContext()
    const player = createBellPlayer(() => audio.context)
    await player.prepare()
    player.begin({ intervalMs: 300_000, durationMs: 60_000, endBell: true })
    audio.context.currentTime = 20
    player.finish()
    player.finish()
    expect(audio.starts()).toEqual([60, 20.02])
  })
})
