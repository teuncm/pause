<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import BellPad from './BellPad.vue'
import VowelPad from './VowelPad.vue'
import { createVowelPreview } from './vowel-preview.js'
import { generateBellTimbre } from './bell-timbre.js'
import { createBellPreview } from './bell-preview.js'
import {
  Check,
  ChevronDown,
  Flower,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  Square,
  Sun,
  Volume2,
} from '@lucide/vue'
import { createClock, formatTime } from './clock.js'
import { createAudioTransport } from './audio-transport.js'
import { createBellPlayer } from './bells.js'
import {
  DEFAULTS,
  TIMER,
  BELL_SOUNDS,
  BELL_REPEAT_MINUTES,
  BELL_REPEAT_NEVER,
  BREATHING_PHASES,
  BREATHING_MAX_SECONDS,
  BREATHING_ANIMATION,
  SESSION_TICK_MS,
  CUSTOM_BELL_ID,
  BELL_TIMBRE,
  VOWEL_CHART,
} from './constants.js'
import { animate } from 'motion/mini'
import { getBreathingAnimation, getBreathingState, isValidBreathing } from './breathing.js'

const mode = ref(DEFAULTS.mode)
const themePreference = ref(document.documentElement.dataset.theme || 'system')
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const systemIsDark = ref(systemTheme.matches)
const isDark = computed(
  () =>
    themePreference.value === 'dark' || (themePreference.value === 'system' && systemIsDark.value),
)
const themeButtonLabel = computed(() => `Switch to ${isDark.value ? 'light' : 'dark'} theme`)

function updateSystemTheme(event) {
  systemIsDark.value = event.matches
}
systemTheme.addEventListener('change', updateSystemTheme)

function toggleTheme() {
  const preference = isDark.value ? 'light' : 'dark'
  themePreference.value = preference
  document.documentElement.dataset.theme = preference
  document.querySelector('meta[name="color-scheme"]').content =
    preference === 'system' ? 'light dark' : preference
  try {
    localStorage.setItem('pause-theme', preference)
  } catch {
    // Theme changes still work when the browser blocks storage.
  }
}

const minutes = ref(DEFAULTS.durationMinutes)
const breathingEnabled = ref(DEFAULTS.breathingEnabled)
const hideTime = ref(DEFAULTS.hideTime)
const audioGuidance = ref(DEFAULTS.audioGuidance)
const exhaleVowel = ref({ ...VOWEL_CHART.defaultPosition })
const guidanceEnabled = computed(() => breathingEnabled.value && audioGuidance.value)
const breathingExpanded = ref(DEFAULTS.breathingEnabled)
const bellExpanded = ref(DEFAULTS.bellEnabled)
const breathingDurations = ref(
  Object.fromEntries(BREATHING_PHASES.map(({ key, defaultSeconds }) => [key, defaultSeconds])),
)
const validBreathing = computed(() => isValidBreathing(breathingDurations.value))
const breathingCue = ref(null)
const breathingOrb = ref(null)
const breathingGlow = ref(null)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let breathingAnimations = []
let breathingCueTimeout

function stopBreathing(reset = true) {
  clearTimeout(breathingCueTimeout)
  breathingCueTimeout = undefined
  for (const animation of breathingAnimations) {
    if (reset) animation.cancel()
    else animation.pause()
  }
  if (reset) {
    breathingAnimations = []
    if (breathingOrb.value) breathingOrb.value.style.transform = ''
    if (breathingGlow.value) breathingGlow.value.style.opacity = '0'
    breathingCue.value = null
  }
}

function syncBreathing(force = false) {
  if (!breathingEnabled.value || screen.value !== 'session') return
  const elapsedMs = clock.read().elapsed
  const state = getBreathingState(elapsedMs, breathingDurations.value)
  if (!state) return
  if (reducedMotion.matches) {
    if (breathingOrb.value) breathingOrb.value.style.transform = 'scale(1)'
    if (breathingGlow.value) breathingGlow.value.style.opacity = String(Number(state.hold))
  } else {
    for (const animation of breathingAnimations) {
      if (
        force ||
        Math.abs(animation.time - elapsedMs / 1000) > BREATHING_ANIMATION.resyncThresholdSeconds
      )
        animation.time = elapsedMs / 1000
    }
  }
  if (
    breathingCue.value?.key !== state.key ||
    (!sessionTimeHidden.value && breathingCue.value?.secondsRemaining !== state.secondsRemaining)
  )
    breathingCue.value = state
  if (!paused.value && !clock.read().complete && breathingCueTimeout === undefined) {
    // Only the text cue needs a timer; Motion handles all animation frames.
    breathingCueTimeout = setTimeout(() => {
      breathingCueTimeout = undefined
      syncBreathing()
    }, state.nextUpdateMs)
  }
}

