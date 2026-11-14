import { describe, expect, it, vi } from 'vitest'
import { createAudioTransport, scheduleSweep } from './audio-transport.js'
import { GUIDANCE_AUDIO, VOWEL_CHART } from './constants.js'
import { getVowelFormants } from './vowel.js'

vi.mock('tone', () => ({ getContext: vi.fn(), getTransport: vi.fn(), start: vi.fn() }))

function parameter() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    setValueCurveAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  }
}

function fixture() {
  const nodes = []
  const node = () => {
    const result = {
      gain: parameter(),
      frequency: parameter(),
      Q: parameter(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      connect: (target) => target,
    }
    nodes.push(result)
    return result
  }
  const context = {
    state: 'running',
    currentTime: 10,
    sampleRate: 100,
    destination: {},
    createGain: node,
    createBiquadFilter: node,
    createBufferSource: node,
    createBuffer: () => ({ getChannelData: () => new Float32Array(400) }),
  }
  const events = []
  const add = (callback, interval, at, duration) => {
    events.push({ callback, interval, at, duration })
    return events.length
  }
  const transport = {
    stop: vi.fn(),
    clear: vi.fn(),
    start: vi.fn(),
    scheduleRepeat: add,
    scheduleOnce: (callback, at) => add(callback, null, at),
    getSecondsAtTime: (time) => time - 10.1,
  }
  const close = vi.fn()
  const audio = createAudioTransport({
    start: async () => {},
    getTransport: () => transport,
    getContext: () => ({ rawContext: context, close }),
  })
  return { audio, context, events, nodes, transport, close }
}

function expectCurve(parameter, time, duration) {
  const [curve, at, length] = parameter.setValueCurveAtTime.mock.lastCall
  expect(at).toBe(time)
  expect(length).toBe(duration)
  expect(curve[0]).toBe(0)
  expect(curve.at(-1)).toBe(0)
  expect([...curve].every((value) => Number.isFinite(value) && value >= 0)).toBe(true)
  return curve
}

const breathing = { in: 4, inHold: 2, out: 6, outHold: 2 }

it('applies the three selected formants to Out and preserves In, including resume', async () => {
  const f = fixture(),
    vowel = { x: 0, y: 1 }
  await f.audio.prepare()
  f.audio.begin({ breathing, vowel })
  f.events[0].callback(10.1)
  f.events[1].callback(16.1)
  const formants = getVowelFormants(vowel)
  for (let i = 0; i < 3; i++) {
    expect(f.nodes[5 + i].frequency.setValueAtTime.mock.calls).toEqual([
      [GUIDANCE_AUDIO.inhale.filters[i].frequencyHz, 10.1],
      [formants[i], 16.1],
    ])
  }
  f.audio.stop()
  const before = f.nodes.length
  f.events.length = 0
  f.audio.begin({ breathing, vowel, elapsedMs: 9000 })
  f.events.find((event) => event.at === 9 && event.interval === null).callback(10.1)
  for (let i = 0; i < 3; i++) {
    const base = GUIDANCE_AUDIO.exhale.filters[i]
    expect(f.nodes[before + 5 + i].frequency.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(formants[i] * Math.sqrt(base.endFrequencyHz / base.frequencyHz), 7),
      10.1,
    )
  }
})

describe('breathing audio transport', () => {
  it('schedules only inhalation and exhalation, leaving both holds silent', async () => {
    const f = fixture()
    await f.audio.prepare()
    expect(f.audio.begin({ breathing })).toBe(10.1)
    expect(f.events.map(({ at, interval }) => [at, interval])).toEqual([
      [0, 14],
      [6, 14],
    ])
    expect(f.transport.start).toHaveBeenCalledWith(10.1, 0)
    expect(f.nodes[1].type).toBe('highpass')
    expect(f.nodes[1].frequency.value).toBe(500)
    expect(f.nodes[1].Q.value).toBe(Math.SQRT1_2)
    f.events[0].callback(10.1)
    f.events[1].callback(16.1)
    expect(f.nodes[2].frequency.setValueAtTime.mock.calls).toEqual([
      [800, 10.1],
      [VOWEL_CHART.lowPassMaxHz, 16.1],
    ])
    const curves = f.nodes[3].gain.setValueCurveAtTime.mock.calls
    expect(curves.map(([, time, duration]) => [time, duration])).toEqual([
      [10.1, 4],
      [16.1, 6],
    ])
    for (const [curve] of curves) {
      expect(curve[0]).toBe(0)
      expect(curve.at(-1)).toBe(0)
    }
    for (const [index, settings] of GUIDANCE_AUDIO.exhale.filters.entries()) {
      const peak = f.nodes[5 + index]
      expect(peak.type).toBe('peaking')
      const inhale = GUIDANCE_AUDIO.inhale.filters[index]
      expect(peak.frequency.setValueAtTime.mock.calls).toEqual([
        [inhale.frequencyHz, 10.1],
        [settings.frequencyHz, 16.1],
      ])
      expect(peak.frequency.exponentialRampToValueAtTime.mock.calls).toEqual([
        [inhale.endFrequencyHz ?? inhale.frequencyHz, 14.1],
        [settings.endFrequencyHz ?? settings.frequencyHz, 22.1],
      ])
      expect(peak.Q.setValueAtTime.mock.calls).toEqual([
        [inhale.q, 10.1],
        [settings.q, 16.1],
      ])
      expect(peak.gain.setValueAtTime.mock.calls).toEqual([
        [inhale.gainDb, 10.1],
        [settings.gainDb, 16.1],
      ])
    }
  })

  it('uses the audio clock for session time, excluding the scheduling lead-in', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin()
    expect(f.audio.now()).toBe(0)
    f.context.currentTime = 12.1
    expect(f.audio.now()).toBe(2000)
    f.audio.stop()
    f.context.currentTime = 25
    expect(f.audio.now()).toBe(2000)
    f.audio.begin({ elapsedMs: 2000 })
    f.context.currentTime = 26.1
    expect(f.audio.now()).toBe(3000)
  })

  it('resumes a partial inhale at its current cutoff with a fresh gentle attack', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing, elapsedMs: 2000 })
    expect(f.events.map(({ at }) => at)).toEqual([2, 14, 6])
    f.events[0].callback(10.1)
    expect(f.nodes[2].frequency.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(Math.sqrt(800 * 1200), 8),
      10.1,
    )
    const curve = expectCurve(f.nodes[3].gain, 10.1, 2)
    expect(Math.max(...curve)).toBeLessThanOrEqual(GUIDANCE_AUDIO.gain * 0.83)
  })

  it('resumes silently in a hold and schedules the next exhale', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing, elapsedMs: 5000 })
    expect(f.events.map(({ at }) => at)).toEqual([14, 6])
    expect(f.nodes[3].gain.value).toBe(0)
  })

  it('restores the mouth-breath peaks when resuming partway through Out', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing, elapsedMs: 9000 })
    const resumed = f.events.find(({ at, interval }) => at === 9 && interval === null)
    resumed.callback(10.1)
    for (const [index, settings] of GUIDANCE_AUDIO.exhale.filters.entries()) {
      const peak = f.nodes[5 + index]
      expect(peak.gain.setValueAtTime).toHaveBeenCalledWith(settings.gainDb, 10.1)
      expect(peak.frequency.setValueAtTime).toHaveBeenCalledWith(
        expect.closeTo(
          Math.sqrt(settings.frequencyHz * (settings.endFrequencyHz ?? settings.frequencyHz)),
          8,
        ),
        10.1,
      )
    }
    const curve = expectCurve(f.nodes[3].gain, 10.1, 3)
    const profile = GUIDANCE_AUDIO.exhale
    expect(Math.max(...curve)).toBeLessThanOrEqual(
      GUIDANCE_AUDIO.gain * profile.gainMultiplier * (profile.adsr.sustainLevel + 0.001),
    )
  })

  it('fades out at the session boundary even when it falls within a phase', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing, durationMs: 2000 })
    expect(f.events).toHaveLength(1)
    f.events[0].callback(10.1)
    expectCurve(f.nodes[3].gain, 10.1, 2)
    expect(f.nodes[2].frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(Math.sqrt(800 * 1200), 8),
      12.1,
    )
  })

  it('supports one-second phases with zero-length holds', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing: { in: 1, inHold: 0, out: 1, outHold: 0 } })
    expect(f.events.map(({ at, interval }) => [at, interval])).toEqual([
      [0, 2],
      [1, 2],
    ])
    f.events[0].callback(10.1)
    expectCurve(f.nodes[3].gain, 10.1, 1)
  })

  it('clears future transport events and fades queued audio when stopped', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing })
    f.context.currentTime = 11
    f.audio.stop()
    expect(f.transport.clear.mock.calls).toEqual([[1], [2]])
    expect(f.nodes[4].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 11.02)
    expect(f.nodes[0].stop).toHaveBeenCalledWith(11.025)
    f.nodes[0].onended()
    for (const node of f.nodes) expect(node.disconnect).toHaveBeenCalledOnce()
    await f.audio.close()
    expect(f.close).toHaveBeenCalledOnce()
    await expect(f.audio.prepare()).rejects.toThrow('closed')
  })
})

