import bootstrapRenderer from './bootstrap'
import axios from './axios'
import './assets/symbolIcon'

import {
  ElAutocomplete, ElButton, ElCheckbox, ElCol, ElConfigProvider, ElDialog, ElDivider,
  ElDropdown, ElDropdownItem, ElDropdownMenu, ElForm, ElFormItem, ElIcon, ElInput,
  ElInputNumber, ElInputTag, ElOption, ElPopover, ElProgress, ElRow, ElScrollbar,
  ElSelect, ElSelectV2, ElSlider, ElSwitch, ElTabPane, ElTable, ElTableColumn,
  ElTabs, ElText, ElTooltip, ElTree
} from 'element-plus'
import './assets/styles/elementPlus'

import services from './services/index'
import Editor from './pages/app.vue'
import { createRenderer } from './createRenderer'

import './assets/styles/index.css'
import './assets/styles/printService.css'

bootstrapRenderer()
const app = createRenderer([
  { path: '/', redirect: '/editor' },
  { path: '/editor', component: Editor }
])

for (const component of [
  ElAutocomplete, ElButton, ElCheckbox, ElCol, ElConfigProvider, ElDialog, ElDivider,
  ElDropdown, ElDropdownItem, ElDropdownMenu, ElForm, ElFormItem, ElIcon, ElInput,
  ElInputNumber, ElInputTag, ElOption, ElPopover, ElProgress, ElRow, ElScrollbar,
  ElSelect, ElSelectV2, ElSlider, ElSwitch, ElTabPane, ElTable, ElTableColumn,
  ElTabs, ElText, ElTooltip, ElTree
]) {
  app.use(component)
}

app.config.globalProperties.$http = axios

;(services as unknown as Array<Record<string, unknown> & { name: string }>).forEach((s) => {
  app.config.globalProperties['$' + s.name] = s[s.name]
})

app.mount('#app')
