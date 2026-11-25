<template>
  <section
    id="setting-themeSystemPrompt"
    class="system-prompt"
  >
    <label for="theme-system-prompt">{{ t('ai.systemPrompt') }}</label>
    <textarea
      id="theme-system-prompt"
      v-model="draft"
      rows="6"
      :disabled="!ready || saving"
      aria-describedby="theme-system-prompt-help"
    />
    <p id="theme-system-prompt-help">
      {{ t('ai.systemPromptHelp') }}
    </p>
    <div class="actions">
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!ready || draft === saved"
        @click="save(draft)"
      >
        {{ t('menu.file.save') }}
      </el-button>
      <el-button
        :disabled="!ready || saving || (draft === defaultThemeSystemPrompt && saved === draft)"
        @click="save(defaultThemeSystemPrompt)"
      >
        {{ t('preferences.keybindings.restoreDefaults') }}
      </el-button>
    </div>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { defaultThemeSystemPrompt } from '@shared/themePrompt'

const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const draft = ref('')
const saved = ref('')
const ready = ref(false)
const saving = ref(false)
const error = ref('')
onMounted(async() => {
  try {
    const preferences = await ipc.invoke('mt::preferences::get')
    saved.value = preferences.themeSystemPrompt || defaultThemeSystemPrompt
    draft.value = saved.value
    ready.value = true
  } catch { error.value = t('ai.promptStorageError') }
})
async function save(value: string): Promise<void> {
  if (!ready.value || saving.value) return
  saving.value = true
  error.value = ''
  const custom = value.trim()
  try {
    const result = await ipc.invoke('mt::preferences::update', { themeSystemPrompt: custom === defaultThemeSystemPrompt ? '' : custom })
    if (result.status === 'persisted') {
      saved.value = result.preferences.themeSystemPrompt || defaultThemeSystemPrompt
      draft.value = saved.value
    } else error.value = t('ai.promptStorageError')
  } catch { error.value = t('ai.promptStorageError') }
  finally { saving.value = false }
}
</script>

<style scoped>
.system-prompt { display: grid; gap: 8px; margin-block: 24px; color: var(--editorColor); }
label { font-weight: 600; }
textarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--editorColor30); border-radius: 5px; resize: vertical; color: inherit; background: var(--editorBgColor); font: inherit; line-height: 1.45; }
p { margin: 0; font-size: 13px; color: var(--editorColor70); }
.actions { display: flex; align-items: center; }
[role=alert] { color: var(--deleteColor); }
</style>
