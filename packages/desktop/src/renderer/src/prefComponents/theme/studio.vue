<template>
  <div class="theme-studio">
    <header class="studio-toolbar">
      <div class="draft-controls">
        <slot
          name="library"
          :theme="draft"
          :disabled="saving || collaborationOpening || collaborationStopping || switching"
        />
        <input
          v-model="themeName"
          class="theme-name"
          :aria-label="t('studio.name')"
          :title="t('studio.name')"
          :maxlength="maxThemeNameLength"
          :disabled="switching || saving || chatWorking || busy"
          spellcheck="false"
          @blur="finishManualVersion"
        >
        <div class="base-control select-control">
          <Moon
            v-if="isDarkThemeId(draft.base)"
            aria-hidden="true"
          />
          <Sunny
            v-else
            aria-hidden="true"
          />
          <select
            :aria-label="t('studio.base')"
            :title="t('studio.base')"
            :value="draft.base"
            :disabled="editing || busy || chatWorking || saving || collaborationOpening || switching"
            @change="changeBase"
          >
            <option
              v-for="base in themeBases"
              :key="base"
              :value="base"
            >
              {{ themeLabel(base) }}
            </option>
          </select>
        </div>
      </div>
      <div
        class="preview-switch"
        role="group"
        :aria-label="t('studio.preview')"
      >
        <button
          :aria-pressed="!source"
          @click="source = false"
        >
          <Document aria-hidden="true" />
          {{ t('studio.document') }}
        </button>
        <button
          :aria-pressed="source"
          @click="source = true"
        >
          <Tickets aria-hidden="true" />
          {{ t('studio.source') }}
        </button>
      </div>
      <div class="theme-save">
        <button
          type="button"
          class="primary save-theme"
          :disabled="saveDisabled"
          @click="saveTheme(false)"
        >
          <Check aria-hidden="true" />
          {{ t('studio.saveOnly') }}
        </button>
        <button
          type="button"
          class="primary save-options-trigger"
          :disabled="saveDisabled"
          :aria-label="t('studio.saveOptions')"
          :title="t('studio.saveOptions')"
          aria-haspopup="dialog"
          popovertarget="theme-save-options"
        >
          <ArrowDown aria-hidden="true" />
        </button>
        <div
          id="theme-save-options"
          ref="saveOptions"
          class="save-options"
          popover="auto"
          role="dialog"
          :aria-label="t('studio.saveOptions')"
        >
          <button
            type="button"
            class="toolbar-action"
            :disabled="saveDisabled"
            autofocus
            @click="saveTheme(true)"
          >
            {{ t('studio.saveAndApply') }}
          </button>
        </div>
      </div>
    </header>

    <main :class="{ inspecting: inspectorOpen && tab === 'css' }">
      <section class="preview panel">
        <div
          class="preview-frame"
          :style="{ backgroundColor: getThemeBackgroundColor(draft.base) }"
        >
          <iframe
            ref="frame"
            src="./theme-preview.html"
            :title="t('studio.preview')"
            @load="previewReady"
          />
        </div>
        <p
          v-if="inspectorOpen"
          class="inspect-hint muted"
        >
          {{ t('studio.inspectHint') }}
        </p>
      </section>

      <section class="tools panel">
        <div class="bar tools-bar">
          <div class="tabs">
            <button
              :aria-pressed="tab === 'ai'"
              @click="selectTab('ai')"
            >
              <MagicStick aria-hidden="true" />
              {{ t('studio.assistant') }}
            </button>
            <button
              :aria-pressed="tab === 'css'"
              @click="selectTab('css')"
            >
              {{ t('studio.css') }}
            </button>
          </div>
          <button
            v-if="tab === 'ai'"
            class="toolbar-action tool-icon"
            :aria-label="t('preferences.categories.ai')"
            :title="t('preferences.categories.ai')"
            @click="openModelSettings"
          >
            <Setting aria-hidden="true" />
          </button>
          <button
            v-else
            class="toolbar-action tool-icon"
            :aria-pressed="inspectorOpen"
            :aria-label="t('studio.inspect')"
            :title="t('studio.inspect')"
            @click="setInspector(!inspectorOpen)"
          >
            <Aim aria-hidden="true" />
          </button>
        </div>
        <template v-if="tab === 'css'">
          <div class="source-options">
            <label><input
              v-model="showBase"
              type="checkbox"
              @change="finishTyping"
            > {{ t('studio.baseSource') }}</label>
            <div
              v-if="inspectorOpen"
              class="selector-action"
            >
              <select
                v-if="selectorChoices.length"
                v-model="chosenSelector"
                :aria-label="t('studio.selector')"
              >
                <option
                  v-for="item in selectorChoices"
                  :key="item.selector"
                  :value="item.selector"
                >
                  {{ item.selector }}
                </option>
              </select>
              <button
                :disabled="!choice || busy || !!issue || choicesCss !== css"
                @click="useSelectedRule"
              >
                {{ t(choice && choice.offset !== null ? 'studio.locateSelector' : 'studio.addSelector') }}
              </button>
            </div>
          </div>
          <css-source
            ref="sourceEditor"
            :key="String(showBase)"
            :model-value="showBase ? formattedBase : css"
            :readonly="showBase || saving"
            :dark="isDarkThemeId(draft.base)"
            :label="showBase ? t('studio.baseSource') : t('studio.css')"
            @update:model-value="typeCss"
          />
        </template>
        <template v-else>
          <div class="chat">
            <div class="chat-picker">
              <chat-picker
                :items="chats"
                :current="chat"
                :disabled="!chatReady || chatRemoving || (chatWorking && !busy)"
                :selection-locked="chatWorking"
                :title="chatTitle"
                @select="selectChat"
                @remove="deleteChat"
              />
              <button
                class="toolbar-action new-chat"
                :disabled="!chatReady || chatWorking"
                @click="newChat"
              >
                <Plus aria-hidden="true" />
                {{ t('studio.newChat') }}
              </button>
            </div>
            <div
              ref="conversation"
              class="conversation"
              role="log"
              aria-live="polite"
            >
              <template
                v-for="(turn, i) in turns"
                :key="turn.id"
              >
                <article
                  class="user"
                  :aria-label="t('studio.user')"
                >
                  <p>{{ turn.prompt }}</p>
                </article>
                <article
                  class="assistant"
                  :aria-label="t('studio.assistant')"
                >
                  <span class="assistant-mark">
                    <MagicStick aria-hidden="true" />
                  </span>
                  <div class="assistant-content">
                    <div
                      v-if="turn.screenshots.length"
                      class="captures"
                    >
                      <button
                        v-for="(src, n) in turn.screenshots"
                        :key="n"
                        class="capture"
                        :aria-label="t('studio.screenshot', { n: n + 1 })"
                        @click="viewScreenshot(src, n + 1)"
                      >
                        <img
                          :src="src"
                          alt=""
                        >
                      </button>
                    </div>
                    <p>{{ active === turn.id ? progressText || t('studio.generating') : turn.reply || t('studio.stopped') }}</p>
                    <p
                      v-if="turn.notice"
                      class="muted"
                    >
                      {{ turn.notice }}
                    </p>
                    <details
                      v-if="turn.diagnostics?.length"
                      class="diagnostics"
                    >
                      <summary>{{ t('studio.diagnostics') }} ({{ turn.diagnostics.length }})</summary>
                      <template
                        v-for="diagnostic in turn.diagnostics"
                        :key="diagnostic.time"
                      >
                        <p>{{ new Date(diagnostic.time).toLocaleString(locale) }} · {{ diagnostic.model }} · {{ diagnostic.phase }}</p>
                        <code>{{ diagnostic.reason }}</code>
                        <pre v-if="diagnostic.assistantText">{{ diagnostic.assistantText }}</pre>
                      </template>
                      <button
                        class="toolbar-action"
                        @click="exportDiagnostics(turn)"
                      >
                        {{ t('studio.exportDiagnostics') }}
                      </button>
                    </details>
                    <div
                      v-if="!chatWorking"
                      class="turn-actions"
                    >
                      <button
                        class="toolbar-action"
                        :disabled="!chatReady"
                        @click="retractTurn(i)"
                      >
                        {{ t('studio.retract') }}
                      </button>
                      <button
                        class="toolbar-action"
                        :disabled="!chatReady || !profileId || !!issue || externalCapturing"
                        @click="retryTurn(i)"
                      >
                        {{ t('remoteContent.retry') }}
                      </button>
                    </div>
                  </div>
                </article>
              </template>
            </div>
            <div class="compose">
              <textarea
                v-model="prompt"
                rows="2"
                :maxlength="maxThemeMessageLength"
                :aria-label="t('studio.prompt')"
                :title="t('studio.composeHint')"
                :placeholder="t('studio.composePlaceholder')"
                @keydown.enter="promptEnter"
              />
              <div class="composer-footer">
                <div
                  v-if="profiles.length"
                  class="select-control profile-picker"
                >
                  <select
                    v-model="profileId"
                    :aria-label="t('ai.model')"
                    :disabled="busy"
                  >
                    <option
                      v-for="profile in profiles"
                      :key="profile.id"
                      :value="profile.id"
                    >
                      {{ profile.displayName || `${profile.model} · ${profile.baseUrl}` }}
                    </option>
                  </select>
                </div>
                <button
                  v-if="busy"
                  class="toolbar-action composer-action"
                  @click="stop"
                >
                  {{ t('studio.stop') }}
                </button>
                <button
                  v-else
                  class="primary composer-action"
                  :class="{ 'send-message': !!profileId }"
                  :aria-label="t(profileId ? 'studio.send' : 'studio.configure')"
                  :title="t(profileId ? 'studio.send' : 'studio.configure')"
                  :disabled="switching || !configLoaded || !chatReady || chatWorking || !!issue || externalCapturing || (!!profileId && !prompt.trim())"
                  @click="send"
                >
                  <Top
                    v-if="profileId"
                    aria-hidden="true"
                  />
                  <template v-else>
                    {{ t('studio.configure') }}
                  </template>
                </button>
              </div>
            </div>
          </div>
          <p class="privacy muted">
            {{ t(imageCapable ? 'ai.previewPrivacy' : 'studio.privacy') }}
          </p>
        </template>
      </section>
    </main>
    <footer>
      <button
        class="toolbar-action"
        :aria-label="t('studio.undo')"
        :title="t('studio.undo')"
        :disabled="switching || busy || (!undoStack.length && typingStart === undefined)"
        @click="undo"
      >
        <RefreshLeft aria-hidden="true" />
        {{ t('menu.edit.undo') }}
      </button>
      <button
        type="button"
        class="toolbar-action version-history-trigger"
        aria-haspopup="dialog"
        :disabled="switching || busy || saving || chatWorking"
        @click="openVersionHistory"
      >
        <Clock aria-hidden="true" />
        {{ t('themeHistory.title') }}
      </button>
      <button
        class="toolbar-action file-menu-trigger"
        popovertarget="theme-files"
        aria-haspopup="dialog"
      >
        <Files aria-hidden="true" />
        {{ t('studio.themeFiles') }}
        <ArrowDown
          class="menu-chevron"
          aria-hidden="true"
        />
      </button>
      <div
        id="theme-files"
        ref="themeFilesMenu"
        class="footer-popover theme-files-menu"
        popover="auto"
        role="dialog"
        :aria-label="t('studio.themeFiles')"
      >
        <button
          class="toolbar-action"
          :disabled="busy || collaborationOpening"
          @click="chooseThemeImport"
        >
          <Upload aria-hidden="true" />
          {{ t('studio.import') }}
        </button>
        <button
          class="toolbar-action"
          :disabled="busy || !!issue"
          @click="exportTheme"
        >
          <Download aria-hidden="true" />
          {{ t('studio.export') }}
        </button>
      </div>
      <input
        ref="themePicker"
        type="file"
        accept=".json"
        hidden
        @change="importTheme"
      >
      <button
        class="toolbar-action collaboration-trigger"
        popovertarget="theme-collaboration"
        aria-haspopup="dialog"
      >
        <Connection aria-hidden="true" />
        {{ t('themeCollaboration.title') }}
        <ArrowDown
          class="menu-chevron"
          aria-hidden="true"
        />
      </button>
      <div
        id="theme-collaboration"
        ref="collaborationMenu"
        class="footer-popover collaboration-menu"
        popover="auto"
        role="dialog"
        :aria-label="t('themeCollaboration.title')"
      >
        <code v-if="collaborationDirectory">{{ collaborationDirectory }}</code>
        <div class="collaboration-actions">
          <button
            :disabled="collaborationOpening || chatWorking || !!issue"
            @click="showCollaborationDirectory(false)"
          >
            {{ t('themeCollaboration.open') }}
          </button>
          <button
            :disabled="collaborationOpening || chatWorking || !!issue"
            @click="showCollaborationDirectory(true)"
          >
            {{ t('themeCollaboration.copy') }}
          </button>
        </div>
        <p
          v-if="collaborationNotice"
          role="status"
        >
          {{ t('themeCollaboration.' + collaborationNotice) }}
        </p>
      </div>
      <div class="footer-status">
        <span
          v-if="issue || error || storageError || collaborationError || workspaceError || versionFailed"
          role="alert"
        >{{ issue ? t('studio.cssIssue') + ' · ' + issue : storageError || error || collaborationError || workspaceError || t('themeHistory.storageError') }}</span>
        <span
          v-else
          class="muted"
          role="status"
        >{{ t('studio.draft') }}</span>
      </div>
    </footer>
    <theme-history-dialog
      v-if="versionDialogOpen"
      :name="draft.name"
      :current="versionSnapshot()"
      :entries="versionEntries"
      :failed="versionFailed"
      :restoring="versionRestoring"
      @restore="restoreVersion"
      @close="closeVersionHistory"
    />
    <screenshot-viewer
      v-if="viewing"
      v-bind="viewing"
      @close="closeScreenshot"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Aim, ArrowDown, Check, Clock, Connection, Document, Download, Files,
  MagicStick, Moon, Plus, RefreshLeft, Setting, Sunny, Tickets, Top, Upload } from '@element-plus/icons-vue'
