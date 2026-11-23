<template>
  <section id="setting-aiModels">
    <el-button
      type="primary"
      :disabled="listState !== 'ready'"
      @click="openEditor()"
    >
      {{ t('ai.add') }}
    </el-button>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <table
      :aria-label="t('preferences.categories.ai')"
      :aria-busy="listState === 'loading'"
    >
      <thead>
        <tr>
          <th scope="col">
            {{ t('ai.model') }}
          </th>
          <th scope="col">
            {{ t('ai.baseUrl') }}
          </th>
          <th scope="col">
            {{ t('ai.requestType') }}
          </th>
          <th scope="col">
            {{ t('ai.actions') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!profiles.length">
          <td
            colspan="4"
            class="empty"
          >
            <span v-if="listState === 'ready'">{{ t('ai.empty') }}</span>
            <template v-else-if="listState !== 'loading'">
              <span role="alert">{{ t(listState === 'outdated' ? 'ai.restartRequired' : 'ai.loadFailed') }}</span>
              <el-button
                v-if="listState === 'failed'"
                size="small"
                @click="loadProfiles"
              >
                {{ t('remoteContent.retry') }}
              </el-button>
            </template>
          </td>
        </tr>
        <tr
          v-for="profile in profiles"
          :key="profile.id"
        >
          <td>
            {{ profile.displayName || profile.model }}
            <small v-if="profile.displayName && profile.displayName !== profile.model">{{ profile.model }}</small>
          </td>
          <td>{{ profile.baseUrl }}</td>
          <td>{{ profile.requestType === 'responses' ? 'Responses' : 'Chat Completions' }}</td>
          <td>
            <div class="actions">
              <el-button
                size="small"
                :loading="testing.has(profile.id)"
                @click="test(profile.id)"
              >
                {{ t('ai.test') }}
              </el-button>
              <el-button
                size="small"
                :disabled="testing.has(profile.id)"
                @click="openEditor(profile)"
              >
                {{ t('menu.edit.edit') }}
              </el-button>
              <el-button
                size="small"
                :disabled="testing.has(profile.id)"
                @click="removing = profile"
              >
                {{ t('preferences.spellchecker.customDictionary.delete') }}
              </el-button>
            </div>
            <span
              v-if="results[profile.id]"
              role="status"
            >{{ results[profile.id] }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <model-settings
      v-if="editorOpen"
      :profile="editing"
      @close="editorOpen = false"
      @saved="saved"
    />
    <el-dialog
      v-if="removing"
      :model-value="true"
      append-to-body
      align-center
      width="min(420px, 90vw)"
      :title="t('ai.remove', { model: removing.displayName || removing.model })"
      @close="removing = undefined"
    >
      <template #footer>
        <el-button @click="removing = undefined">
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="danger"
          :loading="deleting"
          @click="remove"
        >
          {{ t('preferences.spellchecker.customDictionary.delete') }}
        </el-button>
      </template>
    </el-dialog>
  </section>
  <system-prompt />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiModelProfile } from '@shared/aiModel'
import ModelSettings from './modelSettings.vue'
import SystemPrompt from './systemPrompt.vue'
import { modelError } from '../theme/studioErrors'

const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const profiles = ref<AiModelProfile[]>([])
const editing = ref<AiModelProfile>()
const editorOpen = ref(false)
const removing = ref<AiModelProfile>()
const deleting = ref(false)
const testing = ref(new Set<string>())
const results = ref<Record<string, string>>({})
const error = ref('')
const listState = ref<'loading' | 'ready' | 'outdated' | 'failed'>('loading')

function openEditor(profile?: AiModelProfile): void {
  editing.value = profile
  editorOpen.value = true
}
function saved(list: AiModelProfile[]): void {
  if (editing.value) delete results.value[editing.value.id]
  profiles.value = list
  editorOpen.value = false
  error.value = ''
}
async function test(id: string): Promise<void> {
  testing.value.add(id)
  delete results.value[id]
  try {
    await ipc.invoke('mt::ai::test', id)
    results.value[id] = t('ai.connected')
  } catch (cause) { results.value[id] = modelError(cause, t) }
  finally { testing.value.delete(id) }
}
async function remove(): Promise<void> {
  if (!removing.value || deleting.value) return
  const id = removing.value.id
  deleting.value = true
  try {
    profiles.value = await ipc.invoke('mt::ai::delete', id)
    delete results.value[id]
    error.value = ''
  } catch (cause) { error.value = modelError(cause, t) }
  finally { deleting.value = false; removing.value = undefined }
}
async function loadProfiles(): Promise<void> {
  listState.value = 'loading'
  try {
    profiles.value = await ipc.invoke('mt::ai::list')
    listState.value = 'ready'
  } catch (cause) {
    listState.value = String(cause).includes('No handler registered') ? 'outdated' : 'failed'
  }
}
onMounted(loadProfiles)
</script>

<style scoped>
section { margin-block: 20px; color: var(--editorColor); }
table { width: 100%; margin-top: 18px; border-collapse: collapse; font-size: 14px; }
td, th { text-align: start; padding: 10px 6px; border-bottom: 1px solid var(--editorColor10); overflow-wrap: anywhere; }
th { font-weight: 500; color: var(--editorColor70); }
td small { display: block; color: var(--editorColor60); }
td:last-child { width: 1%; min-width: 112px; }
.actions { display: flex; gap: 4px; flex-wrap: wrap; }
.actions .el-button { margin: 0; }
@container (min-width: 500px) { .actions { flex-wrap: nowrap; } }
[role=status] { display: block; font-size: 12px; margin-top: 4px; }
.empty { text-align: center; padding: 24px 6px; color: var(--editorColor60); }
.empty .el-button { margin-inline-start: 8px; }
[role=alert] { color: var(--deleteColor); }
</style>
