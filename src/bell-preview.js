import { scheduleBell } from './bells.js'
import { BELL_TIMBRE, BELL_AUDIO } from './constants.js'

// One sustained oscillator bank; no retrigger timer or per-strike ADSR.
export function createBellPreview(getContext) {
  let voice
  const released = new Set()
  const quiet = (value) => ({
    ...value,
    partials: value.partials.map(([hz, gain, ...rest]) => [
      hz,
      gain * BELL_TIMBRE.previewGain,
      ...rest,
    ]),
  })
  function stop(fadeSeconds) {
    voice?.stop(fadeSeconds)
    voice = undefined
    for (const tail of released) if (!tail.ended) tail.stop(fadeSeconds)
    released.clear()
  }
  return {
    begin(value) {
      stop()
      const context = getContext()
      if (!context || context.state !== 'running') return
      voice = scheduleBell(
        context,
        context.currentTime + BELL_AUDIO.startDelaySeconds,
        quiet(value),
        { sustain: true },
      )
    },
    update(value) {
      if (getContext()?.state !== 'running') {
        stop()
        return
      }
      voice?.update(quiet(value))
    },
    release() {
      if (!voice) return
      voice.stop(BELL_TIMBRE.previewReleaseSeconds)
      released.add(voice)
      voice = undefined
    },
    stop,
  }
}
