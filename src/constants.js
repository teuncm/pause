// Session defaults. Durations are minutes unless the property says otherwise.
export const DEFAULT_BELL_SOUND = 'soft'
export const BELL_REPEAT_NEVER = 0
export const CUSTOM_BELL_ID = 'custom'
export const VOWEL_CHART = {
  defaultPosition: { x: 0, y: 0 }, // Begin exhaling with an open-front "ah".
  keyboardStep: 0.01,
  defaultStrength: 1,
  maxStrength: 1.5,
  strengthStep: 0.01,
  // Approximate unvoiced F1/F2/F3 anchors (Hz), not a speaker-specific voice model.
  // X: front -> back; Y: open -> close.
  openFront: [950, 1550, 2800],
  openBack: [950, 1150, 2500],
  closeFront: [300, 2500, 3300],
  closeBack: [350, 800, 2400],
  lowPassMinHz: 2200, // Soften broadband hiss; F3 remains gently attenuated.
  lowPassMaxHz: 2800,
  morphSeconds: 0.08,
  previewFadeSeconds: 0.06,
  previewReleaseSeconds: 0.1,
}
export const BELL_TIMBRE = {
  defaultPosition: { x: 0.35, y: 0.3 },
  minHz: 60,
  maxHz: 180,
  ratios: [1, 1.006, 2.76, 5.42, 8.93, 12.4],
  weights: [1, 0.55, 0.35, 0.2, 0.13, 0.08],
  totalGain: 0.38,
  ratioVariation: 0.06,
  pitchVariationOctaves: 0.035,
  minAttackSeconds: 0.28,
  attackRangeSeconds: 0.32,
  minDecaySeconds: 6,
  decayRangeSeconds: 6,
  keyboardStep: 0.01,
  previewGain: 0.5,
  previewFadeSeconds: 0.06,
  previewReleaseSeconds: 0.1,
  morphSeconds: 0.08,
}
export const DEFAULTS = {
  mode: 'timer',
  durationMinutes: 10,
  breathingEnabled: true,
  hideTime: true,
  audioGuidance: true,
  bellEnabled: true,
  bellAtStart: true,
  bellAtEnd: true,
  bellIntervalMinutes: BELL_REPEAT_NEVER,
  bellSound: DEFAULT_BELL_SOUND,
}

export const TIMER = { minMinutes: 1, maxMinutes: 180, presets: [5, 10, 15, 20, 30] }
export const BELL_REPEAT_MINUTES = [1, 2, 5, 10, 15, 30]
export const BREATHING_MAX_SECONDS = 60
export const BREATHING_PHASES = [
  { key: 'in', label: 'In', min: 1, defaultSeconds: 4 },
  { key: 'inHold', label: 'In-hold', min: 0, defaultSeconds: 2 },
  { key: 'out', label: 'Out', min: 1, defaultSeconds: 6 },
  { key: 'outHold', label: 'Out-hold', min: 0, defaultSeconds: 2 },
]

export const BREATHING_ANIMATION = {
  contractedScale: 0.65,
  expandedScale: 1.1,
  holdFadeSeconds: 0.3,
  resyncThresholdSeconds: 0.05,
}
export const SESSION_TICK_MS = 200

