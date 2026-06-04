import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from '../locales/zh.json'
import en from '../locales/en.json'
import { syncDocumentLocale } from './localeUi'

export type AppLocale = 'zh' | 'en' | 'system'

function resolveSystemLocale(): 'zh' | 'en' {
  const lang = navigator.language.toLowerCase()
  return lang.startsWith('zh') ? 'zh' : 'en'
}

export function getEffectiveLocale(pref: AppLocale): 'zh' | 'en' {
  if (pref === 'system') return resolveSystemLocale()
  return pref
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en }
  },
  lng: resolveSystemLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

i18n.on('languageChanged', (lng) => {
  syncDocumentLocale(lng.startsWith('zh') ? 'zh' : 'en')
})

syncDocumentLocale(resolveSystemLocale())

export default i18n
