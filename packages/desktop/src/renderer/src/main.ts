import bootstrapRenderer from './bootstrap'
import axios from './axios'
import './assets/symbolIcon'

import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import en from 'element-plus/es/locale/lang/en'

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

app.use(ElementPlus, {
  locale: en
})

app.config.globalProperties.$http = axios

;(services as unknown as Array<Record<string, unknown> & { name: string }>).forEach((s) => {
  app.config.globalProperties['$' + s.name] = s[s.name]
})

app.mount('#app')
