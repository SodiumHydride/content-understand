import { useEffect } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Traps keyboard focus within the first matching container element.
 * Also focuses the first focusable element on mount.
 *
 * @param containerSelector - CSS selector for the focus container
 * @param enabled - Whether the trap is active
 */
export function useFocusTrap(containerSelector: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const dialog = document.querySelector(containerSelector)
      if (!dialog) return
      const elements = (Array.from(dialog.querySelectorAll(FOCUSABLE)) as HTMLElement[])
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (elements.length === 0) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handler)

    // Focus the first element after portal renders
    const timer = setTimeout(() => {
      const dialog = document.querySelector(containerSelector)
      if (!dialog) return
      const elements = (Array.from(dialog.querySelectorAll(FOCUSABLE)) as HTMLElement[])
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (elements.length > 0) elements[0].focus()
    }, 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', handler)
    }
  }, [containerSelector, enabled])
}
