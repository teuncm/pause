import { getContext, getTransport, start } from 'tone'
import { BREATHING_PHASES, GUIDANCE_AUDIO, AUDIO_SCHEDULE_LEAD_SECONDS } from './constants.js'

// The envelope follows both filters, so their residual resonance is silent in holds.
export function scheduleSweep(graph, time, seconds, offset, remaining, rising) {
  const frequencyAt = (position) =>
    GUIDANCE_AUDIO.lowPassMinHz *
    (GUIDANCE_AUDIO.lowPassMaxHz / GUIDANCE_AUDIO.lowPassMinHz) **
      (rising ? position : 1 - position)
  graph.filter.frequency.setValueAtTime(frequencyAt(offset / seconds), time)
  graph.filter.frequency.exponentialRampToValueAtTime(
    frequencyAt((offset + remaining) / seconds),
    time + remaining,
  )
  const attack = Math.min(
    GUIDANCE_AUDIO.attackSeconds,
    remaining * GUIDANCE_AUDIO.attackMaxPhaseFraction,
  )
  const release = Math.min(
    GUIDANCE_AUDIO.releaseSeconds,
    remaining * GUIDANCE_AUDIO.releaseMaxPhaseFraction,
  )
  graph.envelope.gain.setValueAtTime(0, time)
  graph.envelope.gain.linearRampToValueAtTime(GUIDANCE_AUDIO.gain, time + attack)
  graph.envelope.gain.setValueAtTime(GUIDANCE_AUDIO.gain, time + remaining - release)
  graph.envelope.gain.linearRampToValueAtTime(0, time + remaining)
}

function createNoise(context, buffer) {
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const highPass = context.createBiquadFilter()
  highPass.type = 'highpass'
  highPass.frequency.value = GUIDANCE_AUDIO.highPassHz
  highPass.Q.value = GUIDANCE_AUDIO.filterQ
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = GUIDANCE_AUDIO.filterQ
  const envelope = context.createGain()
  envelope.gain.value = 0
  const output = context.createGain()
  source
    .connect(highPass)
    .connect(filter)
    .connect(envelope)
    .connect(output)
    .connect(context.destination)
  source.onended = () => {
    for (const node of [source, highPass, filter, envelope, output]) node.disconnect()
  }
  return { source, filter, envelope, output }
}

export function createAudioTransport(api = { getContext, getTransport, start }) {
  let context
  let transport
  let buffer
  let graph
  let startAt = 0
  let position = 0
  let active = false
  let disposed = false
  const events = []

  function now() {
    return (position + (active ? Math.max(0, context.currentTime - startAt) : 0)) * 1000
  }

  function stop() {
    if (!context) return
    position = now() / 1000
    active = false
    transport.stop(context.currentTime)
    for (const event of events) transport.clear(event)
    events.length = 0
    if (graph) {
      // A separate output fade also silences automation already queued by lookahead.
      graph.output.gain.cancelScheduledValues(context.currentTime)
      graph.output.gain.setValueAtTime(1, context.currentTime)
      graph.output.gain.linearRampToValueAtTime(
        0,
        context.currentTime + GUIDANCE_AUDIO.stopFadeSeconds,
      )
      graph.source.stop(context.currentTime + GUIDANCE_AUDIO.stopSeconds)
      graph = undefined
    }
  }

  return {
    async prepare() {
      if (disposed) throw new Error('Audio transport is closed.')
      context = api.getContext().rawContext
      transport = api.getTransport()
      await api.start()
      if (disposed || context.state !== 'running') throw new Error('Audio could not start.')
    },
    get context() {
      return context
    },
    now,
    begin({ elapsedMs = 0, durationMs = null, breathing = null } = {}) {
      stop()
      position = elapsedMs / 1000
      // Give Tone's scheduler time to enqueue the first sample-accurate event.
      startAt = context.currentTime + AUDIO_SCHEDULE_LEAD_SECONDS
      active = true
      const end = durationMs === null ? Infinity : durationMs / 1000
      if (breathing) {
        if (!buffer) {
          buffer = context.createBuffer(
            1,
            context.sampleRate * GUIDANCE_AUDIO.noiseBufferSeconds,
            context.sampleRate,
          )
          const samples = buffer.getChannelData(0)
          for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
        }
        graph = createNoise(context, buffer)
        const voice = graph
        const cycle = BREATHING_PHASES.reduce((total, { key }) => total + breathing[key], 0)
        let phaseStart = 0
        for (const { key } of BREATHING_PHASES) {
          const seconds = breathing[key]
          if (key === 'in' || key === 'out') {
            const cycleStart = Math.floor(position / cycle) * cycle
            const currentStart = cycleStart + phaseStart
            const phaseEnd = currentStart + seconds
            if (position > currentStart && position < phaseEnd && position < end) {
              const remaining = Math.min(phaseEnd, end) - position
              events.push(
                transport.scheduleOnce((time) => {
                  scheduleSweep(
                    voice,
                    time,
                    seconds,
                    position - currentStart,
                    remaining,
                    key === 'in',
                  )
                }, position),
              )
            }
            const first = currentStart < position ? currentStart + cycle : currentStart
            if (first < end) {
              events.push(
                transport.scheduleRepeat(
                  (time) => {
                    const at = transport.getSecondsAtTime(time)
                    const remaining = Math.min(seconds, end - at)
                    if (remaining > GUIDANCE_AUDIO.minimumSweepSeconds)
                      scheduleSweep(voice, time, seconds, 0, remaining, key === 'in')
                  },
                  cycle,
                  first,
                  Number.isFinite(end) ? end - first : Infinity,
                ),
              )
            }
          }
          phaseStart += seconds
        }
        voice.source.start(startAt)
      }
      transport.start(startAt, position)
      return startAt
    },
    stop,
    async close() {
      disposed = true
      stop()
      if (context && context.state !== 'closed') await api.getContext().close()
    },
  }
}
