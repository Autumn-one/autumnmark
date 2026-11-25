<template>
  <div class="theme-library">
    <button
      class="library-trigger"
      :popovertarget="popupId"
      :aria-label="t('themeLibrary.title')"
      :title="t('themeLibrary.title')"
      :disabled="disabled"
      aria-haspopup="dialog"
    >
      <Collection aria-hidden="true" />
      <span>{{ t('themeLibrary.title') }}</span>
      <ArrowDown
        class="chevron"
        aria-hidden="true"
      />
    </button>
    <div
      :id="popupId"
      ref="popup"
      class="library-menu"
      popover="auto"
      role="dialog"
      :aria-label="t('themeLibrary.title')"
      @toggle="menuToggled"
      @keydown.esc="cancelDeleteOnEscape"
    >
      <template v-if="!creating && !pendingDelete">
        <div class="library-heading">
          <strong>{{ t('themeLibrary.title') }}</strong>
          <button
            class="new-theme"
            :disabled="disabled"
            @click="beginCreate"
          >
            <Plus aria-hidden="true" />
            {{ t('themeLibrary.newTheme') }}
          </button>
        </div>
        <section
          v-for="group in groups"
          :key="group.label"
          class="library-group"
          :aria-label="t(group.label)"
        >
          <h2>{{ t(group.label) }}</h2>
          <ul>
            <li
              v-for="item in group.items"
              :key="item.key"
              :class="{ current: item.id === currentId }"
            >
              <button
                class="theme-row"
                :aria-current="item.id === currentId || undefined"
                :disabled="disabled"
                :title="item.name"
                @click="selectTheme(item)"
              >
                <span
                  class="theme-swatch"
                  :class="{ dark: isDarkThemeId(item.base) }"
                  :style="{ backgroundColor: getThemeBackgroundColor(item.base) }"
                  aria-hidden="true"
                />
                <span class="theme-row-name">{{ item.name || t('themeLibrary.untitled') }}</span>
                <span
                  v-if="item.id === appliedId"
                  class="theme-row-status applied"
                >{{ t('themeLibrary.currentlyApplied') }}</span>
                <span
                  v-else-if="item.id === currentId"
                  class="theme-row-status"
                >{{ t('themeLibrary.editing') }}</span>
                <span
                  v-else-if="item.changed"
                  class="theme-row-status"
                >{{ t('themeLibrary.unapplied') }}</span>
              </button>
              <button
                type="button"
                class="delete-theme"
                :data-theme-key="item.key"
                :disabled="disabled"
                :aria-label="deleteLabel(item) + ' · ' + (item.name || t('themeLibrary.untitled'))"
                :title="deleteLabel(item)"
                @click="beginDelete(item)"
              >
                <Delete aria-hidden="true" />
              </button>
            </li>
          </ul>
        </section>
        <p
          v-if="!groups.length"
          class="library-empty"
        >
          {{ t('themeLibrary.empty') }}
        </p>
      </template>
      <div
        v-else-if="pendingDelete"
        class="delete-confirmation"
      >
        <div class="confirmation-heading">
          <span class="delete-mark"><Delete aria-hidden="true" /></span>
          <strong>{{ deleteLabel(pendingDelete) }}</strong>
        </div>
        <p>{{ t('themeLibrary.confirmDelete', { name: pendingDelete.name || t('themeLibrary.untitled') }) }}</p>
        <p v-if="pendingDelete.id === appliedId">
          {{ t('themeLibrary.deleteApplied') }}
        </p>
        <div class="confirmation-actions">
          <button
            ref="cancelButton"
            type="button"
            @click="cancelDelete"
          >
            {{ t('themeLibrary.cancel') }}
          </button>
          <button
            type="button"
            class="confirm-delete"
            :disabled="disabled"
            @click="deleteTheme"
          >
            {{ deleteLabel(pendingDelete) }}
          </button>
        </div>
      </div>
      <form
        v-else
        class="new-theme-form"
        @submit.prevent="createTheme"
      >
        <div class="library-heading">
          <strong>{{ t('themeLibrary.newTheme') }}</strong>
          <button
            type="button"
            @click="creating = false"
          >
            {{ t('themeLibrary.back') }}
          </button>
        </div>
        <label>{{ t('studio.name') }}<input
          ref="nameInput"
          v-model="name"
          maxlength="80"
          required
        ></label>
        <label>{{ t('studio.base') }}<select v-model="base">
          <option value="current">{{ t('themeLibrary.copyCurrent') }}</option>
          <option
            v-for="preset in themeBases"
            :key="preset"
            :value="preset"
          >
            {{ themeLabel(preset) }}
          </option>
        </select></label>
        <button
          class="create-draft"
          type="submit"
          :disabled="disabled || !name.trim()"
        >
          {{ t('themeLibrary.createDraft') }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, Collection, Delete, Plus } from '@element-plus/icons-vue'
