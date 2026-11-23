import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Each original page owns its stylesheet. Keep its selectors local to the tab.
export function FeaturePage({ css, children }: { css: string; children: ReactNode }) {
  const [root, setRoot] = useState<ShadowRoot | null>(null)
  useEffect(() => {
    if (!root) return
    const element = root.host as HTMLElement, documentRoot = document.documentElement
    const sync = () => {
      element.dataset.theme = documentRoot.dataset.theme || ''
      element.dataset.backgroundStyle = documentRoot.dataset.backgroundStyle || ''
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(documentRoot, { attributes: true, attributeFilter: ['data-theme', 'data-background-style'] })
    return () => observer.disconnect()
  }, [root])
  return <div ref={node => { if (node && !node.shadowRoot) setRoot(node.attachShadow({ mode: 'open' })) }}>
    {root && createPortal(<><style>{css.replaceAll(':root', ':host')} </style>{children}</>, root)}
  </div>
}
