<template>
  <section class="pref-theme">
    <header class="theme-page-header">
      <h4>{{ t('preferences.theme.title') }}</h4>
      <div class="theme-actions">
        <button
          type="button"
          class="theme-button"
          @click="openStudio(false)"
        >
          <EditPen aria-hidden="true" />
          {{ t('studio.create') }}
        </button>
        <button
          v-if="currentLocal && !currentLocal.catalog"
          type="button"
          class="theme-button"
          @click="openStudio(true)"
        >
          {{ t('studio.edit') }}
        </button>
      </div>
    </header>
    <p
      v-if="studioError"
      role="alert"
    >
      {{ studioError }}
    </p>

    <section
      id="setting-theme"
      class="theme-mode"
      aria-labelledby="theme-mode-title"
    >
      <div
        id="setting-followSystemTheme"
        class="theme-mode-heading"
      >
        <h5 id="theme-mode-title">
          {{ t('preferences.theme.mode') }}
        </h5>
        <div
          class="theme-segments theme-mode-segments"
          role="group"
          aria-labelledby="theme-mode-title"
        >
          <button
            v-for="mode in modes"
            :key="mode.key"
            type="button"
            :aria-pressed="followSystemTheme === mode.follow"
            :disabled="changing"
            @click="changeMode(mode.follow)"
          >
            {{ t(mode.key) }}
          </button>
        </div>
      </div>
      <div class="theme-mode-choices">
        <theme-choice
          v-for="slot in slots"
          :id="slot.key === 'theme' ? undefined : `setting-${slot.key}`"
          :key="slot.key"
          :description="slot.key === 'theme' ? t('preferences.theme.currentTheme') : preferenceLabel(slot.key)"
          :name="selectionLabel(slot.id)"
          :theme-id="slot.id"
          :local="library.find(item => item.id === slot.id)"
          :active="theme === slot.id"
          :tone="slot.filter"
          @choose="chooseSource('local', slot.filter)"
        />
      </div>
    </section>

    <div
      class="theme-sources"
      role="group"
      :aria-label="t('preferences.theme.source')"
    >
      <button
        v-for="tab in sources"
        :key="tab"
        type="button"
        :aria-pressed="source === tab"
        @click="chooseSource(tab)"
      >
        <Collection
          v-if="tab === 'local'"
          aria-hidden="true"
        />
        <Connection
          v-else
          aria-hidden="true"
        />
        {{ t(`preferences.theme.${tab}`) }}
      </button>
    </div>
    <div class="theme-catalog-tools">
      <div
        class="theme-segments"
        role="group"
        :aria-label="t('preferences.theme.filterLabel')"
      >
        <button
          v-for="tone in filters"
          :key="tone"
          type="button"
          :aria-pressed="filter === tone"
          @click="filter = tone"
        >
          {{ t(`preferences.theme.filter.${tone}`) }}
        </button>
      </div>
      <div class="theme-search">
        <el-input
          v-model="query"
          :aria-label="t('preferences.theme.searchThemes')"
          :placeholder="t('preferences.theme.searchThemes')"
          clearable
          :prefix-icon="Search"
        />
        <button
          v-if="source === 'online'"
          type="button"
          class="theme-button"
          :disabled="loading"
          :aria-label="t('preferences.theme.refresh')"
          :title="t('preferences.theme.refresh')"
          @click="loadCatalog(true)"
        >
          <Refresh aria-hidden="true" />
        </button>
      </div>
    </div>
    <div
      v-if="visibleThemes.length"
      class="theme-card-grid"
    >
      <article
        v-for="choice in visibleThemes"
        :key="choice.key"
        class="theme-card"
        :class="{ 'is-active': choice.id === theme }"
      >
        <theme-preview
          :name="choice.base"
          :local="choice.local"
          :image="choice.image"
        />
        <div class="theme-card-title">
          <h5>{{ choice.name }}</h5>
          <span>{{ choice.meta }} · {{ t(`preferences.theme.filter.${toneOf(choice.base)}`) }}</span>
        </div>
        <div class="theme-actions theme-card-actions">
          <button
            v-if="choice.id || choice.remote?.compatible"
            type="button"
            class="theme-button"
            :aria-label="`${t('preferences.theme.preview')} · ${choice.name}`"
            @click="openPreview(choice)"
          >
            {{ t('preferences.theme.preview') }}
          </button>
          <button
            v-if="!choice.id && choice.remote && !choice.remote.compatible"
            type="button"
            class="theme-button"
            disabled
          >
            {{ t('preferences.theme.incompatible', { version: choice.remote.minAppVersion }) }}
          </button>
          <template v-else>
            <button
              type="button"
              class="theme-button"
              :class="{ 'is-primary': !hasSelection(choice) || canUpdate(choice) }"
              :aria-disabled="hasSelection(choice) && !canUpdate(choice) ? true : undefined"
              :aria-label="`${actionLabel(choice)} · ${choice.name}`"
              :disabled="changing"
              @click="activate(choice)"
            >
              {{ actionLabel(choice) }}
            </button>
            <button
              v-if="!choice.id"
              type="button"
              class="theme-button"
              :aria-label="`${t('preferences.theme.installOnly')} · ${choice.name}`"
              :disabled="changing"
              @click="install(choice, false)"
            >
              {{ t('preferences.theme.installOnly') }}
            </button>
          </template>
          <button
            v-if="source === 'local' && choice.local"
            type="button"
            class="theme-button"
            :aria-label="`${removalLabel(choice.local)} · ${choice.name}`"
            :disabled="changing"
            @click="beginRemoval(choice.local)"
          >
            {{ removalLabel(choice.local) }}
          </button>
        </div>
      </article>
    </div>
    <p
      v-if="catalogStatus"
      role="status"
      class="theme-info"
    >
      {{ catalogStatus }}
    </p>
    <p
      v-if="notice"
      role="status"
      class="theme-info"
    >
      {{ notice }}
    </p>
    <p
      v-if="error && !removing && !previewChoice"
      role="alert"
      class="theme-info theme-error"
    >
      {{ error }}
    </p>

    <details
      id="setting-customCss"
      class="custom-css"
    >
      <summary>{{ preferenceLabel('customCss') }}</summary>
      <textarea
        class="custom-css-input"
        rows="10"
        :aria-label="preferenceLabel('customCss')"
        :value="customCss"
        @change="setCustomCss"
      />
    </details>
    <preview-dialog
      v-if="previewChoice"
      :choices="previewChoices"
      :choice="previewChoice"
      :current="currentLocal ?? currentBase"
      :current-name="selectionLabel(currentLocal?.id ?? currentBase)"
      :release="previewRelease"
      :action-label="actionLabel(previewChoice)"
      :action-disabled="hasSelection(previewChoice) && !canUpdate(previewChoice)"
      :busy="changing"
      :can-compare="previewChoice.id !== theme || canUpdate(previewChoice)"
      :error="error"
      @select="selectPreview"
      @close="closePreview"
      @apply="applyPreview"
    />
    <el-dialog
      v-if="removing"
      :model-value="true"
      append-to-body
      align-center
      width="min(420px, 90vw)"
      class="theme-removal-dialog"
      :title="removalLabel(removing)"
      :show-close="!changing"
      :close-on-press-escape="!changing"
      :close-on-click-modal="false"
      @close="cancelRemoval"
    >
      <p>{{ t('preferences.theme.confirmRemoval', { name: removing.name }) }}</p>
      <p v-if="removalFallback">
        {{ removalFallback }}
      </p>
      <p
        v-if="error"
        role="alert"
        class="theme-error"
      >
        {{ error }}
      </p>
      <template #footer>
        <el-button
          :disabled="changing"
          @click="cancelRemoval"
        >
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="danger"
          :loading="changing"
          @click="removeTheme"
        >
          {{ removalLabel(removing) }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Collection, Connection, EditPen, Refresh, Search } from '@element-plus/icons-vue'
