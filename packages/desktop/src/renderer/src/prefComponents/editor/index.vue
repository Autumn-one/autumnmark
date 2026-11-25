<template>
  <div class="pref-editor">
    <h4 v-if="!embedded">
      {{ t('preferences.editor.title') }}
    </h4>
    <compound v-if="show('typography')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.editor.textEditor.title') }}
        </h6>
      </template>
      <template #children>
        <range
          id="setting-fontSize"
          :description="preferenceLabel('fontSize')"
          :value="fontSize"
          :min="12"
          :max="32"
          unit="px"
          :step="1"
          :on-change="(value) => onSelectChange('fontSize', value)"
        />
        <range
          id="setting-codeFontSize"
          :description="preferenceLabel('codeFontSize')"
          :value="codeFontSize"
          :min="12"
          :max="28"
          unit="px"
          :step="1"
          :on-change="(value) => onSelectChange('codeFontSize', value)"
        />
        <range
          id="setting-lineHeight"
          :description="preferenceLabel('lineHeight')"
          :value="lineHeight"
          :min="1.2"
          :max="2.0"
          :step="0.1"
          :on-change="(value) => onSelectChange('lineHeight', value)"
        />
        <font-text-box
          id="setting-editorFontFamily"
          multiple
          :description="preferenceLabel('editorFontFamily')"
          :value="editorFontFamily"
          :on-change="(value) => onSelectChange('editorFontFamily', value)"
        />
        <font-text-box
          id="setting-codeFontFamily"
          multiple
          :description="preferenceLabel('codeFontFamily')"
          :notes="preferenceNotes('codeFontFamily')"
          :only-monospace="true"
          :value="codeFontFamily"
          :on-change="(value) => onSelectChange('codeFontFamily', value)"
        />
        <text-box
          id="setting-editorLineWidth"
          :description="preferenceLabel('editorLineWidth')"
          :notes="preferenceNotes('editorLineWidth')"
          :input="editorLineWidth"
          default-value="800px / 80ch / 60%"
          :regex-validator="/^(?:$|[0-9]+(?:ch|px|%)$)/"
          :error-message="t('preferences.editor.textEditor.maxWidthInvalid')"
          :on-change="(value) => onSelectChange('editorLineWidth', value)"
        />
      </template>
    </compound>

    <compound v-if="show('code')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.editor.codeBlock.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          id="setting-codeBlockLineNumbers"
          :description="preferenceLabel('codeBlockLineNumbers')"
          :bool="codeBlockLineNumbers"
          :on-change="(value) => onSelectChange('codeBlockLineNumbers', value)"
        />
        <bool
          id="setting-trimUnnecessaryCodeBlockEmptyLines"
          :description="preferenceLabel('trimUnnecessaryCodeBlockEmptyLines')"
          :bool="trimUnnecessaryCodeBlockEmptyLines"
          :on-change="(value) => onSelectChange('trimUnnecessaryCodeBlockEmptyLines', value)"
        />
        <bool
          id="setting-wrapCodeBlocks"
          :description="preferenceLabel('wrapCodeBlocks')"
          :bool="wrapCodeBlocks"
          :on-change="(value) => onSelectChange('wrapCodeBlocks', value)"
        />
        <bool
          id="setting-compactMode"
          :description="preferenceLabel('compactMode')"
          :bool="compactMode"
          :on-change="(value) => onSelectChange('compactMode', value)"
        />
        <fieldset
          class="compact-limits"
          :aria-label="preferenceLabel('compactMode')"
          :disabled="!compactMode"
        >
          <label
            v-for="key in compactLimitKeys"
            :id="`setting-${key}`"
            :key="key"
          >
            <span>{{ preferenceLabel(key) }}</span>
            <input
              type="number"
              min="0"
              step="1"
              aria-describedby="compact-limit-hint"
              :value="preferenceStore[key]"
              @change="changeLimit(key, $event)"
            >
          </label>
          <span id="compact-limit-hint">{{ t('preferences.editor.misc.compactLimitHint') }}</span>
        </fieldset>
      </template>
    </compound>

    <compound v-if="show('writing')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.editor.writingBehavior.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          id="setting-autoPairBracket"
          :description="preferenceLabel('autoPairBracket')"
          :bool="autoPairBracket"
          :on-change="(value) => onSelectChange('autoPairBracket', value)"
        />
        <bool
          id="setting-autoPairMarkdownSyntax"
          :description="preferenceLabel('autoPairMarkdownSyntax')"
          :notes="preferenceNotes('autoPairMarkdownSyntax')"
          :bool="autoPairMarkdownSyntax"
          :on-change="(value) => onSelectChange('autoPairMarkdownSyntax', value)"
        />
        <bool
          id="setting-autoPairQuote"
          :description="preferenceLabel('autoPairQuote')"
          :bool="autoPairQuote"
          :on-change="(value) => onSelectChange('autoPairQuote', value)"
        />
        <cur-select
          id="setting-tabSize"
          :description="preferenceLabel('tabSize')"
          :notes="preferenceNotes('tabSize')"
          :value="tabSize"
          :options="getTabSizeOptions()"
          :on-change="(value) => onSelectChange('tabSize', value)"
        />
        <cur-select
          id="setting-textDirection"
          :description="preferenceLabel('textDirection')"
          :value="textDirection"
          :options="getTextDirectionOptions()"
          :on-change="(value) => onSelectChange('textDirection', value)"
        />
        <bool
          id="setting-autoCheck"
          :description="preferenceLabel('autoCheck')"
          :notes="preferenceNotes('autoCheck')"
          :bool="autoCheck"
          :on-change="(value) => onSelectChange('autoCheck', value)"
        />
      </template>
    </compound>

    <compound v-if="show('files')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.editor.fileRepresentation.title') }}
        </h6>
      </template>
      <template #children>
        <cur-select
          id="setting-endOfLine"
          :description="preferenceLabel('endOfLine')"
          :notes="preferenceNotes('endOfLine')"
          :value="endOfLine"
          :options="getEndOfLineOptions()"
          :on-change="(value) => onSelectChange('endOfLine', value)"
        />
        <cur-select
          id="setting-defaultEncoding"
          :description="preferenceLabel('defaultEncoding')"
          :value="defaultEncoding"
          :options="defaultEncodingOptions"
          :on-change="(value) => onSelectChange('defaultEncoding', value)"
        />
        <bool
          id="setting-autoGuessEncoding"
          :description="preferenceLabel('autoGuessEncoding')"
          :bool="autoGuessEncoding"
          :on-change="(value) => onSelectChange('autoGuessEncoding', value)"
        />
        <bool
          id="setting-autoNormalizeLineEndings"
          :description="preferenceLabel('autoNormalizeLineEndings')"
          :bool="autoNormalizeLineEndings"
          :on-change="(value) => onSelectChange('autoNormalizeLineEndings', value)"
        />
        <cur-select
          id="setting-trimTrailingNewline"
          :description="preferenceLabel('trimTrailingNewline')"
          :value="trimTrailingNewline"
          :options="getTrimTrailingNewlineOptions()"
          :on-change="(value) => onSelectChange('trimTrailingNewline', value)"
        />
      </template>
    </compound>

    <slot name="before-misc" />

    <compound v-if="show('writing')">
      <template #head>
        <h6 class="title">
          {{ t('preferences.editor.misc.title') }}
        </h6>
      </template>
      <template #children>
        <bool
          id="setting-hideQuickInsertHint"
          :description="preferenceLabel('hideQuickInsertHint')"
          :bool="hideQuickInsertHint"
          :on-change="(value) => onSelectChange('hideQuickInsertHint', value)"
        />
        <bool
          id="setting-hideLinkPopup"
          :description="preferenceLabel('hideLinkPopup')"
          :bool="hideLinkPopup"
          :on-change="(value) => onSelectChange('hideLinkPopup', value)"
        />
        <bool
          id="setting-sourceCodeLineNumbers"
          :description="preferenceLabel('sourceCodeLineNumbers')"
          :bool="sourceCodeLineNumbers"
          :on-change="(value) => onSelectChange('sourceCodeLineNumbers', value)"
        />
      </template>
    </compound>
  </div>
