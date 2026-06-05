import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { useAppStore } from './stores/appStore'
import { checkHealth, autoDetectRuntime } from './lib/sidecar'

export default function App(): React.JSX.Element {
  const applyLocale = useAppStore((s) => s.applyLocale)
  const syncAppPaths = useAppStore((s) => s.syncAppPaths)
  const pushEngineConfig = useAppStore((s) => s.pushEngineConfig)
  const refreshLibrary = useAppStore((s) => s.refreshLibrary)
  const setSidecarOnline = useAppStore((s) => s.setSidecarOnline)
  const settings = useAppStore((s) => s.settings)

  useEffect(() => {
    applyLocale()
  }, [applyLocale])

  useEffect(() => {
    void (async () => {
      await syncAppPaths()
      const ok = await checkHealth()
      setSidecarOnline(ok)
      if (ok) {
        await pushEngineConfig()
        await refreshLibrary()

        // Auto-detect local runtime if enabled and not cloud-only
        if (settings.autoStartLocal && settings.inferenceMode !== 'api_only') {
          void autoDetectRuntime()
        }
      }
    })()
  }, [refreshLibrary, setSidecarOnline, syncAppPaths, pushEngineConfig, settings.autoStartLocal, settings.inferenceMode])

  return <Layout />
}
