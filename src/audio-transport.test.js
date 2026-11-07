import { describe, expect, it, vi } from 'vitest'
import { createAudioTransport, scheduleSweep } from './audio-transport.js'

vi.mock('tone', () => ({ getContext: vi.fn(), getTransport: vi.fn(), start: vi.fn() }))

function parameter() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
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
      Q: {},
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

const breathing = { in: 4, inHold: 2, out: 6, outHold: 2 }

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
      [1200, 16.1],
    ])
    expect(f.nodes[3].gain.linearRampToValueAtTime.mock.calls).toEqual([
      [0.065, 10.1 + 0.45],
      [0, 14.1],
      [0.065, 16.55],
      [0, 22.1],
    ])
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
    expect(f.nodes[3].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 12.1)
  })

  it('resumes silently in a hold and schedules the next exhale', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing, elapsedMs: 5000 })
    expect(f.events.map(({ at }) => at)).toEqual([14, 6])
    expect(f.nodes[3].gain.value).toBe(0)
  })

  it('fades out at the session boundary even when it falls within a phase', async () => {
    const f = fixture()
    await f.audio.prepare()
    f.audio.begin({ breathing, durationMs: 2000 })
    expect(f.events).toHaveLength(1)
    f.events[0].callback(10.1)
    expect(f.nodes[3].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 12.1)
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
    expect(f.nodes[3].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 11.1)
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
  const graph = { filter: { frequency: parameter() }, envelope: { gain: parameter() } }
  scheduleSweep(graph, 5, 6, 0, 6, false)
  expect(graph.filter.frequency.setValueAtTime).toHaveBeenCalledWith(1200, 5)
  expect(graph.filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(800, 11)
  expect(graph.envelope.gain.setValueAtTime).toHaveBeenCalledWith(0, 5)
  expect(graph.envelope.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 11)
})