import { localThemeList, themeSelectionPatch, type LocalTheme } from '@shared/localTheme'
import { themeCatalogBase, type ThemeCatalogSnapshot } from '@shared/themeCatalog'
import type { UserPreferencesPatch } from '@shared/types/preferences'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { isDarkThemeId, localThemeDisplayName, themeBaseId } from 'common/theme'
import { usePreferencesStore } from '@/store/preferences'
import { preferenceLabel } from '../registry'
import ThemeChoice from './choice.vue'
import ThemePreview from './preview.vue'
import PreviewDialog from './previewDialog.vue'
import { themes, themeLabel, type ThemeChoiceItem } from './config'

const { t } = useI18n()
const store = usePreferencesStore()
const { theme, followSystemTheme, lightModeTheme, darkModeTheme, customCss } = storeToRefs(store)
const ipc = window.electron.ipcRenderer
const modes = [
  { key: 'preferences.theme.followSystemTheme', follow: true },
  { key: 'preferences.theme.fixed', follow: false }
]
const sources = ['local', 'online'] as const
const filters = ['all', 'light', 'dark'] as const
type Source = typeof sources[number]
type Filter = typeof filters[number]

const toneOf = (id: string): 'light' | 'dark' => isDarkThemeId(id) ? 'dark' : 'light'
const activeTone = computed(() => toneOf(theme.value))
const defaultFilter = (): Filter => followSystemTheme.value ? activeTone.value : 'all'
const source = ref<Source>('local')
const filter = ref<Filter>(defaultFilter())
const query = ref('')
const catalog = ref<ThemeCatalogSnapshot>()
const changing = ref(false)
const loading = ref(false)
const notice = ref('')
const error = ref('')
const studioError = ref('')
const previewKey = ref('')
const removing = ref<LocalTheme>()
const removalFallback = computed(() => {
  const target = removing.value
  if (!target || ![theme.value, lightModeTheme.value, darkModeTheme.value].includes(target.id)) return ''
  return t('preferences.theme.removalFallback', { base: themeLabel(target.base) })
})
const library = computed(() => localThemeList(store.localThemes))
const currentLocal = computed(() => library.value.find(item => item.id === theme.value))
const currentBase = computed(() => {
  const base = themeBaseId(theme.value)
  return themes.some(item => item.name === base) ? base : 'light'
})
const installed = computed(() => new Map(library.value.flatMap(local => local.catalog ? [[local.catalog.id, local] as const] : [])))
const slots = computed(() => followSystemTheme.value ? [
  { key: 'lightModeTheme', id: lightModeTheme.value, filter: 'light' },
  { key: 'darkModeTheme', id: darkModeTheme.value, filter: 'dark' }
] as const : [{ key: 'theme', id: theme.value, filter: 'all' }] as const)