import { getThemeBackgroundColor, isDarkThemeId } from 'common/theme'
import { themeCssIssue } from '@shared/themeCss'
import { parse } from 'postcss'
import { builtinThemeCss } from '@/util/builtinTheme'
import { listenForSkillRequests, skillRevision } from '@/services/autumnmarkSkill'
import type { SkillTheme, SkillThemeProbe, SkillThemeSnapshot, SkillWindowResponse } from '@shared/autumnmarkSkill'
import CssSource from './cssSource.vue'
import ChatPicker from './chatPicker.vue'
import { deferThemeDevUpdates } from './devUpdates'
import ScreenshotViewer from './screenshotViewer.vue'
import ThemeHistoryDialog from './themeHistoryDialog.vue'
import { useThemeChats } from './useThemeChats'
import { useThemeCollaboration } from './useThemeCollaboration'
import type { ThemeChat, ThemeTurn } from './chatHistory'
import type { SelectorChoice } from './selectorRules'
import { isLocalTheme, isThemeSample, maxThemeMessageLength, maxThemeNameLength, themeBases, type LocalTheme, type PreparedPreview, type PreviewTarget, type ThemeMessage } from '@shared/localTheme'
import { themeLabel } from './config'
import { themeSample } from './sample'
import { isCancelledRequest, modelError } from './studioErrors'
import { editableTheme, readDraftSample, type ThemeDraftEntry } from './themeDrafts'
import type { AiModelProfile } from '@shared/aiModel'
import type { ThemeCollaborationCapture, ThemeCollaborationFiles } from '@shared/themeCollaboration'
import type { ThemeSnapshot } from '@shared/themeVersion'
import type { ThemeVersion } from './themeVersions'
import { useThemeVersions } from './useThemeVersions'