async function beginBreathing() {
  await nextTick()
  if (!breathingEnabled.value || screen.value !== 'session') return
  if (!reducedMotion.matches && !breathingAnimations.length) {
    const frames = getBreathingAnimation(breathingDurations.value)
    const options = { duration: frames.duration, repeat: Infinity, ease: 'linear', autoplay: false }
    breathingAnimations = [
      animate(
        breathingOrb.value,
        { transform: frames.transforms },
        { ...options, times: frames.scaleTimes },
      ),
      animate(
        breathingGlow.value,
        { opacity: frames.glowValues },
        { ...options, times: frames.glowTimes },
      ),
    ]
  }
  syncBreathing(true)
  if (!paused.value) for (const animation of breathingAnimations) animation.play()
}

function updateMotionPreference() {
  stopBreathing()
  if (breathingEnabled.value && screen.value === 'session') beginBreathing()
}
reducedMotion.addEventListener('change', updateMotionPreference)

const bellEnabled = ref(DEFAULTS.bellEnabled)
const bellAtStart = ref(DEFAULTS.bellAtStart)
const bellAtEnd = ref(DEFAULTS.bellAtEnd)
const bellInterval = ref(DEFAULTS.bellIntervalMinutes)
const bellIntervalMs = computed(() =>
  bellInterval.value === BELL_REPEAT_NEVER ? null : bellInterval.value * 60_000,
)
const bellSound = ref(DEFAULTS.bellSound)
const bellPosition = ref({ ...BELL_TIMBRE.defaultPosition })
const selectedBell = computed(() =>
  bellSound.value === CUSTOM_BELL_ID ? generateBellTimbre(bellPosition.value) : bellSound.value,
)
const bellIntervals = BELL_REPEAT_MINUTES
const audioSupported = Boolean(window.AudioContext || window.webkitAudioContext)
const audioError = ref('')
const isStarting = ref(false)
const isResuming = ref(false)
const isTestingBell = ref(false)
const audio = createAudioTransport()
const bells = createBellPlayer(() => audio.context)
const bellPreview = createBellPreview(() => audio.context)
const vowelPreview = createVowelPreview(() => audio.context)
let vowelPreviewActive = false
let vowelPreviewVersion = 0
let previewActive = false
let previewVersion = 0
const usesAudio = computed(() => bellEnabled.value || guidanceEnabled.value)
const screen = ref('setup')
const paused = ref(false)
const elapsed = ref(0)
const sessionTimeHidden = computed(
  () => screen.value === 'session' && breathingEnabled.value && hideTime.value,
)
const heading = ref(null)
const durationInput = ref(null)
const presets = TIMER.presets
let clock
let interval
let sessionId = 0

const validDuration = computed(
  () =>
    Number.isInteger(minutes.value) &&
    minutes.value >= TIMER.minMinutes &&
    minutes.value <= TIMER.maxMinutes,
)
const remaining = computed(() => Math.max(0, minutes.value * 60_000 - elapsed.value))
const time = computed(() =>
  formatTime(mode.value === 'timer' ? remaining.value : elapsed.value, mode.value === 'timer'),
)
const progress = computed(() =>
  mode.value === 'timer' ? Math.min(1, elapsed.value / (minutes.value * 60_000)) : 0,
)
const sessionTitle = computed(() =>
  screen.value === 'complete'
    ? 'Session complete'
    : paused.value
      ? 'Paused'
      : mode.value === 'timer'
        ? 'Timer'
        : 'Timeless',
)
const announcement = ref('')

function adjustDuration(amount) {
  minutes.value = Math.min(
    TIMER.maxMinutes,
    Math.max(TIMER.minMinutes, (Number(minutes.value) || DEFAULTS.durationMinutes) + amount),
  )
}

