<script setup>
import XYPad from './XYPad.vue'
import { BELL_TIMBRE } from './constants.js'
defineProps({ modelValue: { type: Object, required: true }, disabled: Boolean })
defineEmits(['update:modelValue', 'preview-start', 'preview-end'])
const axes = [
  { label: 'Brightness (X)', ariaLabel: 'Bell brightness X', toward: 'toward bright' },
  { label: 'Pitch (Y)', ariaLabel: 'Bell pitch Y', toward: 'toward high' },
]
</script>
<template>
  <XYPad
    :model-value="modelValue"
    :disabled="disabled"
    title="Timbre"
    :axes="axes"
    :edges="{ top: 'High', bottom: 'Low', left: 'Warm', right: 'Bright' }"
    :step="BELL_TIMBRE.keyboardStep"
    @update:model-value="$emit('update:modelValue', $event)"
    @preview-start="$emit('preview-start')"
    @preview-end="$emit('preview-end')"
  />
</template>
