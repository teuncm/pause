<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import XYPad from './XYPad.vue'
import { VOWEL_CHART } from './constants.js'
import { getVowelFormants } from './vowel.js'
const props = defineProps({ modelValue: { type: Object, required: true }, disabled: Boolean })
const emit = defineEmits(['update:modelValue', 'preview-start', 'preview-end'])
const formants = computed(() => getVowelFormants(props.modelValue))
const strength = computed(() => props.modelValue.strength ?? VOWEL_CHART.defaultStrength)
let previewing = false
function begin() {
  if (props.disabled || previewing) return
  previewing = true
  emit('preview-start')
}
function end() {
  if (!previewing) return
  previewing = false
  emit('preview-end')
}
function down(event) {
  if (props.disabled || !event.isPrimary || event.button !== 0) return
  event.currentTarget.setPointerCapture(event.pointerId)
  begin()
}
function key(event) {
  if (
    [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ].includes(event.key)
  )
    begin()
}
function visibility() {
  if (document.hidden) end()
}
window.addEventListener('blur', end)
document.addEventListener('visibilitychange', visibility)
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) end()
  },
)
onBeforeUnmount(() => {
  end()
  window.removeEventListener('blur', end)
  document.removeEventListener('visibilitychange', visibility)
})
const axes = [
  { label: 'Front–Back', ariaLabel: 'Vowel frontness', toward: 'toward back' },
  { label: 'Height', ariaLabel: 'Vowel height', toward: 'toward close' },
]
const markers = [
  { x: 0, y: 1, label: 'i' },
  { x: 1, y: 1, label: 'u' },
  { x: 0, y: 0, label: 'a' },
  { x: 1, y: 0, label: 'ɑ' },
  { x: 0.5, y: 0.5, label: 'ə' },
]
</script>
<template>
  <div class="vowel-controls">
    <XYPad
      :model-value="modelValue"
      :disabled="disabled"
      title="Exhale vowel"
      :axes="axes"
      :edges="{ top: 'Close', bottom: 'Open', left: 'Front', right: 'Back' }"
      :step="VOWEL_CHART.keyboardStep"
      :markers="markers"
      trapezoid
      @update:model-value="$emit('update:modelValue', { ...modelValue, ...$event })"
      @preview-start="$emit('preview-start')"
      @preview-end="$emit('preview-end')"
    />
    <dl class="formant-values" aria-label="Exhale formants">
      <div v-for="(hz, index) in formants" :key="index">
        <dt>F{{ index + 1 }}</dt>
        <dd>{{ Math.round(hz) }} Hz</dd>
      </div>
    </dl>
    <label class="formant-strength">
      <span>Formant strength</span>
      <input
        type="range"
        min="0"
        :max="VOWEL_CHART.maxStrength * 100"
        :step="VOWEL_CHART.strengthStep * 100"
        :value="strength * 100"
        :disabled="disabled"
        :aria-valuetext="`${Math.round(strength * 100)}%`"
        @input="
          $emit('update:modelValue', { ...modelValue, strength: Number($event.target.value) / 100 })
        "
        @pointerdown="down"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="end"
        @keydown="key"
        @keydown.enter.prevent="$event.target.blur()"
        @keyup="end"
        @blur="end"
      />
      <output>{{ Math.round(strength * 100) }}%</output>
    </label>
  </div>
</template>
<style scoped>
.formant-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.formant-values > div {
  display: flex;
  gap: 0.35rem;
}
dd {
  margin: 0;
}
.formant-strength {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  color: var(--muted);
  font-size: 0.8125rem;
}
.formant-strength input {
  flex: 1 1 5rem;
  min-width: 0;
  min-height: 44px;
}
.formant-strength output {
  min-width: 3.5ch;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
</style>
