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
  const startHealthPolling = useAppStore((s) => s.startHealthPolling)
  const settings = useAppStore((s) => s.settings)

  useEffect(() => {
    applyLocale()
  }, [applyLocale])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      await syncAppPaths()
      if (controller.signal.aborted) return
      const ok = await checkHealth()
      if (controller.signal.aborted) return
      setSidecarOnline(ok)
      if (ok) {
        startHealthPolling()
        await pushEngineConfig()
        if (controller.signal.aborted) return
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
    return () => { controller.abort() }
  }, [
    refreshLibrary,
    setSidecarOnline,
    startHealthPolling,
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