const localChoices = computed<ThemeChoiceItem[]>(() => [
  ...themes.map(({ name: id }) => ({ key: id, id, base: id, name: themeLabel(id), meta: t('preferences.theme.builtIn') })),
  ...library.value.map(local => {
    const meta = t(local.catalog ? 'preferences.theme.installed' : 'preferences.theme.custom')
    return { key: local.id, id: local.id, base: local.base, name: localThemeDisplayName(local.name, meta), local, meta }
  })
])
const selectionLabel = (id: string): string => localChoices.value.find(choice => choice.id === id)?.name ?? themeLabel(id)
const onlineChoices = computed<ThemeChoiceItem[]>(() => (catalog.value?.themes ?? []).map(remote => {
  const local = installed.value.get(remote.id)
  return {
    key: `online:${remote.id}`, id: local?.id, base: remote.base, name: remote.name, local, remote,
    image: remote.preview ? new URL(remote.preview, themeCatalogBase).href : undefined,
    meta: local ? `${remote.author} · ${t('preferences.theme.installed')}` : remote.author
  }
}))
const previewChoices = computed(() => [...localChoices.value, ...onlineChoices.value.filter(choice =>
  choice.remote?.compatible && (!choice.id || canUpdate(choice) || choice.key === previewKey.value)
)])
const previewChoice = computed(() => previewChoices.value.find(choice => choice.key === previewKey.value))
const previewRelease = computed(() => {
  const choice = previewChoice.value
  return choice && (!choice.id || canUpdate(choice)) ? choice.remote : undefined
})
const visibleThemes = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  const choices = source.value === 'local' ? localChoices.value : onlineChoices.value
  return choices
    .filter(item => (filter.value === 'all' || toneOf(item.base) === filter.value) &&
      [item.name, item.remote?.author].some(value => value?.toLocaleLowerCase().includes(normalized)))
    .sort((a, b) => Number(isDarkThemeId(a.base)) - Number(isDarkThemeId(b.base)))
})
const catalogStatus = computed(() => {
  if (source.value === 'online') {
    if (loading.value) return t('preferences.theme.loading')
    if (catalog.value?.status === 'unavailable') return t('preferences.theme.unavailable')
    if (catalog.value?.status === 'cached') return t(visibleThemes.value.length ? 'preferences.theme.cached' : 'preferences.theme.cachedNoResults')
    if (catalog.value?.themes.length === 0) return t('preferences.theme.emptyCatalog')
  }
  return visibleThemes.value.length === 0 ? t('preferences.theme.noResults') : ''
})

watch([followSystemTheme, activeTone], () => {
  if (source.value === 'local') filter.value = defaultFilter()
})

function chooseSource(tab: Source, tone?: Filter): void {
  if (source.value === tab && tone === undefined) return
  source.value = tab
  query.value = ''
  filter.value = tone ?? (tab === 'local' ? defaultFilter() : 'all')
  notice.value = ''
  error.value = ''
  if (tab === 'online' && !catalog.value) void loadCatalog(false)
}

