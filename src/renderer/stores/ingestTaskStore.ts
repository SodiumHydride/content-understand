import type { StateCreator } from 'zustand'
import type { AppState, IngestTaskSlice, UnderstandTask } from './types'
import i18n from '../lib/i18n'

export const createIngestTaskSlice: StateCreator<
  AppState,
  [],
  [],
  IngestTaskSlice
> = (set, get) => ({
  tasks: [],
  startUnderstandRunning: false,

  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),

  updateTask: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
    })),

  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  startUnderstand: async (url) => {
    if (get().startUnderstandRunning) return
    set({ startUnderstandRunning: true })
    const { startIngest, pollJob } = await import('../lib/sidecar')
    const configOk = await get().pushEngineConfig()
    if (!configOk) {
      const id = crypto.randomUUID()
      get().addTask({
        id,
        url,
        status: 'failed',
        error: i18n.t('errors.configSyncFailed'),
        createdAt: new Date().toISOString()
      })
      set({ startUnderstandRunning: false })
      return
    }
    const id = crypto.randomUUID()
    const abortController = new AbortController()
    const task: UnderstandTask = {
      id,
      url,
      status: 'processing',
      progress: { stage: 'resolve', percent: 5, message: '' },
      createdAt: new Date().toISOString(),
      abortController
    }
    get().addTask(task)
    set({ inputUrl: '', viewMode: 'capture', selectedSlug: null })

    try {
      const jobId = await startIngest(url)
      if (!jobId) {
        get().updateTask(id, {
          status: 'failed',
          error: i18n.t('errors.engineOffline')
        })
        return
      }

      let resultSlug: string | null = null
      let sseFailed = false

      try {
        const { fetchEventSource } = await import('@microsoft/fetch-event-source')
        const base = await window.api.getSidecarBase()
        if (!base) throw new Error('no sidecar base')
        const streamUrl = `${base.replace(/\/+$/, '')}/v1/jobs/${jobId}/stream`

        resultSlug = await new Promise<string | null>((resolve, reject) => {
          const sseAbort = new AbortController()
          const onParentAbort = () => sseAbort.abort()
          abortController.signal.addEventListener('abort', onParentAbort, { once: true })

          fetchEventSource(streamUrl, {
            signal: sseAbort.signal,
            openWhenHidden: true,

            onmessage(event) {
              if (event.event === 'progress') {
                try {
                  const data = JSON.parse(event.data)
                  get().updateTask(id, {
                    progress: {
                      stage: data.stage,
                      percent: data.percent,
                      message: data.message,
                      elapsed_sec: data.elapsed_sec
                    }
                  })
                } catch { /* ignore */ }
              } else if (event.event === 'completed') {
                try {
                  const data = JSON.parse(event.data)
                  sseAbort.abort()
                  resolve(data.result_slug ?? null)
                } catch { /* ignore */ }
              } else if (event.event === 'failed') {
                try {
                  const data = JSON.parse(event.data)
                  sseAbort.abort()
                  reject(new Error(data.error || 'SSE failed'))
                } catch { /* ignore */ }
              }
            },

            onerror(err) {
              if (sseAbort.signal.aborted) return
              sseAbort.abort()
              reject(err)
            },
          }).catch(reject)

          const cleanup = () => abortController.signal.removeEventListener('abort', onParentAbort)
          sseAbort.signal.addEventListener('abort', cleanup, { once: true })
        })
      } catch {
        sseFailed = true
      }

      if (sseFailed) {
        resultSlug = await pollJob(jobId, (progress) => {
          get().updateTask(id, { progress })
        }, abortController.signal)
      }

      get().updateTask(id, { status: 'completed', slug: resultSlug ?? undefined })
      await get().refreshLibrary()
      const slug = resultSlug ?? get().library[0]?.slug
      if (slug) {
        set({ viewMode: 'journal', selectedSlug: slug })
      }
    } catch (e) {
      get().updateTask(id, {
        status: 'failed',
        error: e instanceof Error ? e.message : 'failed'
      })
    } finally {
      set({ startUnderstandRunning: false })
    }
  }
})