it('sweeps down throughout an exhale without making a second note or sound in a hold', () => {
  const graph = { filter: { frequency: parameter() }, peaks: [], envelope: { gain: parameter() } }
  scheduleSweep(graph, 5, 6, 0, 6, false)
  expect(graph.filter.frequency.setValueAtTime).toHaveBeenCalledWith(VOWEL_CHART.lowPassMaxHz, 5)
  expect(graph.filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(
    VOWEL_CHART.lowPassMinHz,
    11,
  )
  expectCurve(graph.envelope.gain, 5, 6)
})

it.each([true, false])(
  'scales the complete ADSR to short and long phases (inhale=%s)',
  (rising) => {
    const profile = rising ? GUIDANCE_AUDIO.inhale : GUIDANCE_AUDIO.exhale
    const { attackFraction, decayFraction, sustainLevel, releaseFraction } = profile.adsr
    for (const seconds of [1, 60]) {
      const graph = {
        filter: { frequency: parameter() },
        peaks: [],
        envelope: { gain: parameter() },
      }
      scheduleSweep(graph, 10, seconds, 0, seconds, rising)
      const curve = expectCurve(graph.envelope.gain, 10, seconds)
      const gain = GUIDANCE_AUDIO.gain * profile.gainMultiplier
      const at = (position) => curve[Math.round(position * (curve.length - 1))] / gain
      expect(at(attackFraction)).toBeCloseTo(1, 2)
      expect(at((attackFraction + decayFraction + 1 - releaseFraction) / 2)).toBeCloseTo(
        sustainLevel,
        3,
      )
      expect(at(1 - releaseFraction / 2)).toBeCloseTo(sustainLevel / 2, 1)
      expect(Math.max(...curve)).toBeLessThanOrEqual(gain + 0.000001)
    }
  },
)
