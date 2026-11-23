<template>
  <el-dialog
    :model-value="true"
    :title="t(profile ? 'ai.edit' : 'ai.add')"
    append-to-body
    align-center
    width="min(510px, 92vw)"
    class="ai-model-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="operation !== 'save'"
    :show-close="operation !== 'save'"
    @close="emit('close')"
  >
    <form
      class="model-form"
      @submit.prevent="save"
    >
      <label for="ai-display-name">{{ t('ai.displayName') }}</label>
      <el-input
        id="ai-display-name"
        v-model="displayName"
        :disabled="busy"
      />
      <label for="ai-base-url">{{ t('ai.baseUrl') }}</label>
      <el-input
        id="ai-base-url"
        v-model.trim="baseUrl"
        placeholder="https://api.openai.com/v1"
        :disabled="busy"
      />
      <label for="ai-api-key">{{ t('studio.apiKey') }}</label>
      <el-input
        id="ai-api-key"
        v-model.trim="key"
        type="password"
        show-password
        autocomplete="new-password"
        :placeholder="t(profile?.hasKey && !clearKey ? 'studio.keySaved' : 'studio.keyOptional')"
        :disabled="busy"
      />
      <label
        v-if="profile?.hasKey"
        class="clear-key"
      ><input
         v-model="clearKey"
         type="checkbox"
         :disabled="busy || !!key"
       >
        {{ t('studio.clearKey') }}</label>
      <label for="ai-request-type">{{ t('ai.requestType') }}</label>
      <select
        id="ai-request-type"
        v-model="requestType"
        :disabled="busy"
      >
        <option value="chat-completions">
          {{ t('ai.classic') }}
        </option>
        <option value="responses">
          Responses
        </option>
      </select>
      <label for="ai-model-id">{{ t('studio.model') }}</label>
      <div class="model-picker">
        <editable-select
          id="ai-model-id"
          ref="modelPicker"
          v-model="model"
          :label="t('studio.model')"
          :options="models"
          :disabled="busy"
        />
        <el-button
          :disabled="busy || !baseUrl"
          :loading="operation === 'discover'"
          @click="discover"
        >
          {{ t('ai.fetch') }}
        </el-button>
      </div>
      <label for="ai-reasoning">{{ t('ai.reasoning') }}</label>
      <editable-select
        id="ai-reasoning"
        v-model="reasoning"
        :label="t('ai.reasoning')"
        :options="efforts"
        :placeholder="t('ai.default')"
        :disabled="busy"
      />
      <fieldset class="input-types">
        <legend>{{ t('ai.inputTypes') }}</legend>
        <label
          v-for="type in aiInputTypes"
          :key="type"
        >
          <input
            v-model="inputTypes"
            type="checkbox"
            :value="type"
            :disabled="busy"
          >
          {{ type === 'pdf' ? 'PDF' : t(type === 'image' ? 'ai.image' : 'preferences.categories.video') }}
        </label>
      </fieldset>
      <div class="limits">
        <div>
          <label for="ai-context">{{ t('ai.context') }}</label>
          <editable-select
            id="ai-context"
            v-model="context"
            :label="t('ai.context')"
            :options="contextSizes"
            :placeholder="t('ai.default')"
            :disabled="busy"
          />
        </div>
        <div>
          <label for="ai-output">{{ t('ai.output') }}</label>
          <editable-select
            id="ai-output"
            v-model="output"
            :label="t('ai.output')"
            :options="outputSizes"
            :placeholder="t('ai.default')"
            :disabled="busy"
          />
        </div>
      </div>
      <p
        v-if="error || !validSizes"
        role="alert"
      >
        {{ error || t('ai.invalidSize') }}
      </p>
      <p
        v-else-if="status"
        role="status"
      >
        {{ status }}
      </p>
      <div class="footer">
        <el-button
          :loading="operation === 'test'"
          :disabled="!canSubmit"
          @click="test"
        >
          {{ t('ai.test') }}
        </el-button>
        <el-button
          :disabled="operation === 'save'"
          @click="emit('close')"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          native-type="submit"
          :loading="operation === 'save'"
          :disabled="!canSubmit"
        >
          {{ t('dialog.save') }}
        </el-button>
      </div>
    </form>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiConnectionDraft, AiModelDraft, AiModelProfile, AiRequestType } from '@shared/aiModel'
import { aiInputTypes, type AiInputType } from '@shared/aiModel'
import EditableSelect from './editableSelect.vue'
import { modelError } from '../theme/studioErrors'