async function loadCatalog(refresh: boolean): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    catalog.value = await ipc.invoke('mt::theme::catalog', refresh)
  } catch {
    catalog.value = catalog.value?.themes.length
      ? { ...catalog.value, status: 'cached' }
      : { status: 'unavailable', themes: [] }
  } finally {
    loading.value = false
  }
}

function deferred(choice: ThemeChoiceItem): boolean {
  return followSystemTheme.value && toneOf(choice.base) !== activeTone.value
}

function hasSelection(choice: ThemeChoiceItem): boolean {
  const slot = toneOf(choice.base) === 'dark' ? darkModeTheme.value : lightModeTheme.value
  return !!choice.id && (choice.id === theme.value || (deferred(choice) && choice.id === slot))
}

function canUpdate(choice: ThemeChoiceItem): boolean {
  return !!choice.remote?.compatible && !!choice.local?.catalog && choice.remote.revision > choice.local.catalog.revision
}

function actionLabel(choice: ThemeChoiceItem): string {
  const tone = toneOf(choice.base)
  if (canUpdate(choice)) return t('preferences.theme.update')
  if (choice.id === theme.value) return t('preferences.theme.active')
  if (hasSelection(choice)) return t(`preferences.theme.assigned.${tone}`)
  if (!choice.id) return t(deferred(choice) ? `preferences.theme.installFor.${tone}` : 'preferences.theme.installAndApply')
  return t(deferred(choice) ? `preferences.theme.setFor.${tone}` : 'preferences.theme.apply')
}

async function changePreferences(request: () => Promise<boolean>, failure: string, success = ''): Promise<boolean> {
  if (changing.value) return false
  changing.value = true
  error.value = ''
  notice.value = ''
  try {
    const persisted = await request()
    if (!persisted) {
      error.value = failure
      return false
    }
    notice.value = success
    return true
  } catch {
    error.value = failure
    return false
  } finally {
    changing.value = false
  }
}

async function saveThemePreferences(patch: UserPreferencesPatch): Promise<boolean> {
  const result = await ipc.invoke('mt::preferences::update', patch)
  return result.status === 'persisted'
}

function selectionNotice(choice: ThemeChoiceItem): string {
  const key = deferred(choice) ? `deferred.${toneOf(choice.base)}` : 'applied'
  return t(`preferences.theme.${key}`, { name: choice.name })
}

function changeMode(enabled: boolean): void {
  if (enabled === followSystemTheme.value) return
  void changePreferences(() => saveThemePreferences({ followSystemTheme: enabled }), t('preferences.theme.changeFailed'))
}

async function activate(choice: ThemeChoiceItem): Promise<boolean> {
  if (canUpdate(choice)) return install(choice, false)
  if (hasSelection(choice)) return false
  if (!choice.id) return install(choice, true)
  const patch = themeSelectionPatch(store, choice.id, activeTone.value === 'dark')
  return changePreferences(() => saveThemePreferences(patch), t('preferences.theme.changeFailed'), selectionNotice(choice))
}

async function install(choice: ThemeChoiceItem, apply: boolean): Promise<boolean> {
  const remote = choice.remote
  if (!remote?.compatible) return false
  const success = apply ? selectionNotice(choice) : t(choice.id ? 'preferences.theme.updated' : 'preferences.theme.installedNotice', { name: choice.name })
  return changePreferences(async() => {
    const preferences = await ipc.invoke('mt::theme::install', remote.id, remote.revision, apply)
    return preferences !== null
  }, t('preferences.theme.installFailed'), success)
}

function selectPreview(key: string): void {
  error.value = ''
  previewKey.value = key
}

function openPreview(choice: ThemeChoiceItem): void {
  selectPreview(choice.id && choice.remote && !canUpdate(choice) ? choice.id : choice.key)
}

function closePreview(): void {
  selectPreview('')
}

async function applyPreview(): Promise<void> {
  const choice = previewChoice.value
  if (!choice) return
  const applied = await activate(choice)
  if (applied) closePreview()
}

function removalLabel(target: LocalTheme): string {
  return t(target.catalog ? 'preferences.theme.uninstallTheme' : 'preferences.theme.deleteTheme')
}

function beginRemoval(target: LocalTheme): void {
  error.value = ''
  removing.value = target
}

function cancelRemoval(): void {
  if (changing.value) return
  error.value = ''
  removing.value = undefined
}

async function removeTheme(): Promise<void> {
  const target = removing.value
  if (!target) return
  const removed = await changePreferences(async() => {
    const preferences = await ipc.invoke('mt::theme::delete', target.id)
    return preferences !== null
  }, t('preferences.theme.removalFailed'))
  if (removed) removing.value = undefined
}