// Audio frequencies are Hz; envelope and scheduling times are seconds.
export const GUIDANCE_AUDIO = {
  highPassHz: 500,
  lowPassMinHz: 800,
  lowPassMaxHz: 1200,
  filterQ: Math.SQRT1_2,
  gain: 0.065,
  // Noise-only vocal-tract approximations. Negative gains create spectral dips.
  // Optional endFrequencyHz gives a gentle drift over the full breathing phase.
  inhale: {
    gainMultiplier: 1,
    adsr: { attackFraction: 0.32, decayFraction: 0.18, sustainLevel: 0.82, releaseFraction: 0.25 },
    // A muted lower band and broad nasal resonance, with less upper-frequency hiss.
    filters: [
      { frequencyHz: 650, endFrequencyHz: 700, q: 2, gainDb: -9 },
      { frequencyHz: 1100, endFrequencyHz: 1200, q: 0.9, gainDb: 4 },
      { frequencyHz: 2100, q: 0.7, gainDb: -8 },
      { frequencyHz: 4200, q: 0.6, gainDb: -12 },
    ],
  },
  exhale: {
    gainMultiplier: 0.3 * 10 ** (-3 / 20),
    adsr: { attackFraction: 0.14, decayFraction: 0.22, sustainLevel: 0.58, releaseFraction: 0.4 },
    // Open-front a to open-back ɑ over the complete exhale; no change in height.
    filters: [
      { frequencyHz: 950, endFrequencyHz: 950, q: 2.4, gainDb: 12 },
      { frequencyHz: 1550, endFrequencyHz: 1150, q: 3.4, gainDb: 13 },
      { frequencyHz: 2800, endFrequencyHz: 2500, q: 3.5, gainDb: 9 },
      { frequencyHz: 3800, q: 0.7, gainDb: -6 },
    ],
  },
  // ADSR fractions scale with the full phase; the unused fraction is sustain time.
  envelopeSamples: 128,
  envelopeSamplesPerSecond: 128,
  resumeFadeSeconds: 0.08,
  resumeFadeMaxFraction: 0.25,
  boundaryFadeSeconds: 0.2,
  boundaryFadeMaxFraction: 0.3,
  noiseBufferSeconds: 4,
  stopFadeSeconds: 0.02,
  stopSeconds: 0.025,
  minimumSweepSeconds: 0.0001,
}
export const AUDIO_SCHEDULE_LEAD_SECONDS = 0.1
export const BELL_AUDIO = {
  strikeSeconds: 0.22,
  strikeDecaySeconds: 0.065,
  strikeDepthCents: 35,
  strikeUpperDepthCents: 70,
  strikeSamples: 256,
  minimumGain: 0.0001, // Exponential ramps must finish above zero.
  dryGain: 0.82,
  stopFadeSeconds: 0.015,
  stopSeconds: 0.02,
  voiceTailSeconds: 0.03,
  startDelaySeconds: 0.02,
  driftThresholdSeconds: 0.5,
  lookaheadIntervals: 2,
  endGraceSeconds: 0.1,
  chorusTailSeconds: 0.06,
  chorusMaxDelaySeconds: 0.05,
  chorusWetGain: 0.16,
  chorusDepthSeconds: 0.003,
  chorusVoices: [
    { delaySeconds: 0.022, rateHz: 0.17, pan: -0.75 },
    { delaySeconds: 0.028, rateHz: 0.23, pan: 0.75 },
  ],
}

// Bell attack is seconds. Each partial is:
// [frequency Hz, peak gain, release-end seconds from the strike, optional delay seconds].
// The exponential release runs from the attack peak to that release-end time.
export const BELL_SOUNDS = [
  {
    id: 'soft',
    label: 'Soft bowl',
    attack: 0.3,
    partials: [
      [110, 0.16, 8],
      [110.55, 0.1, 7.5],
      [303.6, 0.065, 5.5],
      [982.3, 0.035, 4],
    ],
  },
  {
    id: 'tibetan-bowl',
    label: 'Tibetan bowl',
    attack: 0.35,
    // Closely spaced low fundamentals create a slow beating resonance.
    partials: [
      [82.41, 0.18, 11],
      [82.86, 0.11, 10],
      [227.4516, 0.07, 8],
      [735.9213, 0.035, 6],
    ],
  },
  {
    id: 'deep-bowl',
    label: 'Deep bowl',
    attack: 0.5,
    partials: [
      [65.41, 0.18, 12],
      [65.78, 0.11, 11],
      [180.5316, 0.06, 9],
      [584.1113, 0.025, 6.5],
    ],
  },
  {
    id: 'bronze-bowl',
    label: 'Bronze bowl',
    attack: 0.32,
    partials: [
      [98, 0.17, 9],
      [98.7, 0.105, 8.2],
      [270.48, 0.08, 6],
      [875.14, 0.04, 4.5],
    ],
  },
  {
    id: 'warm-bowl',
    label: 'Warm bowl',
    attack: 0.4,
    partials: [
      [73.42, 0.19, 10],
      [73.9, 0.1, 9.3],
      [202.6392, 0.065, 7],
      [655.6406, 0.03, 5.5],
    ],
  },
  {
    id: 'temple-gong',
    label: 'Temple gong',
    attack: 0.55,
    partials: [
      [146.83, 0.17, 14],
      [147.74, 0.09, 12],
      [421, 0.065, 10],
      [782.6, 0.03, 7],
    ],
  },
  {
    id: 'bronze-bell',
    label: 'Bronze bell',
    attack: 0.35,
    partials: [
      [174.61, 0.18, 9],
      [350.3, 0.085, 7.5],
      [482, 0.06, 6],
      [935.9, 0.028, 4.5],
    ],
  },
  {
    id: 'singing-glass',
    label: 'Singing glass',
    attack: 0.5,
    partials: [
      [220, 0.16, 11],
      [220.44, 0.095, 10],
      [604.3, 0.04, 8],
      [1193.5, 0.018, 5.5],
    ],
  },
  {
    id: 'temple-bell',
    label: 'Temple bell',
    attack: 0.4,
    partials: [
      [246.94, 0.17, 10],
      [493.2, 0.08, 8],
      [682.6, 0.055, 6.5],
      [1327.3, 0.022, 4.5],
    ],
  },
  {
    id: 'distant-bell',
    label: 'Distant bell',
    attack: 0.65,
    partials: [
      [293.66, 0.13, 12],
      [294.24, 0.075, 11],
      [797.2, 0.032, 8.5],
      [1574, 0.012, 6],
    ],
  },
]