const props = defineProps<{
  entry: ThemeDraftEntry
  savedTheme?: LocalTheme
  switching: boolean
  workspaceError: string
}>()
const emit = defineEmits<{ saved: [theme: LocalTheme, apply: boolean]; imported: [theme: LocalTheme] }>()
const { t, locale } = useI18n()
const ipc = window.electron.ipcRenderer
const storageKey = props.entry.key
let temporaryDraft = sessionStorage.getItem(storageKey) !== null && localStorage.getItem(storageKey) === null
const sampleKey = storageKey + '.sample'
const restoredPreview = props.entry.draft.previewCss
const draft = ref(editableTheme(props.entry.draft))
const draftUuid = draft.value.id.split(':')[2]
const versions = useThemeVersions(draftUuid)
const { entries: versionEntries, failed: versionFailed } = versions
const versionDialogOpen = ref(false)
const versionRestoring = ref(false)
let manualVersionStart: ThemeSnapshot | undefined
let manualVersionTimer: ReturnType<typeof setTimeout> | undefined
let generationVersion: { before: ThemeSnapshot; profile: string; locale: string } | undefined
const themeName = computed({
  get: () => draft.value.name,
  set: (name: string) => {
    if (name === draft.value.name || saving.value || chatWorking.value || busy.value) return
    startManualVersion()
    draft.value.name = name
  }
})
const editing = computed(() => props.savedTheme?.id === draft.value.id)
const source = ref(false)
const tab = ref<'css' | 'ai'>('ai')
const showBase = ref(false)
const inspectorOpen = ref(false)
const sourceEditor = ref<InstanceType<typeof CssSource>>()
const selectorChoices = ref<SelectorChoice[]>([])
const choicesCss = ref('')
const chosenSelector = ref('')
const choice = computed(() => selectorChoices.value.find(item => item.selector === chosenSelector.value))
const css = computed(() => draft.value.css ?? '')
const issue = computed(() => themeCssIssue(css.value))
const previewCss = ref(issue.value ? (typeof restoredPreview === 'string' && !themeCssIssue(restoredPreview) ? restoredPreview : '') : css.value)
const baseCss = computed(() => builtinThemeCss(draft.value.base))
const formattedBase = computed(() => {
  const root = parse(baseCss.value)
  const childIndent = new WeakMap<object, string>()
  root.walk(node => {
    const indent = node.parent ? childIndent.get(node.parent) ?? '' : ''
    childIndent.set(node, indent + '  ')
    node.raws.before = node === root.first ? '' : '\n' + indent
    if (node.type === 'decl') node.raws.between = ': '
    if (node.type === 'rule' || (node.type === 'atrule' && node.nodes)) {
      node.raws.between = ' '
      node.raws.after = '\n' + indent
      node.raws.semicolon = true
    }
  })
  return root.toString()
})
interface DraftEdits { css: string; sample: string | null }
const undoStack = ref<DraftEdits[]>([])
const typingStart = ref<DraftEdits>()
let generationStart: DraftEdits | undefined
const frame = ref<HTMLIFrameElement>()
const themePicker = ref<HTMLInputElement>()
const themeFilesMenu = ref<HTMLElement>()
const conversation = ref<HTMLDivElement>()
const collaborationMenu = ref<HTMLElement>()
const sampleOverride = ref(readDraftSample(storageKey))
const sampleMarkdown = computed(() => sampleOverride.value ?? themeSample(locale.value).markdown)
const profiles = ref<AiModelProfile[]>([])
const selectionKey = 'autumnmark.theme-model-id'
const profileId = ref(localStorage.getItem(selectionKey) ?? '')
const selectedProfile = computed(() => profiles.value.find(profile => profile.id === profileId.value))
const imageCapable = computed(() => selectedProfile.value?.inputTypes?.includes('image') === true)
let turnController: AbortController | undefined
const configLoaded = ref(false)
const history = useThemeChats(storageKey + '.chat', draftUuid, t)
if (import.meta.hot) onBeforeUnmount(deferThemeDevUpdates(import.meta.hot, history.whenIdle))
const { chats, selected, chat, turns, prompt, ready: chatReady, working: chatWorking, removing: chatRemoving, storageError, newChat } = history
const viewing = ref<{ src: string; number: number }>()
let queuedViewer: typeof viewing.value
let capturing = false
let captureRequest: { token: string; controller: AbortController; port?: MessagePort; snapshot?: ThemeCollaborationFiles } | undefined
const externalCapturing = ref(false)
let viewerClosed: (() => void) | undefined
const active = ref('')
const busy = computed(() => !!active.value)
const saving = ref(false)
const saveOptions = ref<HTMLElement>()
let leaving = false
const error = ref('')
watch(selected, id => {
  error.value = ''
  if (id && temporaryDraft) saveDraft()
})
const collaboration = useThemeCollaboration({
  files: () => ({ css: css.value, sampleMarkdown: sampleMarkdown.value }),
  baseCss: () => baseCss.value,
  valid: () => !issue.value,
  update: applyCollaborationFiles,
  capture: captureCollaborationPreview
})
const { directory: collaborationDirectory, issue: collaborationIssue, opening: collaborationOpening,
  stopping: collaborationStopping, notice: collaborationNotice } = collaboration
let workspacePreparation: Promise<string> | undefined
const saveDisabled = computed(() => props.switching || chatWorking.value || saving.value ||
  collaborationOpening.value || collaborationStopping.value || !!collaborationIssue.value || !!issue.value || !draft.value.name.trim())
const collaborationError = computed(() => {
  const problem = collaborationIssue.value
  if (problem?.kind === 'css') return t('themeCollaboration.cssError', { detail: problem.detail })
  if (problem?.kind === 'sample') return t('themeCollaboration.sampleError')
  return problem || collaboration.failure.value ? t('themeCollaboration.filesError') : ''
})

const progressText = ref('')
let assistantReply = ''
let stopped = false
let unsubscribe: (() => void) | undefined
let unsubscribeModels: (() => void) | undefined
let unsubscribeInspector: (() => void) | undefined
let stopSkillTheme: (() => void) | undefined

function updatePreview(paintPort?: MessagePort, captureTarget?: PreviewTarget): void {
  const snapshot = captureRequest?.snapshot
  if (snapshot && !paintPort) return
  const theme = { ...draft.value, name: draft.value.name.trim() || t('studio.copy'), values: {}, css: snapshot?.css ?? previewCss.value }
  const markdown = snapshot?.sampleMarkdown ?? sampleMarkdown.value
  frame.value?.contentWindow?.postMessage({ type: 'theme-preview', theme, source: snapshot ? false : source.value,
    sidebar: t('studio.sample'), markdown, demo: markdown === themeSample(locale.value).markdown, captureTarget }, '*', paintPort ? [paintPort] : [])
}
watch(css, value => {
  if (!issue.value) previewCss.value = value
}, { flush: 'sync' })
watch([() => draft.value.base, previewCss, source, sampleMarkdown], () => updatePreview())
function persistDraft(): void {
  localStorage.setItem(storageKey, JSON.stringify({ ...draft.value, previewCss: previewCss.value }))
}
function saveDraft(): void {
  temporaryDraft = false
  try { persistDraft() }
  catch { error.value = t('studio.storageError') }
}
function persistSample(value: string | null): void {
  if (value === null) localStorage.removeItem(sampleKey)
  else localStorage.setItem(sampleKey, value)
}
watch([draft, sampleOverride], saveDraft, { deep: true, flush: 'sync' })
watch(sampleOverride, value => {
  try { persistSample(value) }
  catch { error.value = t('studio.storageError') }
}, { flush: 'sync' })

