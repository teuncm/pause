import { createGuidanceNoise, createNoiseBuffer } from './audio-transport.js'
import { createVowelProfile } from './vowel.js'
import { GUIDANCE_AUDIO, VOWEL_CHART } from './constants.js'

export function createVowelPreview(getContext) {
  let graph, buffer
  const fading = new Set()
  function fade(voice, seconds) {
    const now = getContext().currentTime
    const param = voice.output.gain
    const held = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(held, now)
    param.linearRampToValueAtTime(0, now + seconds)
    voice.source.stop(now + seconds + 0.005)
  }
  function stop() {
    if (graph) fade(graph, GUIDANCE_AUDIO.stopFadeSeconds)
    graph = undefined
    for (const voice of fading) fade(voice, GUIDANCE_AUDIO.stopFadeSeconds)
    fading.clear()
  }
  function update(position) {
    const context = getContext()
    if (!graph) return
    if (context.state !== 'running') {
      stop()
      return
    }
    const profile = createVowelProfile(position),
      now = context.currentTime
    graph.filter.frequency.setTargetAtTime(
      (profile.lowPassMinHz + profile.lowPassMaxHz) / 2,
      now,
      VOWEL_CHART.morphSeconds,
    )
    for (const [index, peak] of graph.peaks.entries()) {
      const settings = profile.filters[index]
      peak.gain.setTargetAtTime(settings?.gainDb ?? 0, now, VOWEL_CHART.morphSeconds)
      if (settings) {
        peak.frequency.setTargetAtTime(settings.frequencyHz, now, VOWEL_CHART.morphSeconds)
        peak.Q.setTargetAtTime(settings.q, now, VOWEL_CHART.morphSeconds)
      }
    }
  }
  return {
    begin(position) {
      stop()
      const context = getContext()
      if (!context || context.state !== 'running') return
      buffer ??= createNoiseBuffer(context)
      graph = createGuidanceNoise(context, buffer)
      const voice = graph,
        clean = voice.source.onended
      voice.source.onended = () => {
        clean()
        fading.delete(voice)
      }
      update(position)
      voice.envelope.gain.setValueAtTime(0, context.currentTime)
      voice.envelope.gain.linearRampToValueAtTime(
        GUIDANCE_AUDIO.gain * GUIDANCE_AUDIO.exhale.gainMultiplier,
        context.currentTime + VOWEL_CHART.previewFadeSeconds,
      )
      voice.source.start(context.currentTime)
    },
    update,
    release() {
      if (!graph) return
      fade(graph, VOWEL_CHART.previewReleaseSeconds)
      fading.add(graph)
      graph = undefined
    },
    stop,
  }
}
