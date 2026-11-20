import type { RouteRecordRaw } from 'vue-router'
import Preference from '@/pages/preference.vue'
import CategoryPage from '@/prefComponents/categoryPage.vue'
import { preferenceCategories } from '@/prefComponents/categories'

const parseSettingsPage = (type: string | null | undefined): string => {
  const category = type?.split('/')[1]
  return `/preference/${preferenceCategories.find(item => item.id === category)?.id ?? 'general'}`
}

const routes = (type: string | null | undefined): RouteRecordRaw[] => [
  {
    path: '/',
    redirect: parseSettingsPage(type)
  },
  {
    path: '/preference',
    component: Preference,
    children: [
      { path: '', redirect: '/preference/general' },
      ...preferenceCategories.map(category => ({
        path: category.id,
        name: category.id,
        component: category.id === 'markdown'
          ? () => import('@/prefComponents/markdown/index.vue')
          : category.id === 'keybindings' ? () => import('@/prefComponents/keybindings/index.vue') : CategoryPage,
        props: { category: category.id }
      }))
    ]
  }
]

export default routes
