import { BELL_TIMBRE, CUSTOM_BELL_ID } from './constants.js'

const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
const mix = (a, b, t) => a + (b - a) * t
const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10)

function hash(x, y, channel) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel + 1, 1274126177)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

// Interpolate a fixed random lattice instead of reseeding a PRNG at each point.
// The quintic interpolation keeps values and derivatives continuous across cells.
function field(x, y, channel, scale = 3) {
  const sx = x * scale,
    sy = y * scale
  const ix = Math.floor(sx),
    iy = Math.floor(sy)
  const tx = smooth(sx - ix),
    ty = smooth(sy - iy)
  return mix(
    mix(hash(ix, iy, channel), hash(ix + 1, iy, channel), tx),
    mix(hash(ix, iy + 1, channel), hash(ix + 1, iy + 1, channel), tx),
    ty,
  )
}

export function generateBellTimbre(position) {
  const x = clamp(position.x),
    y = clamp(position.y)
  const noise = (channel) => (field(x, y, channel) + 0.5 * field(x, y, channel + 32, 6)) / 1.5
  const fundamental =
    BELL_TIMBRE.minHz *
    (BELL_TIMBRE.maxHz / BELL_TIMBRE.minHz) ** y *
    2 ** ((noise(0) - 0.5) * BELL_TIMBRE.pitchVariationOctaves)
  const weights = BELL_TIMBRE.weights.map(
    (weight, i) =>
      weight *
      mix(1, 0.35 + 1.45 * x, i / (BELL_TIMBRE.weights.length - 1)) *
      (0.8 + 0.4 * noise(i + 1)),
  )
  const sum = weights.reduce((total, value) => total + value, 0)
  return {
    id: CUSTOM_BELL_ID,
    label: 'Custom bell',
    attack:
      BELL_TIMBRE.minAttackSeconds +
      BELL_TIMBRE.attackRangeSeconds * (0.6 * (1 - x) + 0.4 * noise(10)),
    partials: BELL_TIMBRE.ratios.map((ratio, i) => [
      fundamental * ratio * (i < 2 ? 1 : 1 + (noise(i + 12) - 0.5) * BELL_TIMBRE.ratioVariation),
      (BELL_TIMBRE.totalGain * weights[i]) / sum,
      BELL_TIMBRE.minDecaySeconds +
        BELL_TIMBRE.decayRangeSeconds *
          (0.45 * (1 - y) + 0.35 * noise(i + 20) + 0.2 * (1 - i / (weights.length - 1))),
    ]),
  }
}
