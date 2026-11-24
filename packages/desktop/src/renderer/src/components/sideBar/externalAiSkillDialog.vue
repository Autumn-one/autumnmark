<template>
  <dialog
    ref="dialog"
    class="skill-dialog"
    :aria-labelledby="headingId"
    @close="emit('close')"
    @click.self="dialog?.close()"
  >
    <div class="dialog-content">
      <header>
        <Connection aria-hidden="true" />
        <div>
          <h2 :id="headingId">
            {{ t('documentChat.onboarding.useExternal') }}
          </h2>
          <i18n-t
            keypath="documentChat.onboarding.skillIntro"
            tag="p"
          >
            <code>autumnmark</code>
          </i18n-t>
        </div>
        <button
          class="close"
          type="button"
          :aria-label="t('common.cancel')"
          @click="dialog?.close()"
        >
          <Close aria-hidden="true" />
        </button>
      </header>
      <main>
        <div
          class="targets"
          role="group"
          :aria-label="t('documentChat.onboarding.target')"
        >
          <button
            type="button"
            :aria-pressed="target === 'document'"
            @click="target = 'document'"
          >
            {{ t('documentChat.onboarding.editDocument') }}
          </button>
          <button
            type="button"
            :aria-pressed="target === 'theme'"
            @click="target = 'theme'"
          >
            {{ t('documentChat.onboarding.editTheme') }}
          </button>
        </div>
        <p class="scope">
          {{ t(target === 'document' ? 'documentChat.onboarding.documentScope' : 'documentChat.onboarding.themeScope') }}
        </p>
        <div class="invocation">
          <h3>{{ t('documentChat.onboarding.invokeSkill') }}</h3>
          <p>{{ t('documentChat.onboarding.invokeHint') }}</p>
          <p class="instruction">
            {{ instruction }}
          </p>
        </div>
        <p
          v-if="skillError"
          class="error"
          role="alert"
        >
          {{ t(skillError) }}
        </p>
        <details>
          <summary>{{ t('documentChat.onboarding.skillHelp') }}</summary>
          <p>{{ t('documentChat.onboarding.skillHelpHint') }}</p>
          <code>~/.agents/skills/autumnmark</code>
        </details>
      </main>
      <footer>
        <p
          v-if="notice"
          :role="notice.error ? 'alert' : 'status'"
          :class="{ error: notice.error }"
        >
          {{ t(notice.key) }}
        </p>
        <empty-state-button
          :label="t('documentChat.onboarding.copyInstruction')"
          @click="copy"
        />
      </footer>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue'
import { Close, Connection } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import EmptyStateButton from '@/components/emptyStateButton.vue'

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const ipc = window.electron.ipcRenderer
const headingId = useId()
const dialog = ref<HTMLDialogElement>()
const target = ref<'document' | 'theme'>('document')
const skillState = ref<'ready' | 'conflict' | 'failed'>()
const skillError = computed(() => {
  if (skillState.value === 'conflict') return 'themeCollaboration.skillConflict'
  if (skillState.value === 'failed') return 'themeCollaboration.skillError'
  return ''
})
const notice = ref<{ key: string; error?: boolean }>()
const instruction = computed(() => t(
  target.value === 'document' ? 'documentChat.onboarding.documentInstruction' : 'documentChat.onboarding.themeInstruction',
  ['autumnmark']
))

watch(target, () => { notice.value = undefined })
onMounted(async() => {
  dialog.value?.showModal()
  skillState.value = await ipc.invoke('mt::autumnmark-skill::status').catch(() => 'failed' as const)
})

async function copy(): Promise<void> {
  const current = target.value
  const copied = await window.electron.clipboard.writeText(instruction.value).catch(() => false)
  if (target.value === current) {
    notice.value = copied
      ? { key: 'documentChat.onboarding.instructionCopied' }
      : { key: 'documentChat.onboarding.copyFailed', error: true }
  }
}
</script>

<style scoped>
.skill-dialog {
  width: min(490px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: 0;
  border: 1px solid var(--sideBarBorderColor);
  border-radius: 10px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  font-size: 13px;
  line-height: 1.5;
}
.skill-dialog::backdrop { background: rgb(0 0 0 / 40%); }
header, main, footer { padding: 14px 16px; }
header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 9px;
  border-bottom: 1px solid var(--sideBarBorderColor);
}
header > svg { width: 19px; height: 19px; color: var(--themeColor); }
h2, h3, p { margin: 0; }
h2 { font-size: 17px; }
h3 { font-size: 13px; }
main { display: grid; gap: 12px; }
.invocation { display: grid; gap: 4px; }
code { color: var(--themeColor); }
.scope, .instruction, .targets {
  padding: 7px 9px;
  border: 1px solid var(--sideBarBorderColor);
  border-radius: 6px;
}
.scope { background: var(--themeColor10); }
.instruction { background: var(--sideBarBgColor); user-select: text; }
.targets {
  display: inline-flex;
  gap: 4px;
  justify-self: start;
  padding: 3px;
  background: var(--sideBarBgColor);
}
.targets button[aria-pressed="true"] { border-color: var(--themeColor); }
button:not(.empty-state-button) {
  min-height: 28px;
  padding: 3px 7px;
  border: 1px solid var(--sideBarBorderColor);
  border-radius: 5px;
  color: inherit;
  background: var(--editorBgColor);
  font: inherit;
}
button:enabled, summary { cursor: pointer; }
button.close { align-self: start; padding: 4px; border-color: transparent; }
.close svg { display: block; width: 15px; height: 15px; }
details > p { margin-top: 4px; }
footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px solid var(--sideBarBorderColor);
  background: var(--sideBarBgColor);
}
footer p { flex: 1 1 150px; }
.error { color: var(--deleteColor); }
</style>