function sendInspectorMode(): void {
  frame.value?.contentWindow?.postMessage({ type: 'theme-preview-inspector', open: inspectorOpen.value }, '*')
}
function previewReady(): void {
  updatePreview()
  sendInspectorMode()
}
function inspectorChanged(open: boolean): void {
  inspectorOpen.value = open
  if (open) tab.value = 'css'
  else selectorChoices.value = []
  sendInspectorMode()
}
async function setInspector(open: boolean): Promise<void> {
  try {
    await ipc.invoke('mt::theme::set-inspector', open)
  } catch {
    error.value = t('studio.inspectorFailed')
  }
}
async function useSelectedRule(): Promise<void> {
  const selected = choice.value
  if (!selected || !inspectorOpen.value || busy.value || issue.value || choicesCss.value !== css.value) return
  finishTyping()
  showBase.value = false
  await nextTick()
  sourceEditor.value?.useSelector(selected)
  finishTyping()
}
async function previewEvent(event: MessageEvent): Promise<void> {
  const preview = frame.value
  if (!preview || event.source !== preview.contentWindow) return
  const data = event.data
  if (data?.type === 'theme-preview-ready') {
    previewReady()
  } else if (data?.type === 'theme-preview-selectors' && inspectorOpen.value) {
    const choices: SelectorChoice[] = data.choices
    selectorChoices.value = choices
    choicesCss.value = data.css
    if (!choices.some(item => item.selector === chosenSelector.value)) {
      chosenSelector.value = (choices.find(item => item.offset !== null) ?? choices[0])?.selector ?? ''
    }
  } else if (data?.type === 'theme-preview-point' && inspectorOpen.value) {
    if (!Number.isFinite(data.x) || !Number.isFinite(data.y) ||
      data.x < 0 || data.y < 0 || data.x >= preview.clientWidth || data.y >= preview.clientHeight) return
    const bounds = preview.getBoundingClientRect()
    try {
      await ipc.invoke('mt::theme::inspect-element', bounds.left + preview.clientLeft + data.x,
        bounds.top + preview.clientTop + data.y)
    } catch {
      error.value = t('studio.inspectorFailed')
    }
  }
}
function changeBase(event: Event): void {
  const base = (event.target as HTMLSelectElement).value
  finishTyping()
  const before = versionSnapshot()
  draft.value = { ...draft.value, base, id: `local:${base}:${draftUuid}` }
  void versions.record('manual', before, versionSnapshot())
}
function versionSnapshot(): ThemeSnapshot {
  return { name: draft.value.name, base: draft.value.base, css: css.value, sample: sampleOverride.value,
    ...(issue.value ? { previewCss: previewCss.value } : {}) }
}
function startManualVersion(): void {
  manualVersionStart ??= versionSnapshot()
  clearTimeout(manualVersionTimer)
  manualVersionTimer = setTimeout(finishManualVersion, 700)
}
function finishManualVersion(): void {
  clearTimeout(manualVersionTimer)
  const before = manualVersionStart
  manualVersionStart = undefined
  if (before) void versions.record('manual', before, versionSnapshot())
}
function openVersionHistory(): void {
  finishTyping()
  void versions.open(versionSnapshot())
  versionDialogOpen.value = true
}
function closeVersionHistory(): void {
  versionDialogOpen.value = false
  versions.close()
}
async function restoreVersion(entry: ThemeVersion): Promise<void> {
  if (leaving || props.switching || busy.value || saving.value || versionFailed.value || versionRestoring.value) return
  versionRestoring.value = true
  finishTyping()
  const before = versionSnapshot()
  const { base, name, css: restoredCss, sample, previewCss: restoredPreviewCss } = entry.snapshot
  draft.value = { ...draft.value, id: `local:${base}:${draftUuid}`, base, name, css: restoredCss }
  sampleOverride.value = sample
  if (issue.value) {
    previewCss.value = restoredPreviewCss ?? ''
    saveDraft()
  }
  undoStack.value = []
  await versions.record('restore', before, versionSnapshot(), { restoredAt: entry.time })
  versionRestoring.value = false
}
function currentEdits(): DraftEdits {
  return { css: css.value, sample: sampleOverride.value }
}
function matchesCurrentEdits(edits: DraftEdits): boolean {
  return edits.css === css.value && edits.sample === sampleOverride.value
}
function restoreEdits(edits: DraftEdits): void {
  draft.value.css = edits.css
  sampleOverride.value = edits.sample
}
function remember(before: DraftEdits | undefined): void {
  if (before && !matchesCurrentEdits(before)) undoStack.value = [...undoStack.value.slice(-29), before]
}
function finishTyping(): void {
  finishManualVersion()
  remember(typingStart.value)
  typingStart.value = undefined
}
function finishGeneration(): void {
  remember(generationStart)
  generationStart = undefined
  const version = generationVersion
  generationVersion = undefined
  if (version) void versions.record('ai', version.before, versionSnapshot(), { model: version })
}
function typeCss(value: string): void {
  if (leaving || props.switching || saving.value) return
  if (busy.value) {
    if (!stopped) stop()
    finishGeneration()
  }
  typingStart.value ??= currentEdits()
  startManualVersion()
  draft.value.css = value
}
function undo(): void {
  if (leaving || props.switching) return
  finishTyping()
  const previous = undoStack.value.pop()
  if (previous) {
    const before = versionSnapshot()
    restoreEdits(previous)
    void versions.record('undo', before, versionSnapshot())
  }
}
async function prepareToLeave(): Promise<void> {
  if (saving.value || collaborationOpening.value || collaborationStopping.value) throw new Error('studioBusy')
  leaving = true
  if (active.value && !stopped) stop()
  await history.whenIdle()
  finishTyping()
  if (collaborationDirectory.value) {
    await collaboration.stop()
    if (collaborationDirectory.value) throw new Error('collaborationStopFailed')
  }
  if (!temporaryDraft) {
    persistDraft()
    persistSample(sampleOverride.value)
  }
  await versions.whenIdle()
}
function resumeDraft(): void {
  if (!leaving) return
  leaving = false
}
function copyDraft(): { theme: LocalTheme; sample: string | null } {
  return { theme: editableTheme(draft.value), sample: sampleOverride.value }
}
defineExpose({ prepareToLeave, resumeDraft, copyDraft })

function prepareCollaborationDirectory(): Promise<string> {
  if (workspacePreparation) return workspacePreparation
  workspacePreparation = (async() => {
    if (chatWorking.value || leaving || props.switching || !!issue.value) throw new Error('theme-editor-busy')
    if (!collaborationDirectory.value) {
      finishTyping()
      saveDraft()
      await collaboration.start(draft.value.id.split(':')[2])
    }
    const synced = await collaboration.flush()
    if (!synced || !collaborationDirectory.value || leaving) throw new Error('theme-workspace-unavailable')
    return collaborationDirectory.value
  })().finally(() => { workspacePreparation = undefined })
  return workspacePreparation
}

