<template>
  <el-autocomplete
    ref="autocomplete"
    v-model="value"
    :aria-label="label"
    :placeholder="placeholder"
    :disabled="disabled"
    :fetch-suggestions="suggestions"
    :debounce="0"
    popper-class="pref-dropdown"
    @focus="showAll = true"
    @input="showAll = false"
    @click="openOptions"
  >
    <template #suffix>
      <el-icon aria-hidden="true">
        <ArrowDown />
      </el-icon>
    </template>
  </el-autocomplete>
</template>

<script setup lang="ts">
import { ArrowDown } from '@element-plus/icons-vue'
import type { AutocompleteInstance } from 'element-plus'
import { ref } from 'vue'

const props = defineProps<{ label: string; options: string[]; placeholder?: string; disabled?: boolean }>()
const value = defineModel<string>({ required: true })
const showAll = ref(true)
const autocomplete = ref<AutocompleteInstance>()
function openOptions(): void {
  if (props.disabled) return
  showAll.value = true
  autocomplete.value?.focus()
  void autocomplete.value?.getData('')
}
defineExpose({ openOptions })

function suggestions(query: string, done: (items: { value: string }[]) => void): void {
  const matches = showAll.value ? props.options : props.options.filter(
    option => option.toLowerCase().includes(query.toLowerCase())
  )
  done(matches.map(value => ({ value })))
}
</script>
