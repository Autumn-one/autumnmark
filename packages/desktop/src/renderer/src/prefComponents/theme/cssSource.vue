<template>
  <div class="css-source">
    <textarea
      ref="host"
      :aria-label="label"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import CodeMirror from 'codemirror'
import type { SelectorChoice } from './selectorRules'
import 'codemirror/lib/codemirror.css'
import 'codemirror/mode/css/css'
import 'codemirror/addon/display/placeholder'
import 'codemirror/theme/railscasts.css'

const props = defineProps<{ modelValue: string; readonly: boolean; label: string; dark: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [css: string] }>()
const host = ref<HTMLTextAreaElement>()
let editor: CodeMirror.EditorFromTextArea | undefined
let resize: ResizeObserver | undefined
onMounted(() => {
  if (!host.value) return
  host.value.value = props.modelValue
  editor = CodeMirror.fromTextArea(host.value, {
    placeholder: '.mu-container h2.mu-atx-heading {\n  margin-block-start: 2rem;\n}',
    mode: 'css', lineNumbers: true, lineWrapping: true,
    indentUnit: 2, tabSize: 2, readOnly: props.readonly, theme: props.dark ? 'railscasts' : 'default'
  })
  editor.getInputField().setAttribute('aria-label', props.label)
  resize = new ResizeObserver(() => editor?.refresh())
  resize.observe(editor.getWrapperElement())
  editor.on('change', (cm, change) => {
    if (change.origin !== 'setValue') emit('update:modelValue', cm.getValue())
  })
})
watch(() => props.modelValue, value => {
  if (editor && editor.getValue() !== value) {
    const cursor = editor.getCursor()
    editor.setValue(value)
    editor.setCursor(cursor)
  }
})
watch(() => props.dark, dark => editor?.setOption('theme', dark ? 'railscasts' : 'default'))
watch(() => props.readonly, readonly => editor?.setOption('readOnly', readonly))
function useSelector(choice: SelectorChoice): void {
  if (!editor || props.readonly) return
  const cm = editor
  cm.operation(() => {
    let cursor: CodeMirror.Position
    if (choice.offset === null) {
      const css = cm.getValue()
      const separator = css.length && !css.endsWith('\n\n') ? (css.endsWith('\n') ? '\n' : '\n\n') : ''
      cm.replaceRange(separator + choice.selector + ' {\n  \n}', cm.posFromIndex(css.length), undefined, 'theme-selector')
      cursor = { line: cm.lastLine() - 1, ch: 2 }
    } else {
      const lines = props.modelValue.slice(0, choice.offset).split(/\r\n?|\n/)
      cursor = { line: lines.length - 1, ch: lines[lines.length - 1].length }
    }
    cm.setCursor(cursor)
    cm.focus()
    cm.scrollIntoView(cursor, 48)
  })
}
defineExpose({ useSelector })

onBeforeUnmount(() => {
  resize?.disconnect()
  editor?.toTextArea()
})
</script>

<style scoped>
.css-source { min-height: 0; flex: 1; overflow: hidden; }
.css-source :deep(.CodeMirror) { height: 100%; font-family: 'Cascadia Code', Consolas, monospace; font-size: 13px; line-height: 1.65; }
.css-source :deep(.CodeMirror-placeholder) { opacity: .5; }
.css-source :deep(.CodeMirror-lines) { padding-block: 12px; }
</style>
