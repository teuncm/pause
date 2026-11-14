import { BELL_SOUNDS, DEFAULT_BELL_SOUND, BELL_AUDIO, BELL_TIMBRE } from './constants.js'

export { BELL_SOUNDS, DEFAULT_BELL_SOUND } from './constants.js'

// Keep the low resonance centered; two gently modulated delays add a warm chorus.
export function scheduleBell(
  context,
  when,
  soundId = DEFAULT_BELL_SOUND,
  { sustain = false } = {},
) {
  const sound =
    typeof soundId === 'object' && soundId !== null
      ? soundId
      : BELL_SOUNDS.find((candidate) => candidate.id === soundId) || BELL_SOUNDS[0]
  const voices = new Set()
  const modulators = new Set()
  const effectNodes = new Set()
  const input = context.createGain()
  const output = context.createGain()
  const dry = context.createGain()
  effectNodes.add(input).add(output).add(dry)
  output.gain.setValueAtTime(1, when)
  dry.gain.setValueAtTime(BELL_AUDIO.dryGain, when)
  input.connect(dry)
  dry.connect(output)
  output.connect(context.destination)

  function cleanUp() {
    if (voices.size || modulators.size) return
    for (const node of effectNodes) node.disconnect()
    effectNodes.clear()
  }

  const end =
    when +
    Math.max(...sound.partials.map(([, , decay, delay = 0]) => decay + delay)) +
    BELL_AUDIO.voiceTailSeconds
  for (const { delaySeconds, rateHz, pan } of BELL_AUDIO.chorusVoices) {
    const delay = context.createDelay(BELL_AUDIO.chorusMaxDelaySeconds)
    const panner = context.createStereoPanner()
    const wet = context.createGain()
    const depth = context.createGain()
    const lfo = context.createOscillator()
    effectNodes.add(delay).add(panner).add(wet).add(depth).add(lfo)
    delay.delayTime.setValueAtTime(delaySeconds, when)
    panner.pan.setValueAtTime(pan, when)
    wet.gain.setValueAtTime(BELL_AUDIO.chorusWetGain, when)
    depth.gain.setValueAtTime(BELL_AUDIO.chorusDepthSeconds, when)
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(rateHz, when)
    input.connect(delay)
    delay.connect(panner)
    panner.connect(wet)
    wet.connect(output)
    lfo.connect(depth)
    depth.connect(delay.delayTime)
    modulators.add(lfo)
    lfo.onended = () => {
      modulators.delete(lfo)
      cleanUp()
    }
    lfo.start(when)
    if (!sustain) lfo.stop(end + BELL_AUDIO.chorusTailSeconds)
  }

  for (const [index, [frequency, volume, decay, delay = 0]] of sound.partials.entries()) {
    const start = when + delay
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    if (!sustain) {
      // Brief, damped pitch roughness suggests a soft mallet contacting the bell.
      // Upper modes flex more; the amplitude envelope remains exactly as before.
      const strike = new Float32Array(BELL_AUDIO.strikeSamples)
      const depth =
        BELL_AUDIO.strikeDepthCents +
        (BELL_AUDIO.strikeUpperDepthCents * index) / Math.max(1, sound.partials.length - 1)
      for (let i = 0; i < strike.length; i++) {
        const time = (BELL_AUDIO.strikeSeconds * i) / (strike.length - 1)
        const phase = 2 * Math.PI * BELL_AUDIO.strikeRateHz * (1 + index * 0.13) * time
        strike[i] =
          (depth *
            Math.exp(-time / BELL_AUDIO.strikeDecaySeconds) *
            (Math.sin(phase) + 0.3 * Math.sin(phase * Math.SQRT2))) /
          1.3
      }
      strike[0] = strike[strike.length - 1] = 0
      oscillator.detune.setValueCurveAtTime(strike, start, BELL_AUDIO.strikeSeconds)
    }
    gain.gain.setValueAtTime(sustain ? 0 : BELL_AUDIO.minimumGain, start)
    gain.gain.linearRampToValueAtTime(
      volume,
      start + (sustain ? BELL_TIMBRE.previewFadeSeconds : sound.attack),
    )
    if (!sustain) gain.gain.exponentialRampToValueAtTime(BELL_AUDIO.minimumGain, start + decay)
    oscillator.connect(gain)
    gain.connect(input)
    const voice = { oscillator, gain, index, start, decay }
    voices.add(voice)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      voices.delete(voice)
      cleanUp()
    }
    oscillator.start(start)
    if (!sustain) oscillator.stop(start + decay + BELL_AUDIO.voiceTailSeconds)
  }

  return {
    when,
    get ended() {
      return voices.size === 0 && modulators.size === 0
    },
    update(nextSound) {
      const now = context.currentTime
      for (const voice of voices) {
        const partial = nextSound.partials[voice.index]
        const end = voice.start + voice.decay
        if (!partial || (!sustain && now >= end)) continue
        const [frequency, volume] = partial
        const at = Math.max(now, voice.start)
        voice.oscillator.frequency.cancelScheduledValues(at)
        if (now <= voice.start) voice.oscillator.frequency.setValueAtTime(frequency, at)
        else voice.oscillator.frequency.setTargetAtTime(frequency, at, BELL_TIMBRE.morphSeconds)
        const param = voice.gain.gain
        const held = Math.max(BELL_AUDIO.minimumGain, param.value)
        param.cancelScheduledValues(at)
        param.setValueAtTime(held, at)
        if (sustain) {
          if (now <= voice.start)
            param.linearRampToValueAtTime(volume, voice.start + BELL_TIMBRE.previewFadeSeconds)
          else param.setTargetAtTime(volume, at, BELL_TIMBRE.morphSeconds)
          continue
        }
        const rampEnd = at + Math.min(BELL_TIMBRE.morphSeconds, (end - at) / 2)
        const attackEnd = voice.start + sound.attack
        const age = rampEnd - voice.start
        const level =
          age < sound.attack
            ? BELL_AUDIO.minimumGain + ((volume - BELL_AUDIO.minimumGain) * age) / sound.attack
            : volume *
              (BELL_AUDIO.minimumGain / volume) ** ((rampEnd - attackEnd) / (end - attackEnd))
        param.linearRampToValueAtTime(Math.max(BELL_AUDIO.minimumGain, level), rampEnd)
        if (rampEnd < attackEnd) param.linearRampToValueAtTime(volume, attackEnd)
        param.exponentialRampToValueAtTime(BELL_AUDIO.minimumGain, end)
      }
    },
    stop(fadeSeconds = BELL_AUDIO.stopFadeSeconds) {
      const now = context.currentTime
      // Fade the whole mix so a chorus tail cannot linger after pause or end.
      output.gain.cancelScheduledValues(now)
      output.gain.setValueAtTime(Math.max(BELL_AUDIO.minimumGain, output.gain.value), now)
      output.gain.exponentialRampToValueAtTime(BELL_AUDIO.minimumGain, now + fadeSeconds)
      for (const { oscillator, gain } of voices) {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(Math.max(BELL_AUDIO.minimumGain, gain.gain.value), now)
        gain.gain.exponentialRampToValueAtTime(BELL_AUDIO.minimumGain, now + fadeSeconds)
        oscillator.stop(
          now + BELL_AUDIO.stopSeconds + Math.max(0, fadeSeconds - BELL_AUDIO.stopFadeSeconds),
        )
      }
      for (const lfo of modulators)
        lfo.stop(
          now +
            BELL_AUDIO.chorusTailSeconds +
            Math.max(0, fadeSeconds - BELL_AUDIO.stopFadeSeconds),
        )
    },
  }
}