async function showCollaborationDirectory(copy: boolean): Promise<void> {
  try {
    await prepareCollaborationDirectory()
    if (copy) await collaboration.copyDirectory()
    else {
      await collaboration.openDirectory()
      if (!collaborationNotice.value) collaborationMenu.value?.hidePopover()
    }
  } catch { collaborationNotice.value = copy ? 'copyError' : 'openError' }
}
function applyCollaborationFiles(files: Partial<ThemeCollaborationFiles>): void {
  const cssChanged = files.css !== undefined && files.css !== css.value
  const sampleChanged = files.sampleMarkdown !== undefined && files.sampleMarkdown !== sampleMarkdown.value
  if (!cssChanged && !sampleChanged) return
  if (busy.value) {
    if (!stopped) stop()
    finishGeneration()
  }
  finishTyping()
  const before = currentEdits()
  const versionBefore = versionSnapshot()
  if (cssChanged) draft.value.css = files.css
  if (sampleChanged) sampleOverride.value = files.sampleMarkdown ?? null
  remember(before)
  void versions.record('collaboration', versionBefore, versionSnapshot())
}

function skillTheme(): SkillTheme {
  const { id, name, base } = draft.value
  return { id, name, base, scope: 'draft' }
}

async function measureDraftTheme(id: string, probe: SkillThemeProbe): Promise<unknown> {
  await nextTick()
  const preview = frame.value?.contentWindow
  if (!preview || issue.value || captureRequest) throw new Error('theme-preview-unavailable')
  if (leaving || props.switching || draft.value.id !== id) throw new Error('theme-target-changed')
  const original = previewCss.value
  const { port1, port2 } = new MessageChannel()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise<SkillWindowResponse>((resolve, reject) => {
      port1.onmessage = event => resolve(event.data)
      timeout = setTimeout(() => reject(new Error('theme-preview-unavailable')), 2000)
      preview.postMessage({ type: 'theme-preview-measure', probe }, '*', [port2])
    })
    if (leaving || props.switching || draft.value.id !== id || previewCss.value !== original || captureRequest) {
      throw new Error('theme-target-changed')
    }
    if (!result.ok) throw new Error(result.error)
    return result.value
  } finally {
    clearTimeout(timeout)
    port1.close()
    port2.close()
  }
}

function serveSkillTheme(): () => void {
  return listenForSkillRequests(async request => {
    if (leaving || props.switching) throw new Error('theme-editor-busy')
    const target = skillTheme()
    if (request.action === 'theme-info') return target
    if (request.action === 'measure-theme') return measureDraftTheme(request.id, request.probe)
    if (request.action === 'theme-workspace') {
      if (request.id !== target.id) throw new Error('theme-target-changed')
      const directory = await prepareCollaborationDirectory()
      if (leaving || props.switching || draft.value.id !== target.id) throw new Error('theme-target-changed')
      return { directory }
    }
    if (request.action !== 'read-theme' && request.action !== 'edit-theme') throw new Error('invalid-request')
    const original = css.value
    const base = baseCss.value
    const state = JSON.stringify([target, original])
    const revision = await skillRevision(state)
    if (request.action === 'read-theme') {
      return { ...target, css: original, baseCss: base, revision } satisfies SkillThemeSnapshot
    }
    if (leaving || props.switching || busy.value || saving.value || chatWorking.value) throw new Error('theme-editor-busy')
    if (target.id !== request.id || revision !== request.revision || state !== JSON.stringify([skillTheme(), css.value])) {
      throw new Error('theme-changed')
    }
    if (themeCssIssue(request.css)) throw new Error('invalid-theme-css')
    applyCollaborationFiles({ css: request.css })
    return { changed: request.css !== original }
  })
}
function selectTab(value: 'css' | 'ai'): void {
  finishTyping()
  tab.value = value
  if (value === 'ai' && inspectorOpen.value) void setInspector(false)
}
function updateProfiles(list: AiModelProfile[]): void {
  profiles.value = list
  if (!list.some(item => item.id === profileId.value)) profileId.value = list[0]?.id ?? ''
}
watch(profileId, id => localStorage.setItem(selectionKey, id))
watch([profileId, () => selectedProfile.value?.baseUrl, () => selectedProfile.value?.model,
  () => selectedProfile.value?.inputTypes?.includes('image')], () => {
  if (active.value) stop()
})

