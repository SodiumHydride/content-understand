import { useEffect, useRef } from 'react'
import { shortcutManager, type ShortcutDef } from '../lib/shortcuts'

/**
 * Register a set of keyboard shortcuts for the lifetime of a component.
 *
 * Shortcuts are registered on mount and unregistered on unmount.
 * Pass `deps` to re-register when action callbacks change.
 *
 * @param defs  - Array of shortcut definitions. Each must have a unique `id`.
 * @param deps  - Dependency array (like useEffect). Shortcuts are re-registered when deps change.
 */
export function useShortcuts(defs: ShortcutDef[], deps: unknown[]): void {
  const idsRef = useRef<string[]>([])

  useEffect(() => {
    // Unregister previous batch.
    for (const id of idsRef.current) {
      shortcutManager.unregister(id)
    }
    idsRef.current = []

    // Register new batch.
    for (const def of defs) {
      shortcutManager.register(def)
      idsRef.current.push(def.id)
    }

    return () => {
      for (const id of idsRef.current) {
        shortcutManager.unregister(id)
      }
      idsRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