async function openStudio(editing: boolean): Promise<void> {
  studioError.value = ''
  try {
    await ipc.invoke('mt::theme::open', theme.value, editing)
  } catch {
    studioError.value = t('studio.openFailed')
  }
}

function setCustomCss(event: Event): void {
  store.SET_SINGLE_PREFERENCE({ type: 'customCss', value: (event.target as HTMLTextAreaElement).value })
}
</script>

<style scoped>
.pref-theme { max-width: 880px; margin-inline: auto; }
.theme-page-header,
.theme-mode-heading,
.theme-catalog-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.theme-page-header { margin-bottom: 18px; }
.theme-page-header h4 { font-size: 26px; font-weight: 650; }
.theme-actions,
.theme-search { display: flex; flex-wrap: wrap; gap: 6px; }
.theme-button,
.theme-segments button,
.theme-sources button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--editorColor);
  font: inherit;
  cursor: pointer;
}
.theme-button {
  min-height: 32px;
  border-color: var(--editorColor10);
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 12px;
}
.theme-button:hover,
.theme-segments button:hover,
.theme-sources button:hover { background: var(--editorColor04); }
.theme-button.is-primary {
  color: var(--buttonPrimaryFontColor);
  background: var(--buttonPrimaryBgColor);
  border-color: var(--buttonPrimaryBgColor);
}
.theme-button.is-primary:hover { background: var(--buttonPrimaryBgColorHover); }
.theme-button[aria-disabled='true'] { border-color: transparent; background: var(--themeColor10); cursor: default; }
.theme-button:disabled,
.theme-segments button:disabled { opacity: .65; cursor: default; }
.theme-button svg,
.theme-sources svg { width: 15px; height: 15px; flex: none; }
.theme-mode {
  padding: 12px;
  border: 1px solid var(--editorColor10);
  border-radius: 8px;
  background: var(--editorColor04);
}
.theme-mode-heading { margin-bottom: 10px; }
.theme-mode-heading h5 { margin: 0; }
.theme-mode-choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr));
  gap: 8px;
}
.theme-segments { display: flex; flex-wrap: wrap; gap: 3px; }
.theme-mode-segments { padding: 2px; border: 1px solid var(--editorColor10); background: var(--editorBgColor); border-radius: 6px; }
.theme-segments button { padding: 4px 8px; border-radius: 4px; font-size: 12px; }
.theme-segments button[aria-pressed='true'] { background: var(--themeColor10); border-color: var(--themeColor20); font-weight: 600; }
.theme-sources { display: flex; gap: 18px; margin-top: 12px; border-bottom: 1px solid var(--editorColor10); }
.theme-sources button { padding: 9px 2px; border-width: 0 0 2px; font-size: 14px; }
.theme-sources button[aria-pressed='true'] { border-bottom-color: var(--themeColor); font-weight: 600; }
.theme-catalog-tools { margin: 10px 0; }
.theme-search { flex: 0 1 240px; flex-wrap: nowrap; }
.theme-search .el-input { flex: 1; min-width: 0; }
.theme-search .theme-button { flex: none; }
.theme-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(172px, 100%), 1fr)); gap: 10px; }
.theme-card { min-width: 0; display: flex; flex-direction: column; padding: 5px; border: 1px solid var(--editorColor10); border-radius: 7px; }
.theme-card.is-active { border-color: var(--themeColor); }
.theme-card-title { min-width: 0; overflow-wrap: anywhere; padding: 6px 4px; }
.theme-card-title h5 { margin: 0; font-weight: 600; font-size: 14px; }
.theme-card-title span,
.theme-info { color: var(--editorColor80); font-size: 12px; }
.theme-card-actions { margin-top: auto; padding: 1px 4px 3px; }
.theme-info { margin: 12px 0 0; }
.theme-error { color: var(--deleteColor); }
:global(.theme-removal-dialog) {
  --el-dialog-bg-color: var(--floatBgColor);
  --el-text-color-primary: var(--editorColor);
  --el-text-color-regular: var(--editorColor);
}
.custom-css { margin-top: 20px; padding-top: 10px; border-top: 1px solid var(--editorColor10); font-size: 13px; }
.custom-css summary { cursor: pointer; }
.custom-css-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 10px;
  padding: 9px;
  border: 1px solid var(--editorColor10);
  border-radius: 5px;
  background: transparent;
  color: var(--editorColor);
  resize: vertical;
  font-family: monospace;
}
</style>