</template>

<script setup lang="ts">
import { preferenceLabel, preferenceNotes } from '@/prefComponents/registry'

import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { usePreferencesStore } from '@/store/preferences'
import type { PreferencesState } from '@/store/preferences'
import Compound from '../common/compound/index.vue'
import FontTextBox from '../common/fontTextBox/index.vue'
import Range from '../common/range/index.vue'
import CurSelect from '../common/select/index.vue'
import Bool from '../common/bool/index.vue'
import TextBox from '../common/textBox/index.vue'
import {
  getTabSizeOptions,
  getEndOfLineOptions,
  getTextDirectionOptions,
  getTrimTrailingNewlineOptions,
  getDefaultEncodingOptions
} from './config'

const props = withDefaults(defineProps<{ groups?: readonly string[]; embedded?: boolean }>(), {
  groups: () => ['all'],
  embedded: false
})
const show = (group: string): boolean => props.groups.includes('all') || props.groups.includes(group)

const { t } = useI18n()
const preferenceStore = usePreferencesStore()

const defaultEncodingOptions = getDefaultEncodingOptions()

const {
  fontSize,
  editorFontFamily,
  lineHeight,
  autoPairBracket,
  autoPairMarkdownSyntax,
  autoPairQuote,
  tabSize,
  endOfLine,
  textDirection,
  codeFontSize,
  codeFontFamily,
  codeBlockLineNumbers,
  trimUnnecessaryCodeBlockEmptyLines,
  hideQuickInsertHint,
  hideLinkPopup,
  autoCheck,
  sourceCodeLineNumbers,
  autoNormalizeLineEndings,
  compactMode,
  wrapCodeBlocks,
  editorLineWidth,
  defaultEncoding,
  autoGuessEncoding,
  trimTrailingNewline
} = storeToRefs(preferenceStore)

