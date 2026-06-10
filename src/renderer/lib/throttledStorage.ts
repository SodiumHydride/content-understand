/**
 * Throttled localStorage wrapper for zustand persist middleware.
 *
 * During rapid state updates (force layout animation, drag operations),
 * the default zustand persist middleware writes to localStorage on EVERY
 * setState call. With 60fps animations over 300 frames, that's ~18,000
 * localStorage writes per animation cycle.
 *
 * This wrapper queues writes and flushes at most once per `interval` ms.
 * Reads always go directly to real storage (no stale-read risk).
 *
 * On `flush()` or before the page unloads, any pending write is flushed
 * synchronously to ensure no data loss.
 */

export function createThrottledStorage(
  baseStorage: Storage,
  interval = 500
): Storage {
  let pendingValue: string | null = null
  let pendingKey: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pendingKey !== null && pendingValue !== null) {
      baseStorage.setItem(pendingKey, pendingValue)
      pendingKey = null
      pendingValue = null
    }
  }

  // Flush on page unload to avoid losing the final state
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush)
  }

  return {
    getItem(key: string): string | null {
      // Always read from real storage — no caching
      return baseStorage.getItem(key)
    },

    setItem(key: string, value: string): void {
      pendingKey = key
      pendingValue = value

      if (timer === null) {
        timer = setTimeout(() => {
          flush()
        }, interval)
      }
    },

    removeItem(key: string): void {
      // Cancel any pending write for this key
      if (pendingKey === key) {
        pendingKey = null
        pendingValue = null
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      }
      baseStorage.removeItem(key)
    },

    get length() { return baseStorage.length },

    clear() {
      pendingKey = null
      pendingValue = null
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      baseStorage.clear()
    },

    key(index: number) { return baseStorage.key(index) }
  }
}
