import { expect, it } from 'vitest'
import { getVowelFormants, createVowelProfile } from './vowel.js'
import { VOWEL_CHART, GUIDANCE_AUDIO } from './constants.js'

it('matches the four chart corners and defaults to an open-front ah', () => {
  expect(getVowelFormants({ x: 0, y: 0 })).toEqual(VOWEL_CHART.openFront)
  expect(getVowelFormants({ x: 1, y: 0 })).toEqual(VOWEL_CHART.openBack)
  expect(getVowelFormants({ x: 0, y: 1 })).toEqual(VOWEL_CHART.closeFront)
  expect(getVowelFormants({ x: 1, y: 1 })).toEqual(VOWEL_CHART.closeBack)
  expect(getVowelFormants()).toEqual(
    GUIDANCE_AUDIO.exhale.filters.slice(0, 3).map((f) => f.frequencyHz),
  )
})
it('lowers F1 as the vowel closes and lowers F2 toward the back', () => {
  for (let n = 0; n <= 10; n++) {
    const t = n / 10
    expect(getVowelFormants({ x: t, y: 1 })[0]).toBeLessThan(getVowelFormants({ x: t, y: 0 })[0])
    expect(getVowelFormants({ x: 1, y: t })[1]).toBeLessThan(getVowelFormants({ x: 0, y: t })[1])
  }
})
it('keeps three formants ordered and smoothly changing throughout the chart', () => {
  for (let x = 0; x <= 1; x += 0.1)
    for (let y = 0; y <= 1; y += 0.1) {
      const a = getVowelFormants({ x, y }),
        b = getVowelFormants({ x: x + 0.00001, y })
      expect(a).toHaveLength(3)
      expect(a[0]).toBeGreaterThan(0)
      expect(a[1]).toBeGreaterThan(a[0])
      expect(a[2]).toBeGreaterThan(a[1])
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.1)
    }
})
it('preserves ADSR, resonance strengths, and the fourth filter', () => {
  const profile = createVowelProfile({ x: 0, y: 1 })
  expect(profile.adsr).toEqual(GUIDANCE_AUDIO.exhale.adsr)
  expect(profile.filters[3]).toEqual(GUIDANCE_AUDIO.exhale.filters[3])
  for (let i = 0; i < 3; i++) {
    expect(profile.filters[i].gainDb).toBe(GUIDANCE_AUDIO.exhale.filters[i].gainDb)
    expect(profile.filters[i].q).toBe(GUIDANCE_AUDIO.exhale.filters[i].q)
  }
  expect(GUIDANCE_AUDIO.exhale.filters[0].frequencyHz).toBe(850)
})
it('moves the default exhale from open-front to open-central across all three formants', () => {
  const profile = createVowelProfile()
  expect(profile.filters.slice(0, 3).map((f) => f.frequencyHz)).toEqual(
    getVowelFormants({ x: 0, y: 0 }),
  )
  expect(profile.filters.slice(0, 3).map((f) => f.endFrequencyHz)).toEqual(
    getVowelFormants({ x: 0.5, y: 0 }),
  )
})
it('clamps out-of-range and invalid coordinates', () => {
  expect(getVowelFormants({ x: -1, y: 2 })).toEqual(VOWEL_CHART.closeFront)
  expect(getVowelFormants({ x: NaN, y: Infinity })).toEqual(VOWEL_CHART.openFront)
})

it('scales only F1–F3 gains and clamps strength without changing the vowel or envelope', () => {
  const base = createVowelProfile({ x: 0.3, y: 0.6 })
  for (const [strength, multiplier] of [
    [0, 0],
    [0.5, 0.5],
    [1.5, 1.5],
    [-1, 0],
    [10, 1.5],
    [NaN, 1],
  ]) {
    const profile = createVowelProfile({ x: 0.3, y: 0.6, strength })
    expect(profile.adsr).toEqual(base.adsr)
    expect(profile.filters[3]).toEqual(base.filters[3])
    for (let i = 0; i < 3; i++) {
      expect(profile.filters[i]).toEqual({
        ...base.filters[i],
        gainDb: base.filters[i].gainDb * multiplier,
      })
    }
  }
})
