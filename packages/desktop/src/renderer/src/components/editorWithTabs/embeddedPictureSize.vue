<template>
  <form class="picture-size" :aria-label="t('embeddedImage.setSize')" @submit.prevent="apply">
    <label v-for="key in axes" :key="key">
      {{ t('embeddedImage.' + key) }}
      <input
        :ref="el => bindWidth(el, key)"
        type="number"
        min="1"
        step="1"
        :value="draft[key]"
        :placeholder="placeholder(key)"
        @input="update(key, $event)"
      >
      <template v-if="!(key === 'width' && fullWidth)">px</template>
    </label>
    <label><input v-model="locked" type="checkbox" @change="lockRatio">{{ t('embeddedImage.lockAspect') }}</label>
    <button type="button" @click="reset">{{ t('embeddedImage.autoSize') }}</button>
    <button type="submit" :disabled="!changed || !valid">{{ t('embeddedImage.apply') }}</button>
  </form>
</template>

<script setup lang="ts">
import { computed, reactive, ref, type ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IImageDimensions } from '@muyajs/core'

const props = defineProps<{ dimensions: IImageDimensions; natural: { width: number; height: number } }>()
const emit = defineEmits<{ apply: [dimensions: IImageDimensions] }>()
const { t } = useI18n()
const axes = ['width', 'height'] as const
type Axis = typeof axes[number]
const initialFullWidth = computed(() => props.dimensions.width === '100%')
const fullWidth = ref(props.dimensions.width === '100%')
const initialDraft = (key: Axis) => {
  const value = props.dimensions[key]
  return typeof value === 'number' ? String(value) : ''
}
const draft = reactive({ width: initialDraft('width'), height: initialDraft('height') })
const widthField = ref<HTMLInputElement>()
const locked = ref(true)
const ratio = computed(() => props.natural.width / props.natural.height)
const valid = computed(() => axes.every(key => !draft[key] || (Number.isSafeInteger(Number(draft[key])) && Number(draft[key]) > 0)))
const changed = computed(() =>
  fullWidth.value !== initialFullWidth.value ||
  axes.some(key => draft[key] !== initialDraft(key))
)

function otherDimension(key: Axis, value: number) {
  return Math.max(1, Math.round(key === 'width' ? value / ratio.value : value * ratio.value))
}
function bindWidth(el: Element | ComponentPublicInstance | null, key: Axis) {
  if (key === 'width' && el instanceof HTMLInputElement) widthField.value = el
}
function placeholder(key: Axis) {
  if (key === 'width' && fullWidth.value) return '100%'
  const other = key === 'width' ? 'height' : 'width'
  const pixels = draft[other] && ratio.value ? otherDimension(other, Number(draft[other])) : props.natural[key]
  return pixels > 0 ? String(pixels) : t('embeddedImage.auto')
}
function update(key: Axis, event: Event) {
  fullWidth.value = false
  const input = event.target as HTMLInputElement
  draft[key] = input.value
  if (locked.value && ratio.value > 0 && Number.isFinite(ratio.value) && input.validity.valid) {
    draft[key === 'width' ? 'height' : 'width'] = input.value ? String(otherDimension(key, input.valueAsNumber)) : ''
  }
}
function lockRatio() {
  if (locked.value && draft.width && ratio.value > 0 && Number.isFinite(ratio.value))
    draft.height = String(otherDimension('width', Number(draft.width)))
}
function reset() {
  fullWidth.value = false
  draft.width = draft.height = ''
}
function apply() {
  if (valid.value && changed.value)
    emit('apply', { width: draft.width ? Number(draft.width) : undefined, height: draft.height ? Number(draft.height) : undefined })
}
function focusWidth() {
  widthField.value?.focus()
  widthField.value?.select()
}
defineExpose({ focusWidth })
</script>

<style scoped>
.picture-size { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; padding: 8px 16px; background: white; border-block: 1px solid #dce1df; font-size: 13px; }
label { display: inline-flex; align-items: center; gap: 5px; }
input[type="number"] { width: 72px; padding: 4px; font: inherit; border: 1px solid #b8c3bd; border-radius: 4px; }
button { padding: 5px 8px; color: inherit; font: inherit; background: transparent; border: 1px solid #b8c3bd; border-radius: 4px; }
button:disabled { opacity: .5; }
</style>