const props = defineProps<{ profile?: AiModelProfile }>()
const emit = defineEmits<{ close: []; saved: [profiles: AiModelProfile[]] }>()
const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const displayName = ref(props.profile?.displayName ?? '')
const inputTypes = ref<AiInputType[]>([...(props.profile?.inputTypes ?? [])])
const baseUrl = ref(props.profile?.baseUrl ?? '')
const key = ref('')
const clearKey = ref(false)
const model = ref(props.profile?.model ?? '')
const requestType = ref<AiRequestType>(props.profile?.requestType ?? 'chat-completions')
const reasoning = ref(props.profile?.reasoningEffort ?? '')
const context = ref(String(props.profile?.contextSize ?? ''))
const output = ref(String(props.profile?.outputSize ?? ''))
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const contextSizes = ['4096', '8192', '16384', '32768', '65536', '128000', '131072', '200000', '262144', '1048576']
const outputSizes = ['1024', '2048', '4096', '8192', '16384', '32768', '65536', '128000']
const models = ref<string[]>([])
const modelPicker = ref<InstanceType<typeof EditableSelect>>()
const operation = ref<'' | 'discover' | 'test' | 'save'>('')
const status = ref('')
const error = ref('')
const busy = computed(() => !!operation.value)
const validSizes = computed(() => {
  const valid = (value: string): boolean => !value || (/^\d+$/.test(value) && Number.isSafeInteger(+value) && +value > 0)
  return valid(context.value) && valid(output.value) && (!context.value || !output.value || +output.value <= +context.value)
})
const canSubmit = computed(() => !busy.value && !!baseUrl.value && !!model.value.trim() && validSizes.value)

watch([baseUrl, key, clearKey], () => { models.value = [] })
watch([baseUrl, key, clearKey, model, requestType, reasoning, context, output], () => {
  status.value = ''
  error.value = ''
})
function connection(): AiConnectionDraft {
  return { id: props.profile?.id, baseUrl: baseUrl.value,
    key: key.value || (props.profile?.hasKey && !clearKey.value ? null : '') }
}
function draft(): AiModelDraft {
  return { ...connection(), displayName: displayName.value.trim(), inputTypes: [...inputTypes.value],
    model: model.value, requestType: requestType.value, reasoningEffort: reasoning.value,
    contextSize: context.value ? Number(context.value) : null, outputSize: output.value ? Number(output.value) : null }
}
async function discover(): Promise<void> {
  operation.value = 'discover'
  error.value = status.value = ''
  try {
    models.value = await ipc.invoke('mt::ai::discover', connection())
    status.value = t('ai.fetched', { count: models.value.length })
  } catch (cause) { error.value = modelError(cause, t) }
  finally { operation.value = '' }
  if (models.value.length && !error.value) {
    await nextTick()
    modelPicker.value?.openOptions()
  }
}
async function test(): Promise<void> {
  operation.value = 'test'
  error.value = status.value = ''
  try {
    await ipc.invoke('mt::ai::test', draft())
    status.value = t('ai.connected')
  } catch (cause) { error.value = modelError(cause, t) }
  finally { operation.value = '' }
}
async function save(): Promise<void> {
  if (!canSubmit.value) return
  operation.value = 'save'
  error.value = status.value = ''
  try {
    const list = await ipc.invoke('mt::ai::save', draft())
    emit('saved', list)
  } catch (cause) { error.value = modelError(cause, t) }
  finally { operation.value = '' }
}
</script>

<style scoped>
.model-form { display: grid; gap: 6px; }
.model-form label { margin-top: 7px; color: var(--editorColor); }
.model-form :deep(.el-autocomplete) { width: 100%; }
.model-form select { min-height: 32px; border: 1px solid var(--editorColor30); border-radius: 4px; padding-inline: 8px; font: inherit; color: var(--editorColor); background: var(--floatBgColor); }
.model-picker { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.clear-key { display: flex; align-items: center; gap: 5px; }
.input-types { display: flex; flex-wrap: wrap; gap: 16px; margin: 8px 0 0; padding: 0; border: 0; color: var(--editorColor); }
.input-types legend { padding: 0; }
.input-types label { display: inline-flex; align-items: center; gap: 4px; }
.limits { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.limits > div { display: grid; align-content: start; gap: 6px; }
.footer { display: flex; margin-top: 14px; }
.footer .el-button:first-child { margin-inline-end: auto; }
p { margin: 6px 0 0; }
[role=alert] { color: var(--deleteColor); }
</style>

<style>
.ai-model-dialog {
  max-height: 92vh;
  overflow-y: auto;
  --el-text-color-primary: var(--editorColor);
  --el-text-color-regular: var(--editorColor);
  --el-text-color-placeholder: var(--editorColor50);
  --el-fill-color-blank: var(--floatBgColor);
  --el-border-color: var(--editorColor30);
}
.ai-model-dialog input.el-input__inner { background: transparent; border: none; color: var(--editorColor); }
</style>