async function prepareCapture(token: string, target: PreviewTarget, turn?: AbortSignal, snapshot?: ThemeCollaborationFiles): Promise<void> {
  captureFinished()
  const controller = new AbortController()
  const pending: NonNullable<typeof captureRequest> = { token, controller, snapshot }
  captureRequest = pending
  externalCapturing.value = !!snapshot
  const signal = turn ? AbortSignal.any([turn, controller.signal]) : controller.signal
  try {
    signal.throwIfAborted()
    if (viewing.value) {
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => reject(signal.reason)
        viewerClosed = () => { signal.removeEventListener('abort', abort); resolve() }
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    // Keep the image viewer outside the composed pixels captured for the model.
    capturing = true
    await nextTick()
    signal.throwIfAborted()
    const { port1, port2 } = new MessageChannel()
    pending.port = port1
    port1.onmessage = (event: MessageEvent<PreparedPreview>) => {
      if (!signal.aborted) ipc.send('mt::theme::preview-painted', token, event.data)
    }
    updatePreview(port2, target)
  } catch {
    if (!signal.aborted) ipc.send('mt::theme::preview-painted', token, { error: 'Preview unavailable.' })
  }
}
function openModelSettings(): void {
  ipc.send('mt::open-setting-window', 'ai')
}
function viewScreenshot(src: string, number: number): void {
  if (capturing) queuedViewer = { src, number }
  else viewing.value = { src, number }
}
function captureFinished(): void {
  const restorePreview = !!captureRequest?.snapshot
  captureRequest?.controller.abort()
  captureRequest?.port?.postMessage('release')
  captureRequest?.port?.close()
  captureRequest = undefined
  externalCapturing.value = false
  viewerClosed = undefined
  capturing = false
  if (queuedViewer) {
    viewing.value = queuedViewer
    queuedViewer = undefined
  }
  if (restorePreview) updatePreview()
}
function captureCollaborationPreview(event: ThemeCollaborationCapture): void {
  if ('releaseCapture' in event) {
    if (captureRequest?.token === event.releaseCapture) captureFinished()
    return
  }
  if (chatWorking.value || captureRequest || viewing.value) {
    ipc.send('mt::theme::preview-painted', event.prepareCapture, { error: 'The theme preview is busy. Retry after the current operation.' })
    return
  }
  collaborationMenu.value?.hidePopover()
  void prepareCapture(event.prepareCapture, event.target, undefined, { css: event.css, sampleMarkdown: event.sampleMarkdown })
}
function closeScreenshot(): void {
  viewing.value = undefined
  viewerClosed?.()
  viewerClosed = undefined
}
function chatTitle(item: ThemeChat): string {
  return item.title || t('studio.untitledChat', { time: new Date(item.created).toLocaleString(locale.value) })
}
async function selectChat(id: string): Promise<void> {
  error.value = ''
  await history.select(id)
}
async function deleteChat(item: ThemeChat): Promise<void> {
  const confirmed = window.confirm(t('studio.confirmDeleteChat', { name: chatTitle(item) }))
  if (confirmed) await history.remove(item)
}
function confirmBranch(position: number): boolean {
  if (position === turns.value.length - 1) return true
  return window.confirm(t('studio.confirmBranch'))
}
function cssBeforeBranch(position: number): string {
  let restored = css.value
  for (let i = turns.value.length - 1; i >= position; i--) {
    const turn = turns.value[i]
    if (turn.draftId !== draft.value.id || restored !== turn.after) break
    restored = turn.before
  }
  return restored
}
function sampleBeforeBranch(position: number): string | null {
  let restored = sampleOverride.value
  for (let i = turns.value.length - 1; i >= position; i--) {
    const turn = turns.value[i]
    if (turn.draftId !== draft.value.id) break
    if (!turn.sample) continue
    if (restored !== turn.sample.after) break
    restored = turn.sample.before
  }
  return restored
}
function editsBeforeBranch(position: number): DraftEdits {
  return { css: cssBeforeBranch(position), sample: sampleBeforeBranch(position) }
}
function applySampleEdit(turn: ThemeTurn, markdown: string): void {
  turn.sample ??= { before: sampleOverride.value, after: markdown }
  turn.sample.after = markdown
  sampleOverride.value = markdown
}
async function retractTurn(position: number): Promise<void> {
  if (leaving || props.switching) return
  const confirmed = confirmBranch(position)
  if (!confirmed) return
  await history.withChat(async item => {
    const original = currentEdits()
    const draftId = draft.value.id
    const restored = editsBeforeBranch(position)
    const instruction = turns.value[position].prompt
    await history.retract(item, position)
    if (draftId === draft.value.id && matchesCurrentEdits(original)) {
      finishTyping()
      const versionBefore = versionSnapshot()
      restoreEdits(restored)
      remember(original)
      void versions.record('undo', versionBefore, versionSnapshot())
    }
    if (!prompt.value.trim()) prompt.value = instruction
    error.value = ''
  })
}
async function retryTurn(position: number): Promise<void> {
  if (externalCapturing.value || leaving || props.switching) return
  const confirmed = confirmBranch(position)
  if (!confirmed) return
  await history.withChat(item => generate(item, turns.value[position].prompt, position))
}
function promptEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229 || event.altKey) return
  if (event.shiftKey) {
    const input = event.currentTarget as HTMLTextAreaElement
    const caret = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd
    const nextBreak = input.value.indexOf('\n', caret)
    const end = nextBreak < 0 ? input.value.length : nextBreak
    // The native newline at this position keeps textarea undo, scrolling and maxlength intact.
    input.setSelectionRange(end, end)
    return
  }
  event.preventDefault()
  if (!event.repeat && prompt.value.trim()) void send()
}
async function send(): Promise<void> {
  const instruction = prompt.value.trim()
  if (leaving || props.switching || chatWorking.value || !chatReady.value || issue.value || !configLoaded.value || externalCapturing.value) return
  if (!profileId.value) {
    openModelSettings()
    return
  }
  if (!instruction) return
  await history.withChat(item => generate(item, instruction))
}
async function generate(item: ThemeChat, instruction: string, replaceFrom?: number): Promise<void> {
  if (leaving) return
  const original = currentEdits()
  const before = replaceFrom === undefined ? original : editsBeforeBranch(replaceFrom)
  const id = crypto.randomUUID()
  const turn = reactive<ThemeTurn>({ id, chatId: item.id, position: replaceFrom ?? turns.value.length, draftId: draft.value.id,
    before: before.css, after: before.css, prompt: instruction, reply: '', screenshots: [],
    diagnostics: replaceFrom === undefined ? [] : [...(turns.value[replaceFrom].diagnostics ?? [])] })
  await history.save(item, turn, replaceFrom)
  finishTyping()
  if (draft.value.id === turn.draftId && matchesCurrentEdits(original)) {
    const versionBefore = versionSnapshot()
    restoreEdits(before)
    void versions.record('undo', versionBefore, versionSnapshot())
  }
  else {
    turn.draftId = draft.value.id
    turn.before = css.value
    turn.after = css.value
  }
  turns.value.splice(turn.position, turns.value.length - turn.position, turn)
  if (replaceFrom === undefined) prompt.value = ''
  const controller = new AbortController()
  turnController = controller
  const profile = selectedProfile.value
  const withImages = imageCapable.value
  active.value = id
  stopped = false
  progressText.value = ''
  assistantReply = ''
  error.value = ''
  generationStart = currentEdits()
  generationVersion = { before: versionSnapshot(), profile: profileId.value, locale: locale.value }
  const phaseName = withImages ? 'tools' : 'text'
  let reported = false
  let interrupted = false
  try {
    if (leaving) {
      stopped = true
      return
    }
    const messages = turns.value.slice(-8).flatMap<ThemeMessage>(entry => {
      const user: ThemeMessage = { role: 'user', content: entry.prompt }
      return entry.reply ? [user, { role: 'assistant', content: entry.reply.slice(0, maxThemeMessageLength) }] : [user]
    })
    const request = { id, profileId: profileId.value, base: draft.value.base, css: css.value, baseCss: baseCss.value,
      sampleMarkdown: sampleMarkdown.value, messages }
    const result = withImages && profile
      ? await ipc.invoke('mt::theme::generate-with-tools', { ...request, previewTools: { baseUrl: profile.baseUrl } })
      : await ipc.invoke('mt::theme::generate', request)
    if (stopped || active.value !== id) return
    if (typeof result === 'string') {
      draft.value.css = result
    } else if ('cancelled' in result) {
      interrupted = true
    } else if ('diagnostic' in result) {
      turn.diagnostics ??= []
      turn.diagnostics.push(result.diagnostic)
      reported = true
      throw new Error(result.diagnostic.reason)
    } else {
      draft.value.css = result.css
      if (isThemeSample(result.sampleMarkdown) && turn.sample?.after !== result.sampleMarkdown) {
        applySampleEdit(turn, result.sampleMarkdown)
      }
      if (result.reply) assistantReply = result.reply
    }
    turn.after = css.value
  } catch (cause) {
    if (!stopped && active.value === id) {
      if (isCancelledRequest(cause)) {
        interrupted = true
        return
      }
      if (!reported) {
        turn.diagnostics ??= []
        turn.diagnostics.push({ time: new Date().toISOString(), requestId: id, phase: phaseName,
          model: profile?.model ?? profileId.value, requestType: profile?.requestType, inputCss: turn.before,
          reason: cause instanceof Error ? cause.message : String(cause), assistantText: '', wireBytes: 0, replyBytes: 0 })
      }
      error.value = modelError(cause, t)
    }
  } finally {
    captureFinished()
    if (active.value === id) {
      const changed = generationStart !== undefined && !matchesCurrentEdits(generationStart)
      finishGeneration()
      const status = stopped ? t('studio.stopped') : interrupted ? t('studio.interrupted') : error.value
      turn.reply = assistantReply || status || t(changed ? 'studio.updated' : 'studio.unchanged')
      if (assistantReply && status) turn.notice = [turn.notice, status].filter(Boolean).join('\n')
      active.value = ''
      turnController = undefined
      await history.save(item, turn)
    }
  }
}
function stop(): void {
  stopped = true
  turnController?.abort()
  void ipc.invoke('mt::theme::cancel', active.value).catch(() => {})
}
async function saveTheme(apply: boolean): Promise<void> {
  if (leaving || saveDisabled.value) return
  saveOptions.value?.hidePopover()
  saving.value = true
  error.value = ''
  try {
    const synced = await collaboration.flush()
    if (!synced) { error.value = t('themeCollaboration.applyError'); return }
    finishTyping()
    const before = versionSnapshot()
    const theme = JSON.parse(JSON.stringify(draft.value)) as LocalTheme
    const saved = await ipc.invoke('mt::theme::save', theme, apply)
    if (!saved) { error.value = t('studio.storageError'); return }
    const savedSnapshot = { ...before, name: saved.name }
    const kind = apply ? 'apply' : 'save'
    if (saved.id === theme.id) {
      draft.value.name = saved.name
      saveDraft()
      await versions.record(kind, before, savedSnapshot)
    } else {
      await versions.fork(saved.id.split(':')[2], kind, before, savedSnapshot)
    }
    emit('saved', saved, apply)
  } catch { error.value = t('studio.storageError') }
  finally { saving.value = false }
}
async function exportTheme(): Promise<void> {
  themeFilesMenu.value?.hidePopover()
  if (!isLocalTheme(draft.value)) { error.value = t('studio.nameRequired'); return }
  const filename = draft.value.name.replace(/[^\p{L}\p{N} _-]/gu, '-')
  const json = JSON.stringify(draft.value, null, 2)
  try {
    const path = await window.electron.dialog.showSave({
      title: t('studio.export'), defaultPath: filename + '.theme.json', filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (path) await window.fileUtils.writeFile(path, json)
  } catch { error.value = t('studio.storageError') }
}
async function exportDiagnostics(turn: ThemeTurn): Promise<void> {
  try {
    const path = await window.electron.dialog.showSave({
      title: t('studio.exportDiagnostics'), defaultPath: 'theme-chat-' + turn.id + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (path) await window.fileUtils.writeFile(path, JSON.stringify({ prompt: turn.prompt, attempts: turn.diagnostics }, null, 2))
  } catch { storageError.value = t('studio.historyError') }
}
function chooseThemeImport(): void {
  themeFilesMenu.value?.hidePopover()
  themePicker.value?.click()
}
async function importTheme(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    if (file.size > 1024 * 1024) throw new Error('size')
    const text = await file.text()
    const parsed: unknown = JSON.parse(text)
    if (!isLocalTheme(parsed)) throw new Error('invalid')
    emit('imported', parsed)
  } catch { error.value = t('studio.invalidFile') }
}
onMounted(async() => {
  stopSkillTheme = serveSkillTheme()
  if (!temporaryDraft) void versions.ensure(versionSnapshot())
  window.addEventListener('beforeunload', finishPendingVersions)
  void history.open()
  window.addEventListener('message', previewEvent)
  unsubscribeInspector = ipc.on('mt::theme::inspector-changed', (_event, open) => inspectorChanged(open))
  void ipc.invoke('mt::theme::inspector-state').then(inspectorChanged).catch(() => { error.value = t('studio.inspectorFailed') })
  unsubscribe = ipc.on('mt::theme::progress', (_event, id, change) => {
    const turn = turns.value.at(-1)
    if (id !== active.value || id !== turn?.id || !chat.value) return
    if ('releaseCapture' in change) {
      if (captureRequest?.token === change.releaseCapture) captureFinished()
      return
    }
    if (stopped) return
    if ('prepareCapture' in change) {
      if (!turnController) return
      draft.value.css = change.css
      progressText.value = t('ai.checkingPreview')
      void prepareCapture(change.prepareCapture, change.target, turnController.signal)
      return
    }
    if ('screenshot' in change) {
      turn.screenshots.push(change.screenshot)
    } else if ('message' in change) {
      assistantReply = change.message
      progressText.value = change.message
      turn.reply = change.message
    } else if ('sampleMarkdown' in change) {
      applySampleEdit(turn, change.sampleMarkdown)
      progressText.value = t('studio.updated')
    } else {
      draft.value.css = change.css
      turn.after = change.css
      progressText.value = t('studio.updated')
    }
    void history.save(chat.value, turn).catch(() => { storageError.value = t('studio.historyError') })
  })
  unsubscribeModels = ipc.on('mt::ai::changed', (_event, list) => updateProfiles(list))
  try {
    updateProfiles(await ipc.invoke('mt::ai::list'))
  } catch (cause) { error.value = modelError(cause, t) }
  finally { configLoaded.value = true }
})
function finishPendingVersions(): void {
  finishManualVersion()
  if (active.value) finishGeneration()
}
watch([turns, progressText], async() => {
  await nextTick()
  if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight
}, { deep: true })
onBeforeUnmount(() => {
  stopSkillTheme?.()
  window.removeEventListener('beforeunload', finishPendingVersions)
  finishPendingVersions()
  versions.close()
  captureFinished()
  if (active.value) {
    stop()
    finishGeneration()
  }
  active.value = ''
  history.close()
  unsubscribe?.()
  unsubscribeInspector?.()
  unsubscribeModels?.()
  window.removeEventListener('message', previewEvent)
})
</script>

<style scoped>
.theme-studio {
  --studio-divider: var(--editorColor10);
  --studio-outline: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 18%);
  --studio-muted: var(--editorColor60);
  --studio-toolbar: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 2%);
  --studio-canvas: color-mix(in srgb, var(--editorBgColor), var(--editorColor) 5%);
  --studio-hover: var(--editorColor04);
  --studio-tint: var(--themeColor10);
  box-sizing: border-box;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  color: var(--editorColor);
  background: var(--editorBgColor);
  font: 13px/1.55 system-ui, sans-serif;
}

.theme-studio :deep(button), .theme-name, select, textarea {
  box-sizing: border-box;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--studio-outline);
  border-radius: 6px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  font: inherit;
}
.theme-studio :deep(button) { cursor: pointer; }
button:disabled, select:disabled { opacity: .5; cursor: default; }
.theme-studio :deep(:focus-visible) { outline: 2px solid var(--themeColor); outline-offset: 1px; }

