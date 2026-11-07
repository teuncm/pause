import { BREATHING_PHASES, BREATHING_MAX_SECONDS, BREATHING_ANIMATION } from './constants.js'

export { BREATHING_PHASES } from './constants.js'

export function isValidBreathing(durations) {
  return BREATHING_PHASES.every(
    ({ key, min }) =>
      Number.isInteger(durations[key]) &&
      durations[key] >= min &&
      durations[key] <= BREATHING_MAX_SECONDS,
  )
}

// Derive the phase cue from active session time, including after a delayed tick.
export function getBreathingState(elapsedMs, durations) {
  if (!isValidBreathing(durations)) return null
  const cycle = BREATHING_PHASES.reduce((sum, { key }) => sum + durations[key] * 1000, 0)
  let position = Math.max(0, elapsedMs) % cycle
  for (const { key, label } of BREATHING_PHASES) {
    const duration = durations[key] * 1000
    if (position >= duration) {
      position -= duration
      continue
    }
    const hold = key === 'inHold' || key === 'outHold'
    return {
      key,
      label,
      secondsRemaining: Math.ceil((duration - position) / 1000),
      nextUpdateMs: (duration - position) % 1000 || 1000,
      hold,
    }
  }
}

export function getBreathingAnimation(durations) {
  if (!isValidBreathing(durations)) return null
  const { in: inhale, inHold, out, outHold } = durations
  const duration = inhale + inHold + out + outHold
  const outEnd = inhale + inHold + out
  const glowTimes = [0, inhale]
  const glowValues = [0, 0]
  function addHold(start, length) {
    if (length === 0) return
    const fade = Math.min(BREATHING_ANIMATION.holdFadeSeconds, length / 2)
    glowTimes.push(start + fade, start + length - fade, start + length)
    glowValues.push(1, 1, 0)
  }
  addHold(inhale, inHold)
  glowTimes.push(outEnd)
  glowValues.push(0)
  addHold(outEnd, outHold)
  return {
    duration,
    transforms: [
      BREATHING_ANIMATION.contractedScale,
      BREATHING_ANIMATION.expandedScale,
      BREATHING_ANIMATION.expandedScale,
      BREATHING_ANIMATION.contractedScale,
      BREATHING_ANIMATION.contractedScale,
    ].map((scale) => `scale(${scale})`),
    scaleTimes: [0, inhale, inhale + inHold, outEnd, duration].map((time) => time / duration),
    glowValues,
    glowTimes: glowTimes.map((time) => time / duration),
  }
}
