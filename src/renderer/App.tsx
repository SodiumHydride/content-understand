import { useEffect } from 'react'
import { Layout } from './components/Layout'
import { useAppStore } from './stores/appStore'
import { checkHealth } from './lib/sidecar'

export default function App(): React.JSX.Element {
  const applyLocale = useAppStore((s) => s.applyLocale)
  const refreshLibrary = useAppStore((s) => s.refreshLibrary)
  const setSidecarOnline = useAppStore((s) => s.setSidecarOnline)

  useEffect(() => {
    applyLocale()
  }, [applyLocale])

  useEffect(() => {
    void (async () => {
      const ok = await checkHealth()
      setSidecarOnline(ok)
      if (ok) await refreshLibrary()
    })()
  }, [refreshLibrary, setSidecarOnline])

  return <Layout />
}