import { getThemeBackgroundColor, isDarkThemeId } from 'common/theme'
import { themeBases } from '@shared/localTheme'
import { themeLabel } from './config'
import type { ThemeLibraryItem } from './themeDrafts'

const props = defineProps<{
  drafts: ThemeLibraryItem[]
  saved: ThemeLibraryItem[]
  currentId: string
  currentBase: string
  appliedId: string
  disabled: boolean
}>()
const emit = defineEmits<{
  open: []
  select: [item: ThemeLibraryItem]
  create: [name: string, base: string]
  remove: [item: ThemeLibraryItem]
}>()
const { t } = useI18n()
const popupId = useId()
const popup = ref<HTMLElement>()
const creating = ref(false)
const pendingDelete = ref<ThemeLibraryItem>()
const cancelButton = ref<HTMLButtonElement>()
const nameInput = ref<HTMLInputElement>()
const name = ref('')
const base = ref('light')
const groups = computed(() => [
  { label: 'themeLibrary.drafts', items: props.drafts },
  { label: 'themeLibrary.saved', items: props.saved }
].filter(group => group.items.length))

function menuToggled(event: ToggleEvent): void {
  if (event.newState === 'open') emit('open')
  else {
    creating.value = false
    pendingDelete.value = undefined
  }
}

function deleteLabel(item: ThemeLibraryItem): string {
  return t(item.saved ? 'themeLibrary.deleteTheme' : 'themeLibrary.deleteDraft')
}

async function beginDelete(item: ThemeLibraryItem): Promise<void> {
  pendingDelete.value = item
  await nextTick()
  cancelButton.value?.focus()
}

async function cancelDelete(): Promise<void> {
  const key = pendingDelete.value?.key
  pendingDelete.value = undefined
  await nextTick()
  if (key) popup.value?.querySelector<HTMLButtonElement>(`[data-theme-key="${CSS.escape(key)}"]`)?.focus()
}

function cancelDeleteOnEscape(event: KeyboardEvent): void {
  if (!pendingDelete.value) return
  event.preventDefault()
  void cancelDelete()
}

function deleteTheme(): void {
  const item = pendingDelete.value
  if (!item || props.disabled) return
  popup.value?.hidePopover()
  emit('remove', item)
}

