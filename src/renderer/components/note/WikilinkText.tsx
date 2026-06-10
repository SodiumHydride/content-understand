import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../../stores/appStore'
import { splitTextWithWikilinks, resolveWikilinkTarget } from '../../lib/wikilink'

export function WikilinkText({ text, onNavigate }: { text: string; onNavigate: (slug: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const library = useAppStore((s) => s.library)
  const segments = splitTextWithWikilinks(text)
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') return seg.value
        const slug = resolveWikilinkTarget(seg.target, library)
        if (slug) {
          return (
            <span
              key={i}
              className="wikilink"
              onClick={(e) => { e.stopPropagation(); onNavigate(slug) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(slug) } }}
              role="link"
              tabIndex={0}
            >
              {seg.display}
            </span>
          )
        }
        return (
          <span key={i} className="wikilink wikilink-broken" title={`${t('search.notFound')}: ${seg.target}`}>
            {seg.display}
          </span>
        )
      })}
    </>
  )
}