async function focusHeading() {
  await nextTick()
  heading.value?.focus()
}

function stopTicking() {
  clearInterval(interval)
}

function tick() {
  if (usesAudio.value && audio.context?.state !== 'running') {
    clock.pause()
    audio.stop()
    bells.stop()
    stopTicking()
    paused.value = true
    stopBreathing(false)
    syncBreathing(true)
    audioError.value = 'Audio was interrupted. Resume to restore it.'
    announcement.value = 'Session paused.'
    return
  }
  const state = clock.read()
  elapsed.value = state.elapsed
  if (!state.complete) syncBreathing()
  if (state.complete) {
    clock.pause()
    audio.stop()
    stopBreathing()
    sessionId += 1
    stopTicking()
    if (bellEnabled.value) bells.finish()
    else bells.stop()
    audioError.value = ''
    screen.value = 'complete'
    announcement.value = 'Session complete.'
    focusHeading()
  } else if (bellEnabled.value) {
    try {
      bells.sync(state.elapsed)
    } catch {
      bells.stop()
      audioError.value = 'Bell audio was interrupted. Pause and resume to restore it.'
    }
  }
}

async function testBell() {
  if (isTestingBell.value || isStarting.value) return
  stopPreviews()
  isTestingBell.value = true
  audioError.value = ''
  try {
    await audio.prepare()
    await bells.prepare()
    if (bellEnabled.value && screen.value === 'setup') bells.preview(selectedBell.value)
  } catch {
    audioError.value = 'Bell audio could not start. Try again or turn off bell sounds.'
  } finally {
    isTestingBell.value = false
  }
}

function changeBells() {
  stopCustomPreview()
  bellExpanded.value = bellEnabled.value
  audioError.value = ''
  bells.stop()
}

function stopCustomPreview() {
  previewVersion += 1
  previewActive = false
  bellPreview.stop()
}
async function beginCustomPreview() {
  if (previewActive || isStarting.value || isTestingBell.value) return
  stopVowelPreview()
  bellSound.value = CUSTOM_BELL_ID
  const version = ++previewVersion
  previewActive = true
  audioError.value = ''
  bells.stop()
  try {
    await audio.prepare()
    if (
      version !== previewVersion ||
      !bellEnabled.value ||
      !bellExpanded.value ||
      screen.value !== 'setup' ||
      bellSound.value !== CUSTOM_BELL_ID ||
      document.hidden
    )
      return
    bellPreview.begin(selectedBell.value)
    if (!previewActive) bellPreview.release()
  } catch {
    if (version === previewVersion) {
      stopCustomPreview()
      audioError.value = 'Bell preview could not start. Try again.'
    }
  }
}
function endCustomPreview() {
  previewActive = false
  bellPreview.release()
}
function updateBellPosition(value) {
  bellSound.value = CUSTOM_BELL_ID
  bellPosition.value = value
  if (previewActive) bellPreview.update(selectedBell.value)
}
function stopVowelPreview() {
  vowelPreviewVersion += 1
  vowelPreviewActive = false
  vowelPreview.stop()
}
function stopPreviews() {
  stopCustomPreview()
  stopVowelPreview()
}
async function beginVowelPreview() {
  if (vowelPreviewActive || isStarting.value || isTestingBell.value || !guidanceEnabled.value)
    return
  stopCustomPreview()
  const version = ++vowelPreviewVersion
  vowelPreviewActive = true
  audioError.value = ''
  bells.stop()
  try {
    await audio.prepare()
    if (
      version !== vowelPreviewVersion ||
      !guidanceEnabled.value ||
      !breathingExpanded.value ||
      screen.value !== 'setup' ||
      document.hidden
    )
      return
    vowelPreview.begin(exhaleVowel.value)
    if (!vowelPreviewActive) vowelPreview.release()
  } catch {
    if (version === vowelPreviewVersion) {
      stopVowelPreview()
      audioError.value = 'Vowel preview could not start. Try again.'
    }
  }
}
function endVowelPreview() {
  vowelPreviewActive = false
  vowelPreview.release()
}
function updateExhaleVowel(value) {
  exhaleVowel.value = value
  if (vowelPreviewActive) vowelPreview.update(value)
}
function previewVisibility() {
  if (document.hidden) stopPreviews()
}
watch([breathingEnabled, breathingExpanded, audioGuidance], stopVowelPreview)
watch([bellEnabled, bellExpanded], stopCustomPreview)
watch(bellSound, (value) => {
  if (value !== CUSTOM_BELL_ID) stopCustomPreview()
})
window.addEventListener('blur', stopPreviews)
document.addEventListener('visibilitychange', previewVisibility)