async function beginCreate(): Promise<void> {
  name.value = t('themeLibrary.defaultName')
  base.value = props.currentBase
  creating.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

function createTheme(): void {
  const trimmed = name.value.trim()
  if (!trimmed || props.disabled) return
  popup.value?.hidePopover()
  emit('create', trimmed, base.value)
}

function selectTheme(item: ThemeLibraryItem): void {
  popup.value?.hidePopover()
  emit('select', item)
}
</script>

<style scoped>
.theme-library {
  --library-danger: color-mix(in srgb, var(--deleteColor) 72%, var(--editorColor));
  flex: none;
}
.theme-library button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 8px;
  border: 0;
  background: transparent;
  color: var(--studio-muted);
  text-align: start;
}
.theme-library button:enabled:hover { background: var(--studio-hover); color: var(--editorColor); }
.theme-library button:disabled { cursor: default; opacity: .5; }
.theme-library svg { width: 15px; height: 15px; flex: none; }
.theme-library .chevron { width: 11px; height: 11px; }
.library-trigger { anchor-name: --theme-library; white-space: nowrap; }
.library-menu {
  position: fixed;
  position-anchor: --theme-library;
  inset: auto;
  top: anchor(bottom);
  left: anchor(left);
  position-try-fallbacks: flip-inline, flip-block;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 24px));
  max-height: min(480px, calc(100dvh - 74px));
  overflow: auto;
  margin: 7px 0 0;
  padding: 10px;
  border: 1px solid var(--studio-outline);
  border-radius: 12px;
  color: var(--editorColor);
  background: var(--editorBgColor);
  box-shadow: 0 10px 24px var(--editorColor10);
}
.library-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 3px 9px 8px; }
.theme-library .new-theme { background: var(--studio-tint); color: var(--editorColor); font-weight: 600; }
.theme-library .new-theme:enabled:hover { background: var(--themeColor20); }
.library-group + .library-group { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--studio-divider); }
.library-group h2 { margin: 0; padding: 2px 8px 5px; color: var(--studio-muted); font-size: 12px; font-weight: 600; }
.library-group ul { display: grid; gap: 2px; list-style: none; margin: 0; padding: 0; }
.library-group li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 3px;
  padding-inline-end: 4px;
  border-radius: 7px;
}
.library-group li:is(:hover, :focus-within) { background: var(--studio-hover); }
.library-group li.current { background: var(--studio-tint); }
.theme-library .theme-row { min-height: 39px; gap: 8px; color: var(--editorColor); }
.theme-library .theme-row:enabled:hover { background: transparent; }
.theme-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme-row[aria-current=true] .theme-row-name { font-weight: 600; }
.theme-row-status {
  max-width: 38%;
  padding: 1px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 5px;
  background: var(--studio-hover);
  color: var(--studio-muted);
  font-size: 11px;
}
.theme-row-status.applied { background: var(--studio-tint); color: var(--themeColor); }
.theme-library .delete-theme {
  justify-content: center;
  width: 28px;
  min-height: 28px;
  padding: 0;
}
.theme-library .delete-theme:enabled:is(:hover, :focus-visible) {
  background: color-mix(in srgb, var(--deleteColor) 12%, transparent);
  color: var(--library-danger);
}
.library-empty { margin: 0; padding: 15px 8px; color: var(--studio-muted); text-align: center; }
.delete-confirmation { padding: 4px; }
.confirmation-heading { display: flex; align-items: center; gap: 8px; }
.delete-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--deleteColor) 12%, transparent);
  color: var(--library-danger);
}
.delete-confirmation p { margin: 8px 0; overflow-wrap: anywhere; color: var(--studio-muted); }
.confirmation-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
.theme-library .confirm-delete {
  padding-inline: 11px;
  background: color-mix(in srgb, var(--deleteColor) 12%, transparent);
  color: var(--library-danger);
  font-weight: 600;
}
.theme-library .confirm-delete:enabled:hover { background: color-mix(in srgb, var(--deleteColor) 22%, transparent); color: var(--library-danger); }
.theme-swatch {
  box-sizing: border-box; width: 32px; height: 24px; flex: none;
  border: 1px solid var(--studio-outline); border-radius: 5px; color: #28624d;
}
.theme-swatch.dark { color: #a1c9d4; }
.theme-swatch::before, .theme-swatch::after {
  content: ''; display: block; height: 2px; margin-inline-start: 6px; border-radius: 2px; background: currentColor;
}
.theme-swatch::before { width: 12px; margin-top: 6px; }
.theme-swatch::after { width: 17px; margin-top: 4px; opacity: .5; }
.new-theme-form label { display: grid; gap: 4px; margin: 6px; color: var(--studio-muted); }
.new-theme-form input, .new-theme-form select { width: 100%; box-sizing: border-box; }
.theme-library .create-draft {
  display: flex; margin: 10px 6px 4px auto; padding-inline: 11px;
  color: var(--buttonPrimaryFontColor); background: var(--buttonPrimaryBgColor); font-weight: 600;
}
.theme-library .create-draft:enabled:hover { color: var(--buttonPrimaryFontColorHover); background: var(--buttonPrimaryBgColorHover); }
@media (max-width: 860px) {
  .library-trigger span, .library-trigger .chevron { display: none; }
}
</style>
