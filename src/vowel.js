import { GUIDANCE_AUDIO, VOWEL_CHART } from './constants.js'
const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const mix = (a, b, t) => a + (b - a) * t

export function getVowelFormants(position = VOWEL_CHART.defaultPosition) {
  const x = clamp(position.x),
    y = clamp(position.y)
  return VOWEL_CHART.openFront.map((front, i) =>
    mix(
      mix(front, VOWEL_CHART.openBack[i], x),
      mix(VOWEL_CHART.closeFront[i], VOWEL_CHART.closeBack[i], x),
      y,
    ),
  )
}
export function createVowelProfile(position = VOWEL_CHART.defaultPosition) {
  const formants = getVowelFormants(position)
  const strength = Math.max(
    0,
    Math.min(
      VOWEL_CHART.maxStrength,
      Number.isFinite(position.strength) ? position.strength : VOWEL_CHART.defaultStrength,
    ),
  )
  return {
    ...GUIDANCE_AUDIO.exhale,
    lowPassMinHz: VOWEL_CHART.lowPassMinHz,
    lowPassMaxHz: VOWEL_CHART.lowPassMaxHz,
    filters: GUIDANCE_AUDIO.exhale.filters.map((filter, index) =>
      index < formants.length
        ? {
            ...filter,
            gainDb: filter.gainDb * strength,
            frequencyHz: formants[index],
            endFrequencyHz:
              formants[index] *
              ((filter.endFrequencyHz ?? filter.frequencyHz) / filter.frequencyHz),
          }
        : { ...filter },
    ),
  }
}