function changeBreathing() {
  breathingExpanded.value = breathingEnabled.value
}

async function start() {
  if (isStarting.value || isTestingBell.value) return
  if (mode.value === 'timer' && !validDuration.value) {
    durationInput.value?.focus()
    return
  }
  if (breathingEnabled.value && !validBreathing.value) {
    breathingExpanded.value = true
    await nextTick()
    const phase = BREATHING_PHASES.find(
      ({ key, min }) =>
        !Number.isInteger(breathingDurations.value[key]) ||
        breathingDurations.value[key] < min ||
        breathingDurations.value[key] > BREATHING_MAX_SECONDS,
    )
    document.getElementById(`breathing-${phase.key}`)?.focus()
    return
  }
  isStarting.value = true
  stopPreviews()
  audioError.value = ''
  try {
    bells.stop()
    if (usesAudio.value) await audio.prepare()
    if (bellEnabled.value) await bells.prepare()
    const durationMs = mode.value === 'timer' ? minutes.value * 60_000 : null
    const startTime = usesAudio.value
      ? audio.begin({
          durationMs,
          breathing: guidanceEnabled.value ? breathingDurations.value : null,
          vowel: exhaleVowel.value,
        })
      : undefined
    if (bellEnabled.value)
      bells.begin({
        intervalMs: bellIntervalMs.value,
        durationMs,
        startBell: bellAtStart.value,
        endBell: bellAtEnd.value,
        soundId: selectedBell.value,
        startTime,
      })
    sessionId += 1
    elapsed.value = 0
    paused.value = false
    isResuming.value = false
    clock = createClock(durationMs, usesAudio.value ? audio.now : Date.now)
    clock.resume()
    screen.value = 'session'
    breathingCue.value = breathingEnabled.value
      ? getBreathingState(0, breathingDurations.value)
      : null
    beginBreathing()
    announcement.value = `${mode.value === 'timer' ? 'Timer' : 'Timeless'} started.`
    interval = setInterval(tick, SESSION_TICK_MS)
    focusHeading()
  } catch {
    bells.stop()
    audio.stop()
    audioError.value =
      'Audio could not start. Try again or turn off audio guidance and bell sounds.'
  } finally {
    isStarting.value = false
  }
}

async function togglePause() {
  if (isResuming.value) return
  if (paused.value) {
    const currentSession = sessionId
    isResuming.value = true
    audioError.value = ''
    try {
      if (usesAudio.value) await audio.prepare()
      if (bellEnabled.value) await bells.prepare()
      if (sessionId !== currentSession || screen.value !== 'session') return
      const startTime = usesAudio.value
        ? audio.begin({
            durationMs: mode.value === 'timer' ? minutes.value * 60_000 : null,
            elapsedMs: clock.read().elapsed,
            breathing: guidanceEnabled.value ? breathingDurations.value : null,
            vowel: exhaleVowel.value,
          })
        : undefined
      if (bellEnabled.value)
        bells.begin({
          intervalMs: bellIntervalMs.value,
          durationMs: mode.value === 'timer' ? minutes.value * 60_000 : null,
          elapsedMs: clock.read().elapsed,
          endBell: bellAtEnd.value,
          soundId: selectedBell.value,
          startTime,
        })
      clock.resume()
      paused.value = false
      beginBreathing()
      interval = setInterval(tick, SESSION_TICK_MS)
      announcement.value = 'Session resumed.'
    } catch {
      bells.stop()
      audio.stop()
      audioError.value = 'Audio could not resume. Try again or end the session.'
    } finally {
      if (sessionId === currentSession) isResuming.value = false
    }
  } else {
    clock.pause()
    audio.stop()
    bells.stop()
    stopTicking()
    tick()
    paused.value = true
    stopBreathing(false)
    syncBreathing(true)
    if (screen.value === 'session') announcement.value = 'Session paused.'
  }
}

