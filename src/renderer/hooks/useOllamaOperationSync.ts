import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useOllamaCatalog } from './useOllamaQueries'
import { useTaskStore } from '../stores/taskStore'

/** Keep TaskBar / task store aligned with live sidecar catalog operations. */
export function useOllamaOperationSync(): void {
  const { i18n } = useTranslation()
  const isZh = i18n.language.startsWith('zh')
  const { data: catalog } = useOllamaCatalog()
  const syncOllamaCatalog = useTaskStore((s) => s.syncOllamaCatalog)

  useEffect(() => {
    if (!catalog) return
    syncOllamaCatalog(catalog, isZh)
  }, [catalog, isZh, syncOllamaCatalog])
}