const onSelectChange = (type: keyof PreferencesState, value: unknown): void => {
  preferenceStore.SET_SINGLE_PREFERENCE({ type, value })
}

const compactLimitKeys = ['compactImageMaxHeight', 'compactVideoMaxHeight', 'compactCodeMaxLines'] as const

const changeLimit = (key: typeof compactLimitKeys[number], event: Event): void => {
  const input = event.target as HTMLInputElement
  const value = input.valueAsNumber
  if (input.validity.valid && Number.isSafeInteger(value) && value >= 0) {
    onSelectChange(key, value)
  } else {
    input.value = String(preferenceStore[key])
  }
}
</script>

<style scoped>
.compact-limits {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 20px;
  min-inline-size: 0;
  margin: 0;
  padding: 14px 16px;
  border: 0;
  border-radius: 6px;
  background: var(--editorColor04);
}

#compact-limit-hint {
  grid-column: 1 / -1;
  color: var(--editorColor80);
  font-size: 12px;
}

.compact-limits label {
  display: grid;
  align-content: end;
  gap: 6px;
  color: var(--editorColor80);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.compact-limits input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: var(--pref-control-height);
  padding-inline: 10px;
  font-family: inherit;
  font-size: 14px;
  color: var(--editorColor);
  background: var(--editorBgColor);
  border: var(--buttonBorder);
  border-radius: 4px;
}

.compact-limits input:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: -1px;
}

.compact-limits:disabled label {
  opacity: 0.55;
}

@container (max-width: 540px) {
  .compact-limits {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container (280px < width <= 540px) {
  .compact-limits label {
    grid-template-columns: minmax(0, 1fr) 6rem;
    align-items: center;
    gap: 16px;
  }
}

.pref-editor .image-ctrl {
  font-size: 14px;
  user-select: none;
  margin: 20px 0;
  color: var(--editorColor);
}

.pref-editor .image-ctrl label {
  display: block;
  margin: 20px 0;
}
</style>
