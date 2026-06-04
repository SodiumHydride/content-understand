import i18n from './i18n'

/** Section headings to surface above full note (comma-separated in locale files). */
export function getHighlightSectionTitles(): string[] {
  const raw = i18n.t('preview.highlightSections')
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isHighlightSection(title: string): boolean {
  const normalized = title.trim().toLowerCase()
  return getHighlightSectionTitles().some(
    (h) => h.toLowerCase() === normalized || normalized.includes(h.toLowerCase())
  )
}

export function syncDocumentLocale(lng: 'zh' | 'en'): void {
  document.documentElement.lang = lng === 'zh' ? 'zh-CN' : 'en'
  document.documentElement.dataset.locale = lng
}
