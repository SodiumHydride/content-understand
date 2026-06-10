import type { StateCreator } from 'zustand'
import type { AppState, SettingsSlice, AppSettings, ProviderConfig, ProviderId, ModalityRoute } from './types'
import { PROVIDER_PRESETS, DEFAULT_MODALITY_ROUTE } from './types'
import { getEffectiveLocale } from '../lib/i18n'
import i18n from '../lib/i18n'
import { demoLibraryFor, isDemoLibrary } from './demoLibrary'
import { syncDocumentLocale } from '../lib/localeUi'

const CONTENT_TYPES = ['video', 'image', 'audio', 'article'] as const

function makeDefaultProviders(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {}
  for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
    providers[id] = {
      id: id as ProviderId,
      enabled: false,
      baseUrl: preset.baseUrl,
      apiKeys: '',
      models: [...preset.defaultModels],
      selectedModel: preset.defaultModels[0] ?? ''
    }
  }
  providers.openai_compat.enabled = true
  return providers
}

function makeDefaultModalityOverrides(): AppSettings['modalityOverrides'] {
  return {
    video: { ...DEFAULT_MODALITY_ROUTE },
    image: { ...DEFAULT_MODALITY_ROUTE },
    audio: { ...DEFAULT_MODALITY_ROUTE },
    article: { ...DEFAULT_MODALITY_ROUTE }
  }
}

export const defaultSettings: AppSettings = {
  locale: 'system',
  theme: 'system',
  vaultPath: '',
  cacheDir: '',
  modelsDir: '',
  providers: makeDefaultProviders(),
  defaultProvider: 'openai_compat',
  modalityOverrides: makeDefaultModalityOverrides(),
  inferenceMode: 'prefer_api',
  localPresetId: '',
  useOllamaIfAvailable: true,
  autoStartLocal: true,
  frameSettings: {
    fps: 1.0,
    maxFrames: 30,
    scale: '',
    strategy: 'uniform',
    numCtx: 16384
  },
  audioExtractSettings: {
    enabled: true,
    sampleRate: 16000
  },
  outputLanguage: 'zh',
  promptTemplate: '',
  cookiesPath: '',
  proxySettings: {
    httpProxy: '',
    githubMirror: '',
    ollamaMirror: ''
  },
  typography: {
    fontFamily: 'serif',
    fontSize: 16,
    lineHeight: 1.82
  }
}

export function migrateSettings(old: Partial<Record<string, unknown>>): AppSettings {
  if (old.providers) return old as AppSettings // already new format

  const providers = makeDefaultProviders()

  // Migrate apiKey/apiBase → openai_compat
  if (old.apiBase || old.apiKey) {
    providers.openai_compat = {
      ...providers.openai_compat,
      enabled: true,
      baseUrl: old.apiBase || '',
      apiKeys: old.apiKey || ''
    }
  }

  // Migrate mimoKeys → mimo
  if (old.mimoKeys) {
    providers.mimo = {
      ...providers.mimo,
      enabled: true,
      apiKeys: old.mimoKeys
    }
  }

  // Migrate geminiKeys → gemini
  if (old.geminiKeys) {
    providers.gemini = {
      ...providers.gemini,
      enabled: true,
      apiKeys: old.geminiKeys
    }
  }

  // Migrate per-modality backend+model → modalityOverrides
  const overrides = makeDefaultModalityOverrides()
  for (const ct of CONTENT_TYPES) {
    const backendKey = `${ct}Backend`
    const modelKey = `${ct}Model`
    const backend = old[backendKey]
    const model = old[modelKey]
    if (backend && backend !== 'openai_compat') {
      overrides[ct as keyof typeof overrides] = {
        providerId: backend as ProviderId,
        model: model || ''
      }
    } else if (model) {
      overrides[ct as keyof typeof overrides] = {
        providerId: 'openai_compat',
        model
      }
    }
  }

  // Determine defaultProvider from the most common backend
  const backendCounts = new Map<string, number>()
  for (const ct of CONTENT_TYPES) {
    const b = old[`${ct}Backend`] || 'openai_compat'
    backendCounts.set(b, (backendCounts.get(b) || 0) + 1)
  }
  let defaultProvider: ProviderId = 'openai_compat'
  let maxCount = 0
  for (const [b, count] of backendCounts) {
    if (count > maxCount) {
      maxCount = count
      defaultProvider = b as ProviderId
    }
  }

  return {
    locale: old.locale || 'system',
    vaultPath: old.vaultPath || '',
    cacheDir: old.cacheDir || '',
    modelsDir: old.modelsDir || '',
    providers,
    defaultProvider,
    modalityOverrides: overrides,
    inferenceMode: old.inferenceMode || 'prefer_api',
    localPresetId: old.localPresetId || '',
    useOllamaIfAvailable: old.useOllamaIfAvailable ?? true,
    autoStartLocal: old.autoStartLocal ?? true,
    frameSettings: old.frameSettings || { fps: 1.0, maxFrames: 30, scale: '', strategy: 'uniform', numCtx: 16384 },
    audioExtractSettings: old.audioExtractSettings || { enabled: true, sampleRate: 16000 },
    outputLanguage: old.outputLanguage || 'zh',
    promptTemplate: old.promptTemplate || '',
    cookiesPath: old.cookiesPath || '',
    proxySettings: old.proxySettings || { httpProxy: '', githubMirror: '', ollamaMirror: '' },
    typography: old.typography || { fontFamily: 'serif', fontSize: 16, lineHeight: 1.82 }
  }
}

export const createSettingsSlice: StateCreator<
  AppState,
  [],
  [],
  SettingsSlice
> = (set, get) => ({
  settings: defaultSettings,

  updateSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
    get().applyLocale()
  },

  updateProvider: (id, patch) => {
    set((s) => ({
      settings: {
        ...s.settings,
        providers: {
          ...s.settings.providers,
          [id]: { ...s.settings.providers[id], ...patch }
        }
      }
    }))
  },

  setModalityRoute: (modality, route) => {
    set((s) => ({
      settings: {
        ...s.settings,
        modalityOverrides: {
          ...s.settings.modalityOverrides,
          [modality]: route
        }
      }
    }))
  },

  applyLocale: () => {
    const lng = getEffectiveLocale(get().settings.locale)
    void i18n.changeLanguage(lng)
    syncDocumentLocale(lng)
    const lib = get().library
    if (isDemoLibrary(lib)) {
      set({ library: demoLibraryFor(lng) })
    }
  },

  syncAppPaths: async () => {
    const paths = await window.api.getAppPaths()
    set((s) => ({
      settings: {
        ...s.settings,
        vaultPath: paths.vault,
        cacheDir: paths.cache,
        modelsDir: paths.models
      }
    }))
  },

  pushEngineConfig: async (): Promise<boolean> => {
    const { pushConfig } = await import('../lib/sidecar')
    const ok = await pushConfig(get().settings)
    if (!ok) {
      console.warn('[appStore] pushEngineConfig failed — sidecar may be offline')
    }
    return ok
  }
})