.studio-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  min-height: 56px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--studio-divider);
  background: var(--studio-toolbar);
}
.draft-controls { display: flex; align-items: center; gap: 10px; min-width: 0; }
.theme-studio .theme-name {
  width: min(100%, 26ch);
  min-height: 34px;
  flex: 0 1 26ch;
  border-color: transparent;
  font-weight: 600;
  background: transparent;
  text-overflow: ellipsis;
}
.theme-studio .theme-name:hover { border-color: var(--studio-divider); }
.select-control {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
  border-radius: 6px;
  color: var(--studio-muted);
}
.select-control:hover { background: var(--studio-hover); }
.select-control select {
  display: block;
  width: 100%;
  min-height: 30px;
  appearance: none;
  border: 0;
  padding: 4px 22px 4px 8px;
  color: inherit;
  background: transparent;
  text-overflow: ellipsis;
}
.select-control::after {
  content: '';
  position: absolute;
  inset-inline-end: 8px;
  inset-block-start: calc(50% - 4px);
  width: 5px;
  height: 5px;
  border-right: 1px solid currentColor;
  border-bottom: 1px solid currentColor;
  transform: rotate(45deg);
  pointer-events: none;
}
.base-control { flex: 0 1 auto; max-width: 48%; }
.base-control::before {
  content: '';
  position: absolute;
  inset-inline-start: -6px;
  height: 18px;
  border-inline-start: 1px solid var(--studio-divider);
}
.base-control select { padding-inline-start: 24px; }
.base-control > svg { position: absolute; inset-inline-start: 6px; pointer-events: none; }
.preview-switch {
  display: inline-flex;
  justify-self: center;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--studio-canvas);
}
.preview-switch button, .tools-bar button, .theme-studio .toolbar-action, .primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  white-space: nowrap;
}
.preview-switch button {
  min-height: 28px;
  padding: 3px 8px;
  border-radius: 5px;
  background: transparent;
  color: var(--studio-muted);
}
.preview-switch button[aria-pressed=true] {
  background: var(--editorBgColor);
  color: var(--editorColor);
  font-weight: 600;
  box-shadow: 0 1px 4px var(--editorColor10);
}
.theme-studio .toolbar-action {
  min-height: 32px;
  padding: 4px 8px;
  background: transparent;
  color: var(--studio-muted);
}
.theme-studio .toolbar-action:enabled:hover, .theme-studio .toolbar-action[aria-pressed=true] {
  background: var(--studio-hover);
  color: var(--editorColor);
}
.theme-studio .primary {
  min-height: 33px;
  padding: 5px 12px;
  border-radius: 7px;
  background: var(--buttonPrimaryBgColor);
  color: var(--buttonPrimaryFontColor);
  font-weight: 600;
}
.theme-studio .primary:enabled:hover { background: var(--buttonPrimaryBgColorHover); }
.theme-save { display: flex; justify-self: end; }
.theme-save .save-theme { border-start-end-radius: 0; border-end-end-radius: 0; }
.theme-save .save-options-trigger {
  anchor-name: --theme-save-options;
  padding-inline: 7px;
  border-inline-start: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}
