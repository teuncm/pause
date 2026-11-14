import { getContext, getTransport, start } from 'tone'
import { BREATHING_PHASES, GUIDANCE_AUDIO, AUDIO_SCHEDULE_LEAD_SECONDS } from './constants.js'
import { createVowelProfile } from './vowel.js'

const smooth = (position) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, position)))) / 2

function envelopeLevel(position, adsr) {
  const {
    attackFraction: attack,
    decayFraction: decay,
    sustainLevel: sustain,
    releaseFraction: release,
  } = adsr
  if (position <= 0 || position >= 1) return 0
  if (position < attack) return smooth(position / attack)
  if (position < attack + decay) return 1 + (sustain - 1) * smooth((position - attack) / decay)
  if (position <= 1 - release) return sustain
  return sustain * (1 - smooth((position - (1 - release)) / release))
}

function scheduleEnvelope(parameter, time, seconds, offset, remaining, profile) {
  const gain = GUIDANCE_AUDIO.gain * profile.gainMultiplier
  const curve = new Float32Array(
    Math.max(
      GUIDANCE_AUDIO.envelopeSamples,
      Math.ceil(remaining * GUIDANCE_AUDIO.envelopeSamplesPerSecond) + 1,
    ),
  )
  const fadeIn = Math.min(
    GUIDANCE_AUDIO.resumeFadeSeconds,
    remaining * GUIDANCE_AUDIO.resumeFadeMaxFraction,
  )
  const fadeOut = Math.min(
    GUIDANCE_AUDIO.boundaryFadeSeconds,
    remaining * GUIDANCE_AUDIO.boundaryFadeMaxFraction,
  )
  const truncated = offset + remaining < seconds - GUIDANCE_AUDIO.minimumSweepSeconds
  for (let i = 0; i < curve.length; i++) {
    const elapsed = (remaining * i) / (curve.length - 1)
    let level = envelopeLevel((offset + elapsed) / seconds, profile.adsr)
    // Resume at the original ADSR position, rather than restarting its peak.
    if (offset > 0) level *= smooth(elapsed / fadeIn)
    // Natural phase endings use their full release; early session endings fade too.
    if (truncated) level *= smooth((remaining - elapsed) / fadeOut)
    curve[i] = gain * level
  }
  curve[0] = curve[curve.length - 1] = 0
  parameter.setValueCurveAtTime(curve, time, remaining)
}

// The envelope follows all filters, so their residual resonance is silent in holds.
export function scheduleSweep(graph, time, seconds, offset, remaining, rising, vowel) {
  const profile = rising ? GUIDANCE_AUDIO.inhale : createVowelProfile(vowel)
  for (const [index, peak] of graph.peaks.entries()) {
    const settings = profile.filters[index]
    // Flatten unused filters if one profile has fewer resonances than the other.
    peak.gain.setValueAtTime(settings?.gainDb ?? 0, time)
    if (!settings) continue
    const frequencyAt = (position) =>
      settings.frequencyHz *
      ((settings.endFrequencyHz ?? settings.frequencyHz) / settings.frequencyHz) ** position
    peak.frequency.setValueAtTime(frequencyAt(offset / seconds), time)
    peak.frequency.exponentialRampToValueAtTime(
      frequencyAt((offset + remaining) / seconds),
      time + remaining,
    )
    peak.Q.setValueAtTime(settings.q, time)
  }
  const frequencyAt = (position) =>
    (profile.lowPassMinHz ?? GUIDANCE_AUDIO.lowPassMinHz) *
    ((profile.lowPassMaxHz ?? GUIDANCE_AUDIO.lowPassMaxHz) /
      (profile.lowPassMinHz ?? GUIDANCE_AUDIO.lowPassMinHz)) **
      (rising ? position : 1 - position)
  graph.filter.frequency.setValueAtTime(frequencyAt(offset / seconds), time)
  graph.filter.frequency.exponentialRampToValueAtTime(
    frequencyAt((offset + remaining) / seconds),
    time + remaining,
  )
  scheduleEnvelope(graph.envelope.gain, time, seconds, offset, remaining, profile)
}

export function createNoiseBuffer(context) {
  const buffer = context.createBuffer(
    1,
    context.sampleRate * GUIDANCE_AUDIO.noiseBufferSeconds,
    context.sampleRate,
  )
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
  return buffer
}

export function createGuidanceNoise(context, buffer) {
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
  const filterCount = Math.max(
    GUIDANCE_AUDIO.inhale.filters.length,
    GUIDANCE_AUDIO.exhale.filters.length,
  )
  const peaks = Array.from({ length: filterCount }, () => {
    const peak = context.createBiquadFilter()
    peak.type = 'peaking'
    peak.gain.value = 0
    return peak
  })
  let tail = source.connect(highPass).connect(filter)
  for (const peak of peaks) tail = tail.connect(peak)
  tail.connect(envelope).connect(output).connect(context.destination)
  source.onended = () => {
    for (const node of [source, highPass, filter, ...peaks, envelope, output]) node.disconnect()
  }
  return { source, filter, peaks, envelope, output }
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
    begin({ elapsedMs = 0, durationMs = null, breathing = null, vowel } = {}) {
      stop()
      position = elapsedMs / 1000
      // Give Tone's scheduler time to enqueue the first sample-accurate event.
      startAt = context.currentTime + AUDIO_SCHEDULE_LEAD_SECONDS
      active = true
      const end = durationMs === null ? Infinity : durationMs / 1000
      if (breathing) {
        buffer ??= createNoiseBuffer(context)
        graph = createGuidanceNoise(context, buffer)
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
                    vowel,
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
                      scheduleSweep(voice, time, seconds, 0, remaining, key === 'in', vowel)
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
