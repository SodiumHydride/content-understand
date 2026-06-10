import { useEffect, useRef } from 'react'
import { fetchEventSource } from '@microsoft/fetch-event-source'

interface ProgressPayload {
  stage: string
  percent: number
  message: string
  elapsed_sec: number
}

interface CompletedPayload {
  result_slug: string
}

interface FailedPayload {
  error: string
}

interface UseJobSSEOptions {
  jobId: string | null | undefined
  baseUrl: string
  onProgress: (data: ProgressPayload) => void
  onComplete: (data: CompletedPayload) => void
  onFailed: (data: FailedPayload) => void
}

/**
 * Connects to the job SSE stream and dispatches events to callbacks.
 * Retries on network error after 3s unless the controller is aborted.
 */
export function useJobSSE({
  jobId,
  baseUrl,
  onProgress,
  onComplete,
  onFailed,
}: UseJobSSEOptions): void {
  const callbacksRef = useRef({ onProgress, onComplete, onFailed })
  callbacksRef.current = { onProgress, onComplete, onFailed }

  useEffect(() => {
    if (!jobId) return

    const controller = new AbortController()
    let retryTimeout: ReturnType<typeof setTimeout> | null = null

    const url = `${baseUrl.replace(/\/+$/, '')}/v1/jobs/${jobId}/stream`

    const connect = () => {
      fetchEventSource(url, {
        signal: controller.signal,

        onmessage(event) {
          if (event.event === 'progress') {
            try {
              const data: ProgressPayload = JSON.parse(event.data)
              callbacksRef.current.onProgress(data)
            } catch {
              // ignore malformed progress data
            }
          } else if (event.event === 'completed') {
            try {
              const data: CompletedPayload = JSON.parse(event.data)
              callbacksRef.current.onComplete(data)
            } catch {
              // ignore malformed completed data
            }
          } else if (event.event === 'failed') {
            try {
              const data: FailedPayload = JSON.parse(event.data)
              callbacksRef.current.onFailed(data)
            } catch {
              // ignore malformed failed data
            }
          }
        },

        onerror(err) {
          // AbortError means we intentionally stopped — do not retry
          if (controller.signal.aborted) return

          console.error('[useJobSSE] connection error, retrying in 3s:', err)
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
        console.error('[useJobSSE] fetch rejected, retrying in 3s:', err)
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
  }, [jobId, baseUrl])
}