async function finish() {
  stopBreathing()
  sessionId += 1
  const completedSession = sessionId
  bells.stop()
  audioError.value = ''
  clock.pause()
  audio.stop()
  stopTicking()
  elapsed.value = clock.read().elapsed
  screen.value = 'complete'
  announcement.value = 'Session ended.'
  focusHeading()
  if (bellEnabled.value && bellAtEnd.value) {
    try {
      await bells.prepare()
      if (sessionId === completedSession && screen.value === 'complete')
        bells.finish({ manual: true })
    } catch {
      if (sessionId === completedSession) audioError.value = 'The end bell could not play.'
    }
  }
}

function reset() {
  stopPreviews()
  audio.stop()
  stopBreathing()
  sessionId += 1
  bells.stop()
  audioError.value = ''
  stopTicking()
  screen.value = 'setup'
  announcement.value = ''
  focusHeading()
}

onUnmounted(() => {
  stopPreviews()
  window.removeEventListener('blur', stopPreviews)
  document.removeEventListener('visibilitychange', previewVisibility)
  reducedMotion.removeEventListener('change', updateMotionPreference)
  stopBreathing()
  systemTheme.removeEventListener('change', updateSystemTheme)
  sessionId += 1
  stopTicking()
  bells.close({ closeContext: false }).catch(() => {})
  audio.close().catch(() => {})
})
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main">Skip to meditation</a>
    <header class="site-header">
      <a
        class="brand"
        href="./"
        aria-label="Pause home"
        @click.prevent="screen !== 'setup' && reset()"
      >
        <span class="brand-icon"
          ><Flower :size="16" :stroke-width="1.75" aria-hidden="true"
        /></span>
        <span>Pause</span>
      </a>
      <button
        class="theme-toggle"
        type="button"
        :aria-label="themeButtonLabel"
        :title="themeButtonLabel"
        @click="toggleTheme"
      >
        <Sun v-if="isDark" :size="18" aria-hidden="true" />
        <Moon v-else :size="18" aria-hidden="true" />
      </button>
    </header>

    <main id="main" class="main-content" tabindex="-1">
      <div class="meditation-panel">
        <template v-if="screen === 'setup'">
          <h1 ref="heading" class="sr-only" tabindex="-1">Set up your meditation</h1>
          <form @submit.prevent="start" novalidate>
            <fieldset class="mode-selector" :disabled="isStarting">
              <legend class="sr-only">Meditation mode</legend>
              <label class="mode-option" :class="{ selected: mode === 'timer' }">
                <input v-model="mode" type="radio" name="mode" value="timer" />
                <span>Timer</span>
              </label>
              <label class="mode-option" :class="{ selected: mode === 'timeless' }">
                <input v-model="mode" type="radio" name="mode" value="timeless" />
                <span>Timeless</span>
              </label>
            </fieldset>

            <div class="duration-section">
              <div class="duration-controls">
                <button
                  v-if="mode === 'timer'"
                  class="icon-button duration-adjust"
                  type="button"
                  aria-label="Decrease duration by one minute"
                  :disabled="isStarting || minutes <= TIMER.minMinutes"
                  @click="adjustDuration(-1)"
                >
                  <Minus :size="19" aria-hidden="true" />
                </button>
                <div class="clock-face" :class="{ 'timeless-face': mode === 'timeless' }">
                  <template v-if="mode === 'timer'">
                    <label class="sr-only" for="duration">Duration in minutes</label>
                    <input
                      id="duration"
                      ref="durationInput"
                      v-model.number="minutes"
                      class="duration-input"
                      type="number"
                      inputmode="numeric"
                      enterkeyhint="done"
                      @keydown.enter.prevent="$event.target.blur()"
                      :min="TIMER.minMinutes"
                      :max="TIMER.maxMinutes"
                      step="1"
                      required
                      :disabled="isStarting"
                      :aria-invalid="!validDuration"
                      :aria-describedby="!validDuration ? 'duration-error' : undefined"
                    />
                    <span class="time-unit">{{ minutes === 1 ? 'minute' : 'minutes' }}</span>
                  </template>
                  <template v-else>
                    <span class="timeless-label">No time limit</span>
                  </template>
                </div>
                <button
                  v-if="mode === 'timer'"
                  class="icon-button duration-adjust"
                  type="button"
                  aria-label="Increase duration by one minute"
                  :disabled="isStarting || minutes >= TIMER.maxMinutes"
                  @click="adjustDuration(1)"
                >
                  <Plus :size="19" aria-hidden="true" />
                </button>
              </div>

              <div v-if="mode === 'timer'" class="duration-options">
                <div class="presets" role="group" aria-label="Duration in minutes">
                  <button
                    v-for="preset in presets"
                    :key="preset"
                    class="preset"
                    :class="{ active: minutes === preset }"
                    type="button"
                    :aria-label="`${preset} minutes`"
                    :aria-pressed="minutes === preset"
                    :disabled="isStarting"
                    @click="minutes = preset"
                  >
                    {{ preset }}
                  </button>
                </div>
                <p
                  v-if="!validDuration"
                  id="duration-error"
                  class="validation-message"
                  role="alert"
                >
                  Enter a whole number from {{ TIMER.minMinutes }} to
                  {{ TIMER.maxMinutes }} minutes.
                </p>
              </div>
              <div v-else class="duration-options" aria-hidden="true"></div>
            </div>

            <div class="settings">
              <div class="setting-group" role="group" aria-labelledby="breathing-settings-label">
                <div class="setting-row setting-heading">
                  <button
                    class="setting-disclosure"
                    type="button"
                    aria-label="Breathing assistance options"
                    :aria-expanded="breathingEnabled && breathingExpanded"
                    aria-controls="breathing-submenu"
                    :disabled="!breathingEnabled || isStarting"
                    @click="breathingExpanded = !breathingExpanded"
                  >
                    <span id="breathing-settings-label" class="setting-label"
                      >Breathing assistance</span
                    >
                    <ChevronDown
                      v-if="breathingEnabled"
                      class="disclosure-chevron"
                      :class="{ 'is-expanded': breathingExpanded }"
                      :size="16"
                      aria-hidden="true"
                    />
                  </button>
                  <label class="setting-toggle">
                    <input
                      v-model="breathingEnabled"
                      type="checkbox"
                      class="switch-input"
                      role="switch"
                      :disabled="isStarting"
                      aria-label="Breathing assistance"
                      @change="changeBreathing"
                    />
                    <span class="switch" aria-hidden="true"></span>
                  </label>
                </div>
                <p
                  v-if="breathingEnabled && !validBreathing"
                  id="breathing-error"
                  class="breathing-error"
                  role="alert"
                >
                  Use whole seconds: {{ BREATHING_PHASES[0].min }}–{{ BREATHING_MAX_SECONDS }} for
                  in and out, {{ BREATHING_PHASES[1].min }}–{{ BREATHING_MAX_SECONDS }} for holds.
                </p>
                <div
                  id="breathing-submenu"
                  :hidden="!breathingEnabled || !breathingExpanded"
                  class="breathing-options"
                >
                  <fieldset class="breathing-durations" :disabled="isStarting || !breathingEnabled">
                    <legend>Seconds per phase</legend>
                    <div class="breathing-controls">
                      <label
                        v-for="phase in BREATHING_PHASES"
                        :key="phase.key"
                        class="breathing-control"
                      >
                        <span>{{ phase.label }}</span>
                        <input
                          :id="`breathing-${phase.key}`"
                          v-model.number="breathingDurations[phase.key]"
                          type="number"
                          inputmode="numeric"
                          enterkeyhint="done"
                          @keydown.enter.prevent="$event.target.blur()"
                          :min="phase.min"
                          :max="BREATHING_MAX_SECONDS"
                          step="1"
                          required
                          :aria-label="`${phase.label} duration in seconds`"
                          :aria-invalid="
                            !Number.isInteger(breathingDurations[phase.key]) ||
                            breathingDurations[phase.key] < phase.min ||
                            breathingDurations[phase.key] > BREATHING_MAX_SECONDS
                          "
                          :aria-describedby="
                            breathingEnabled && !validBreathing ? 'breathing-error' : undefined
                          "
                        />
                      </label>
                    </div>
                  </fieldset>
                  <label class="setting-row">
                    <span class="setting-label">Hide time</span>
                    <input
                      v-model="hideTime"
                      type="checkbox"
                      class="switch-input"
                      role="switch"
                      :disabled="isStarting || !breathingEnabled"
                      aria-label="Hide time"
                    />
                    <span class="switch" aria-hidden="true"></span>
                  </label>
                  <label class="setting-row guidance-row">
                    <span class="setting-label">Audio guidance</span>
                    <input
                      v-model="audioGuidance"
                      type="checkbox"
                      class="switch-input"
                      role="switch"
                      :disabled="isStarting || !breathingEnabled || !audioSupported"
                      aria-label="Audio guidance"
                    />
                    <span class="switch" aria-hidden="true"></span>
                  </label>
                  <VowelPad
                    v-if="audioGuidance"
                    :model-value="exhaleVowel"
                    :disabled="
                      !breathingEnabled ||
                      !breathingExpanded ||
                      isStarting ||
                      isTestingBell ||
                      !audioSupported
                    "
                    @update:model-value="updateExhaleVowel"
                    @preview-start="beginVowelPreview"
                    @preview-end="endVowelPreview"
                  />
                </div>
              </div>
              <div class="setting-group" role="group" aria-labelledby="bell-settings-label">
                <div class="setting-row setting-heading">
                  <button
                    class="setting-disclosure"
                    type="button"
                    aria-label="Bell sound options"
                    :aria-expanded="bellEnabled && bellExpanded"
                    aria-controls="bell-submenu"
                    :disabled="!bellEnabled || !audioSupported || isStarting"
                    @click="bellExpanded = !bellExpanded"
                  >
                    <span id="bell-settings-label" class="setting-label"
                      >Bell sounds<span v-if="!audioSupported" class="coming-later"
                        >Not supported in this browser</span
                      ></span
                    >
                    <ChevronDown
                      v-if="bellEnabled"
                      class="disclosure-chevron"
                      :class="{ 'is-expanded': bellExpanded }"
                      :size="16"
                      aria-hidden="true"
                    />
                  </button>
                  <label class="setting-toggle">
                    <input
                      v-model="bellEnabled"
                      type="checkbox"
                      class="switch-input"
                      role="switch"
                      :disabled="!audioSupported || isStarting"
                      aria-label="Bell sounds"
                      @change="changeBells"
                    />
                    <span class="switch" aria-hidden="true"></span>
                  </label>
                </div>
                <div
                  id="bell-submenu"
                  :hidden="!bellEnabled || !bellExpanded"
                  class="bell-settings"
                >
                  <label class="bell-option-label" for="bell-sound">Sound</label>
                  <div class="bell-options bell-sound-options">
                    <select
                      id="bell-sound"
                      v-model="bellSound"
                      class="bell-select"
                      aria-label="Bell sound"
                      :disabled="!bellEnabled || isStarting || isTestingBell"
                      @change="changeBells"
                    >
                      <option v-for="sound in BELL_SOUNDS" :key="sound.id" :value="sound.id">
                        {{ sound.label }}
                      </option>
                      <option :value="CUSTOM_BELL_ID">Custom bell</option>
                    </select>
                    <button
                      class="test-bell"
                      type="button"
                      aria-label="Test bell"
                      :disabled="!bellEnabled || isStarting || isTestingBell"
                      @click="testBell"
                    >
                      <Volume2 :size="16" aria-hidden="true" /><span class="test-bell-label"
                        >Test bell</span
                      >
                    </button>
                  </div>
                  <BellPad
                    :model-value="bellPosition"
                    :disabled="!bellEnabled || !bellExpanded || isStarting || isTestingBell"
                    @update:model-value="updateBellPosition"
                    @preview-start="beginCustomPreview"
                    @preview-end="endCustomPreview"
                  />
                  <label class="setting-row">
                    <span class="setting-label">At session start</span>
                    <input
                      v-model="bellAtStart"
                      type="checkbox"
                      class="switch-input"
                      role="switch"
                      :disabled="!bellEnabled || isStarting"
                      aria-label="Bell at session start"
                    />
                    <span class="switch" aria-hidden="true"></span>
                  </label>
                  <label class="setting-row">
                    <span class="setting-label">At session end</span>
                    <input
                      v-model="bellAtEnd"
                      type="checkbox"
                      class="switch-input"
                      role="switch"
                      :disabled="!bellEnabled || isStarting"
                      aria-label="Bell at session end"
                    />
                    <span class="switch" aria-hidden="true"></span>
                  </label>
                  <div class="bell-options bell-repeat-options">
                    <label class="setting-label" for="bell-interval">Repeat</label>
                    <select
                      id="bell-interval"
                      v-model.number="bellInterval"
                      class="bell-select bell-interval"
                      :disabled="!bellEnabled || isStarting"
                    >
                      <option :value="BELL_REPEAT_NEVER">Never</option>
                      <option v-for="value in bellIntervals" :key="value" :value="value">
                        Every {{ value }} {{ value === 1 ? 'minute' : 'minutes' }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <button
              class="primary-button start-button"
              type="submit"
              :disabled="
                isStarting ||
                isTestingBell ||
                (mode === 'timer' && !validDuration) ||
                (breathingEnabled && !validBreathing)
              "
            >
              <Play :size="18" :stroke-width="1.8" aria-hidden="true" />Start
            </button>
          </form>
        </template>

        <section v-else class="session" aria-labelledby="session-heading">
          <h1 id="session-heading" ref="heading" class="session-heading" tabindex="-1">
            {{ sessionTitle }}
          </h1>
          <div
            class="session-clock"
            :class="{
              'is-complete': screen === 'complete',
              'breathing-active': breathingEnabled && screen === 'session',
            }"
          >
            <svg class="session-artwork" viewBox="0 0 280 280" aria-hidden="true">
              <defs>
                <radialGradient id="breathing-halo">
                  <stop offset="64%" stop-color="var(--breathing-glow)" stop-opacity="0" />
                  <stop offset="80%" stop-color="var(--breathing-glow)" />
                  <stop offset="100%" stop-color="var(--breathing-glow)" stop-opacity="0" />
                </radialGradient>
              </defs>
              <g ref="breathingOrb" class="session-orb">
                <circle class="orb-surface" cx="140" cy="140" r="136" />
                <g ref="breathingGlow" class="breathing-glow">
                  <circle cx="140" cy="140" r="170" fill="url(#breathing-halo)" />
                </g>
                <g
                  v-if="mode === 'timer' && !sessionTimeHidden"
                  class="progress-ring"
                  transform="rotate(-90 140 140)"
                >
                  <circle class="ring-track" cx="140" cy="140" r="136" />
                  <circle
                    class="ring-progress"
                    cx="140"
                    cy="140"
                    r="136"
                    pathLength="100"
                    stroke-dasharray="100"
                    :stroke-dashoffset="progress * 100"
                  />
                </g>
              </g>
            </svg>
            <Check
              v-if="screen === 'complete'"
              class="complete-icon"
              :size="24"
              aria-hidden="true"
            />
            <template v-if="!sessionTimeHidden">
              <div
                class="session-time"
                role="timer"
                aria-live="off"
                :aria-label="`${screen === 'complete' ? 'Session duration' : mode === 'timer' ? 'Time remaining' : 'Time elapsed'}: ${screen === 'complete' ? formatTime(elapsed) : time}`"
              >
                {{ screen === 'complete' ? formatTime(elapsed) : time }}
              </div>
              <span class="time-unit">{{
                screen === 'complete' ? 'meditated' : mode === 'timer' ? 'remaining' : 'elapsed'
              }}</span>
            </template>
          </div>
          <p v-if="breathingEnabled && breathingCue && screen === 'session'" class="breathing-cue">
            <span role="status" aria-live="polite" aria-atomic="true">{{
              breathingCue.label
            }}</span>
            <span v-if="!sessionTimeHidden" aria-hidden="true"
              >· {{ breathingCue.secondsRemaining }} s</span
            >
          </p>
          <div v-if="screen === 'session'" class="session-actions">
            <button
              class="primary-button"
              type="button"
              :disabled="isResuming"
              @click="togglePause"
            >
              <Play v-if="paused" :size="18" aria-hidden="true" /><Pause
                v-else
                :size="18"
                aria-hidden="true"
              />{{ paused ? 'Resume' : 'Pause' }}
            </button>
            <button class="secondary-button" type="button" @click="finish">
              <Square :size="15" aria-hidden="true" />End session
            </button>
          </div>
          <button v-else class="primary-button done-button" type="button" @click="reset">
            Done
          </button>
        </section>
        <p v-if="audioError" class="audio-error" role="alert">{{ audioError }}</p>
      </div>
    </main>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
