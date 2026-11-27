import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import DocsChrome from '@/components/docs/DocsChrome'
import './docs.css'

export const metadata: Metadata = {
  title: {
    default: 'Documentation',
    template: '%s · MarkText Docs'
  },
  description:
    'Guides, reference and developer documentation for MarkText — the WYSIWYG markdown editor.'
}

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="bg-fx" />
      <div className="bg-grid" />
      <DocsChrome>{children}</DocsChrome>
    </>
  )
}
