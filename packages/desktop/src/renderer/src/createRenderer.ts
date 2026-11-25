import { createApp } from 'vue'
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import Main from './Main.vue'
import pinia from './store'
import i18n from './i18n'

export const createRenderer = (routes: RouteRecordRaw[]) => createApp(Main)
  .use(pinia)
  .use(i18n)
  .use(createRouter({ history: createWebHashHistory(), routes }))
