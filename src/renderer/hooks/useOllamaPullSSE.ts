import { useEffect, useRef } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'

// ─── SSE event payloads ──────────────────────────────────────────

export interface OllamaPullProgress {
  stage: string
  percent: number
  message: string
  total_bytes: number
  completed_bytes: number
  speed_bps: number
  elapsed_sec: number
}

export interface OllamaPullCompleted {
  preset_id: string
  status: string
}

export interface OllamaPullFailed {
  error: string
}

// ─── Hook options ────────────────────────────────────────────────

export interface UseOllamaPullSSEOptions {
  /** Active preset being pulled, or null to skip connection. */
  presetId: string | null | undefined
  baseUrl: string | null | undefined
  onProgress: (data: OllamaPullProgress) => void
  onComplete: (data: OllamaPullCompleted) => void
  onFailed: (data: OllamaPullFailed) => void
}

/**
 * Opens an SSE connection to `/v1/ollama/pull/stream` while a pull is active.
 * Dispatches progress / completed / failed events to the provided callbacks.
 * Cleans up the connection (AbortController) when presetId becomes null or on unmount.
 * Retries on transient network errors after 3 s unless aborted.
 */
export function useOllamaPullSSE({
  presetId,
  baseUrl,
  onProgress,
  onComplete,
  onFailed,
}: UseOllamaPullSSEOptions): void {
  const callbacksRef = useRef({ onProgress, onComplete, onFailed })
  callbacksRef.current = { onProgress, onComplete, onFailed }

  useEffect(() => {
    if (!presetId || !baseUrl) return

    const controller = new AbortController()
    let retryTimeout: ReturnType<typeof setTimeout> | null = null

    const url = `${baseUrl.replace(/\/+$/, '')}/v1/ollama/pull/stream`

    const connect = () => {
      fetchEventSource(url, {
        signal: controller.signal,

        onmessage(event) {
          if (event.event === 'progress') {
            try {
              const data: OllamaPullProgress = JSON.parse(event.data)
              callbacksRef.current.onProgress(data)
            } catch {
              // ignore malformed progress data
            }
          } else if (event.event === 'completed') {
            try {
              const data: OllamaPullCompleted = JSON.parse(event.data)
              callbacksRef.current.onComplete(data)
            } catch {
              // ignore malformed completed data
            }
          } else if (event.event === 'failed') {
            try {
              const data: OllamaPullFailed = JSON.parse(event.data)
              callbacksRef.current.onFailed(data)
            } catch {
              // ignore malformed failed data
            }
          }
        },

        onerror(err) {
          // AbortError means we intentionally stopped — do not retry
          if (controller.signal.aborted) return

          console.error('[useOllamaPullSSE] connection error, retrying in 3 s:', err)
          retryTimeout = setTimeout(() => {
            if (!controller.signal.aborted) {
              connect()
            }
          }, 3000)
        },

        openWhenHidden: true,
      }).catch((err) => {
        // fetch itself rejected (e.g. network down); retry unless aborted
        if (controller.signal.aborted) return
        console.error('[useOllamaPullSSE] fetch rejected, retrying in 3 s:', err)
        retryTimeout = setTimeout(() => {
          if (!controller.signal.aborted) {
            connect()
          }
        }, 3000)
      })
    }

    connect()

    return () => {
      if (retryTimeout !== null) {
        clearTimeout(retryTimeout)
      }
      controller.abort()
    }
  }, [presetId, baseUrl])
}