export function createBellPlayer(
  createContext = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) throw new Error('Web Audio is not supported.')
    return new AudioContext()
  },
) {
  let context
  let active = false
  let disposed = false
  let intervalSeconds
  let durationSeconds
  let anchor
  let nextBell
  let endBellEnabled = false
  let endingBell = null
  let finished = false
  let selectedSound = DEFAULT_BELL_SOUND
  const bells = new Set()

  function stop() {
    active = false
    for (const bell of bells) bell.stop()
    bells.clear()
    endingBell = null
  }

  function addBell(when) {
    for (const bell of bells) if (bell.ended) bells.delete(bell)
    const bell = scheduleBell(context, when, selectedSound)
    bells.add(bell)
    return bell
  }

  function scheduleEndBell() {
    if (endBellEnabled && Number.isFinite(durationSeconds))
      endingBell = addBell(anchor + durationSeconds)
  }

  function sync(elapsedMs) {
    if (!active) return
    if (context.state !== 'running') throw new Error('Bell audio was interrupted.')
    const elapsed = elapsedMs / 1000
    if (Math.abs(context.currentTime - (anchor + elapsed)) > BELL_AUDIO.driftThresholdSeconds) {
      // Re-align if the device suspended the audio clock while wall time advanced.
      stop()
      active = true
      anchor = context.currentTime - elapsed
      nextBell = intervalSeconds === null ? 0 : Math.floor(elapsed / intervalSeconds) + 1
      scheduleEndBell()
    }
    if (intervalSeconds === null) return
    // Skip missed boundaries instead of playing a burst after a delayed browser tick.
    nextBell = Math.max(nextBell, Math.floor(elapsed / intervalSeconds) + 1)
    const horizon = elapsed + intervalSeconds * BELL_AUDIO.lookaheadIntervals
    while (nextBell * intervalSeconds <= horizon && nextBell * intervalSeconds < durationSeconds) {
      const when = anchor + nextBell * intervalSeconds
      if (when > context.currentTime) addBell(when)
      nextBell += 1
    }
  }

  return {
    async prepare() {
      if (disposed) throw new Error('Bell player is closed.')
      context ??= createContext()
      if (context.state !== 'running') await context.resume()
      if (disposed || context.state !== 'running') throw new Error('Bell audio could not start.')
    },
    begin({
      intervalMs,
      durationMs = null,
      elapsedMs = 0,
      startBell = false,
      endBell = false,
      soundId = DEFAULT_BELL_SOUND,
      startTime = context.currentTime,
    }) {
      if (intervalMs !== null && (!Number.isFinite(intervalMs) || intervalMs <= 0))
        throw new Error('Invalid bell interval.')
      stop()
      selectedSound = soundId
      intervalSeconds = intervalMs === null ? null : intervalMs / 1000
      durationSeconds = durationMs === null ? Infinity : durationMs / 1000
      anchor = startTime - elapsedMs / 1000
      nextBell = intervalMs === null ? 0 : Math.floor(elapsedMs / intervalMs) + 1
      active = true
      finished = false
      endBellEnabled = endBell
      if (startBell) addBell(startTime + BELL_AUDIO.startDelaySeconds)
      scheduleEndBell()
      // Keep two bells on the audio timeline ahead of the UI timer.
      sync(elapsedMs)
    },
    sync,
    preview(soundId = selectedSound) {
      stop()
      selectedSound = soundId
      addBell(context.currentTime + BELL_AUDIO.startDelaySeconds)
    },
    stop,
    finish({ manual = false } = {}) {
      if (finished) return
      finished = true
      active = false
      if (!context || context.state !== 'running') {
        stop()
        return
      }
      if (
        manual ||
        (endBellEnabled &&
          (!endingBell || endingBell.when > context.currentTime + BELL_AUDIO.endGraceSeconds))
      ) {
        stop()
        if (endBellEnabled) endingBell = addBell(context.currentTime + BELL_AUDIO.startDelaySeconds)
        return
      }
      // Let the single scheduled end bell decay; cancel any unrelated future audio.
      for (const bell of bells) {
        if (bell.when > context.currentTime + BELL_AUDIO.endGraceSeconds) bell.stop()
      }
    },
    async close({ closeContext = true } = {}) {
      disposed = true
      stop()
      if (closeContext && context && context.state !== 'closed') await context.close()
    },
  }
}
