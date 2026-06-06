import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { Providers } from './providers'
import { useAppStore } from './stores/appStore'
import { checkHealth, autoDetectRuntime } from './lib/sidecar'

function AppInner(): React.JSX.Element {
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

        if (settings.autoStartLocal && settings.inferenceMode !== 'api_only') {
          void autoDetectRuntime({
            useUserOllama: settings.useOllamaIfAvailable,
            autoSetup: true
          })
        } else if (settings.inferenceMode !== 'api_only') {
          void autoDetectRuntime({ useUserOllama: settings.useOllamaIfAvailable })
        }
      }
    })()
  }, [
    refreshLibrary,
    setSidecarOnline,
    syncAppPaths,
    pushEngineConfig,
    settings.autoStartLocal,
    settings.inferenceMode,
    settings.useOllamaIfAvailable
  ])

  return <Layout />
}

export default function App(): React.JSX.Element {
  return (
    <Providers>
      <AppInner />
    </Providers>
  )
}