.theme-save .primary:focus-visible { z-index: 1; }
.save-options {
  position: fixed;
  position-anchor: --theme-save-options;
  inset: auto;
  inset-block-start: anchor(end);
  inset-inline-end: anchor(end);
  margin: 4px 0 0;
  padding: 4px;
  border: 1px solid var(--studio-outline);
  border-radius: 7px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  box-shadow: 0 4px 14px var(--editorColor10);
}
.studio-toolbar svg, .tools-bar svg, .chat-picker svg, .compose svg, footer svg, .assistant-mark svg {
  width: 15px;
  height: 15px;
  flex: none;
}

main { min-height: 0; display: grid; grid-template-columns: minmax(0, 3fr) minmax(265px, 2fr); }
.panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
main.inspecting { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1.25fr) minmax(0, 1fr); }
main.inspecting .tools { border-inline-start: 0; border-top: 1px solid var(--studio-divider); }
.preview { background: var(--studio-canvas); }
.preview-frame {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  margin: clamp(12px, 2.3vw, 26px);
  /* Capture hit-tests the iframe corners, so the rounding stays on the frame around it. */
  padding: 4px;
  border: 1px solid var(--studio-divider);
  border-radius: 10px;
  box-shadow: 0 2px 8px var(--editorColor10);
}
.preview-frame iframe { width: 100%; flex: 1; min-height: 0; border: 0; }
.inspect-hint { margin: 0; padding: 0 14px 8px; }
.tools { border-inline-start: 1px solid var(--studio-divider); }
.tools-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 45px;
  padding-inline: 15px 10px;
  border-bottom: 1px solid var(--studio-divider);
}
.tabs { display: flex; align-self: stretch; min-width: 0; gap: clamp(8px, 1.4vw, 16px); }
.tabs button {
  min-height: 44px;
  margin-block-end: -1px;
  border-block-end: 2px solid transparent;
  border-radius: 0;
  padding: 0 1px;
  background: transparent;
  color: var(--studio-muted);
}
.tabs button:is(:hover, [aria-pressed=true]) { color: var(--editorColor); }
.tabs button[aria-pressed=true] { border-block-end-color: var(--themeColor); font-weight: 600; }
.tabs button[aria-pressed=true] svg { color: var(--themeColor); }
.tool-icon { flex: none; width: 33px; }
.source-options { padding: 8px 14px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.selector-action { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.selector-action select { max-width: min(28ch, 100%); font-family: monospace; }
.source-options label { display: flex; align-items: center; }
.tools .css-source { margin: 0 12px 12px; border: 1px solid var(--studio-divider); border-radius: 8px; }

.chat { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.chat-picker, .turn-actions { display: flex; align-items: center; gap: 6px; }
.chat-picker { padding: 8px 12px 5px; }
.new-chat { flex: none; }
.conversation { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
.conversation article { width: fit-content; max-width: 88%; margin-bottom: 15px; }
.conversation .user {
  margin-inline-start: auto;
  padding: 8px 11px;
  border-radius: 9px 9px 3px 9px;
  background: var(--studio-tint);
}
.conversation .assistant { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: start; gap: 8px; }
.assistant-mark { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; background: var(--studio-tint); color: var(--themeColor); }
.assistant-content { min-width: 0; }
.conversation p { margin: 0; }
.conversation p + p { margin-top: 4px; }
.turn-actions { margin-top: 4px; }
.turn-actions .toolbar-action { padding: 2px 6px; min-height: 24px; font-size: 12px; }
.captures { display: flex; flex-wrap: wrap; gap: 6px; margin-block: 2px 6px; }
.captures .capture { width: min(120px, 100%); overflow: hidden; padding: 0; cursor: zoom-in; }
.capture img { display: block; width: 100%; height: auto; }
.diagnostics { margin-top: 6px; font-size: 12px; }
.diagnostics summary { cursor: pointer; }
.diagnostics pre { max-height: 12em; overflow: auto; white-space: pre-wrap; user-select: text; }
.diagnostics code { display: block; user-select: text; }
.compose {
  display: grid;
  gap: 2px;
  margin: 0 14px 4px;
  padding: 7px;
  border: 1px solid var(--studio-outline);
  border-radius: 9px;
  background: var(--editorBgColor);
}
.compose textarea { display: block; width: 100%; min-height: 42px; padding: 3px 5px; border: 0; background: transparent; resize: vertical; }
.compose textarea::placeholder { color: var(--studio-muted); opacity: 1; }
.compose textarea:focus-visible { outline-offset: -1px; }
.composer-footer { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.composer-action { margin-inline-start: auto; flex: none; }
.profile-picker { flex: 0 1 auto; max-width: calc(100% - 56px); font-size: 12px; }
.compose .send-message { width: 32px; min-height: 32px; padding: 0; }
.privacy { margin: 0; padding: 4px 15px 9px; }
.muted { color: var(--studio-muted); font-size: 12px; }

footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 6px 12px;
  border-top: 1px solid var(--studio-divider);
  background: var(--studio-toolbar);
}
.footer-status { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 4px 9px; min-width: 0; }
.file-menu-trigger { anchor-name: --theme-files; }
.theme-studio .version-history-trigger { color: var(--themeColor); }
.collaboration-trigger { anchor-name: --theme-collaboration; margin-inline-start: auto; }
footer .menu-chevron { width: 11px; height: 11px; }
.footer-popover {
  position: fixed;
  inset: auto;
  bottom: anchor(top);
  position-try-fallbacks: flip-inline, flip-block, flip-inline flip-block;
  max-width: min(360px, calc(100vw - 24px));
  margin: 0 0 6px;
  border: 1px solid var(--studio-outline);
  border-radius: 8px;
  background: var(--editorBgColor);
  color: var(--editorColor);
  box-shadow: 0 4px 14px var(--editorColor10);
}
.theme-files-menu { position-anchor: --theme-files; left: anchor(left); padding: 4px; }
.theme-files-menu .toolbar-action { display: flex; justify-content: flex-start; width: 100%; }
.collaboration-menu { position-anchor: --theme-collaboration; right: anchor(right); padding: 12px; }
.collaboration-menu p { margin: 0; }
.collaboration-menu code { display: block; padding-block: 4px 8px; overflow-wrap: anywhere; user-select: text; }
.collaboration-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.collaboration-actions + p { margin-top: 8px; }
[role=alert] { color: var(--deleteColor); }

@media (max-width: 780px) {
  .studio-toolbar { gap: 8px; }
}
@media (max-width: 580px) {
  .studio-toolbar { grid-template-columns: minmax(0, 1fr) auto; }
  .preview-switch { grid-row: 2; grid-column: 1 / -1; }
  .theme-save { grid-row: 1; grid-column: 2; }
  .tabs { gap: 8px; }
}
</style>
