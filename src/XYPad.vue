<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Object, required: true },
  disabled: Boolean,
  title: { type: String, required: true },
  axes: { type: Array, required: true },
  edges: { type: Object, required: true },
  step: { type: Number, required: true },
  markers: { type: Array, default: () => [] },
  trapezoid: Boolean,
})
const emit = defineEmits(['update:modelValue', 'preview-start', 'preview-end'])
const bounds = ref(null)
function visualX(point) {
  const inset = props.trapezoid ? 0.35 * (1 - point.y) : 0
  return (inset + (1 - inset) * point.x) * 100
}
let pointer = null
let active = false
function begin() {
  if (props.disabled || active) return
  active = true
  emit('preview-start')
}
function end() {
  if (!active) return
  active = false
  emit('preview-end')
}
function rangeDown(event) {
  if (props.disabled) return
  event.currentTarget.setPointerCapture(event.pointerId)
  begin()
}
function cancel() {
  pointer = null
  end()
}
function visibility() {
  if (document.hidden) cancel()
}
window.addEventListener('blur', cancel)
document.addEventListener('visibilitychange', visibility)
function move(event) {
  if (props.disabled || event.pointerId !== pointer) return
  const rect = bounds.value.getBoundingClientRect()
  const clamp = (value) => Math.max(0, Math.min(1, value))
  const y = clamp(1 - (event.clientY - rect.top) / rect.height)
  const inset = props.trapezoid ? 0.35 * (1 - y) : 0
  emit('update:modelValue', {
    x: clamp(((event.clientX - rect.left) / rect.width - inset) / (1 - inset)),
    y,
  })
}
function down(event) {
  if (props.disabled || pointer !== null || (event.pointerType === 'mouse' && event.button !== 0))
    return
  pointer = event.pointerId
  event.currentTarget.setPointerCapture(pointer)
  move(event)
  begin()
}
function up(event) {
  if (event.pointerId !== pointer) return
  pointer = null
  end()
}
function input(axis, event) {
  emit('update:modelValue', { ...props.modelValue, [axis]: Number(event.target.value) / 100 })
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
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      pointer = null
      end()
    }
  },
)
onBeforeUnmount(() => {
  cancel()
  window.removeEventListener('blur', cancel)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <fieldset class="bell-pad-controls" :disabled="disabled">
    <legend>{{ title }}</legend>
    <div
      class="bell-pad"
      :class="{ 'is-disabled': disabled }"
      aria-hidden="true"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="up"
      @lostpointercapture="up"
    >
      <div ref="bounds" class="bell-pad-bounds">
        <svg
          v-if="trapezoid"
          class="vowel-outline"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path d="M0 0H100V100H35Z M17.5 50H100" />
        </svg>
        <span
          v-for="marker in markers"
          :key="marker.label"
          class="vowel-marker"
          :style="{
            left: `${visualX(marker)}%`,
            bottom: `${marker.y * 100}%`,
            transform:
              marker.x === 1 || marker.y === 0
                ? 'translate(calc(-100% - 14px), 50%)'
                : 'translate(14px, 50%)',
          }"
          >{{ marker.label }}</span
        >
        <span
          class="bell-pad-point"
          :style="{ left: `${visualX(modelValue)}%`, bottom: `${modelValue.y * 100}%` }"
        ></span>
      </div>
      <span class="bell-pad-high">{{ edges.top }}</span
      ><span class="bell-pad-low">{{ edges.bottom }}</span>
      <span class="bell-pad-warm">{{ edges.left }}</span
      ><span class="bell-pad-bright">{{ edges.right }}</span>
    </div>
    <label v-for="axis in ['x', 'y']" :key="axis" class="bell-axis">
      <span>{{ axes[axis === 'x' ? 0 : 1].label }}</span>
      <input
        type="range"
        min="0"
        max="100"
        :step="step * 100"
        :value="modelValue[axis] * 100"
        :aria-label="axes[axis === 'x' ? 0 : 1].ariaLabel"
        :aria-valuetext="`${Math.round(modelValue[axis] * 100)}% ${axes[axis === 'x' ? 0 : 1].toward}`"
        @input="input(axis, $event)"
        @pointerdown="rangeDown"
        @pointerup="end"
        @pointercancel="end"
        @lostpointercapture="end"
        @keydown="key"
        @keydown.enter.prevent="$event.target.blur()"
        @keyup="end"
        @blur="end"
      />
      <output>{{ Math.round(modelValue[axis] * 100) }}%</output>
    </label>
  </fieldset>
</template>

<style scoped>
.bell-pad-controls {
  min-width: 0;
  margin: 0;
  padding: 0.5rem 0;
  border: 0;
}
legend {
  color: var(--muted);
  font-size: 0.8125rem;
  padding: 0;
}
.bell-pad {
  position: relative;
  height: clamp(10rem, 40vw, 13rem);
  margin-block: 0.25rem 0.5rem;
  border: 1px solid var(--control-border);
  border-radius: 1.25rem;
  background: var(--background);
  touch-action: none;
  user-select: none;
  cursor: crosshair;
}
.bell-pad.is-disabled {
  opacity: 0.5;
  cursor: default;
}
.bell-pad-bounds {
  position: absolute;
  inset: 12px;
}
.bell-pad-point {
  position: absolute;
  width: 22px;
  height: 22px;
  transform: translate(-50%, 50%);
  border-radius: 50%;
  background: var(--accent);
  border: 3px solid var(--background);
  box-shadow: 0 0 0 1px var(--accent);
}
.vowel-outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  fill: none;
  stroke: var(--line);
}
.vowel-outline path {
  vector-effect: non-scaling-stroke;
}
.vowel-marker {
  position: absolute;
  transform: translate(-50%, 50%);
  color: var(--muted);
  font-size: 0.875rem;
  background: var(--background);
  padding: 0 0.15rem;
  pointer-events: none;
}
.bell-pad-high,
.bell-pad-low,
.bell-pad-warm,
.bell-pad-bright {
  position: absolute;
  color: var(--muted);
  font-size: 0.75rem;
  pointer-events: none;
}
.bell-pad-high {
  top: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
}
.bell-pad-low {
  bottom: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
}
.bell-pad-warm {
  left: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
}
.bell-pad-bright {
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
}
.bell-axis {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr) 4ch;
  gap: 0.5rem;
  align-items: center;
  min-height: var(--touch-target);
  color: var(--muted);
  font-size: 0.8125rem;
}
input {
  width: 100%;
  min-width: 0;
  min-height: var(--touch-target);
  margin: 0;
  accent-color: var(--accent);
}
output {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
@container settings (max-width: 16rem) {
  .bell-axis {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  input {
    grid-row: 2;
    grid-column: 1 / -1;
  }
}
</style>
