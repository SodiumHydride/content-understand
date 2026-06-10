/**
 * Unified keyboard shortcut manager.
 *
 * All shortcuts go through a single global keydown listener.
 * Scopes control when a shortcut is active:
 *   - 'global': always active (e.g. Cmd+K, Cmd+/)
 *   - 'map':    active when viewMode === 'map'
 *   - 'editor': active when the note editor is open
 *   - 'reader': active when a note reader is open
 */

export type ShortcutScope = 'global' | 'map' | 'editor' | 'reader'

export interface ShortcutDef {
  id: string
  /** Key combo, e.g. 'Mod+k', 'Mod+Shift+p', 'Escape', 'Space'. */
  key: string
  scope: ShortcutScope
  /** i18n translation key for the description. */
  description: string
  action: () => void
  enabled?: boolean
}

type ScopePredicate = () => boolean

export class ShortcutManager {
  private shortcuts = new Map<string, ShortcutDef>()
  private scopePredicates = new Map<ShortcutScope, ScopePredicate>()
  private listener: ((e: KeyboardEvent) => void) | null = null
  private active = false

  /** Register a scope predicate — called on every keydown to test if scoped shortcuts should fire. */
  setScopePredicate(scope: ShortcutScope, fn: ScopePredicate): void {
    this.scopePredicates.set(scope, fn)
  }

  register(def: ShortcutDef): void {
    this.shortcuts.set(def.id, { enabled: true, ...def })
  }

  unregister(id: string): void {
    this.shortcuts.delete(id)
  }

  update(id: string, patch: Partial<ShortcutDef>): void {
    const existing = this.shortcuts.get(id)
    if (existing) {
      this.shortcuts.set(id, { ...existing, ...patch })
    }
  }

  /** Install the single global keydown listener. */
  start(): void {
    if (this.active) return
    this.active = true
    this.listener = (e: KeyboardEvent) => this.handleKeydown(e)
    window.addEventListener('keydown', this.listener, { capture: true })
  }

  /** Remove the global keydown listener. */
  stop(): void {
    if (!this.active || !this.listener) return
    window.removeEventListener('keydown', this.listener, { capture: true })
    this.listener = null
    this.active = false
  }

  /** All registered shortcuts (for help panel). */
  getShortcuts(): ShortcutDef[] {
    return Array.from(this.shortcuts.values())
  }

  /** Shortcuts filtered by scope. */
  getByScope(scope: ShortcutScope): ShortcutDef[] {
    return this.getShortcuts().filter((s) => s.scope === scope)
  }

  // ── internals ──────────────────────────────────────────

  private handleKeydown(e: KeyboardEvent): void {
    // Skip if focus is in an editable element (unless the shortcut is global-scoped and overrides).
    const tag = (e.target as HTMLElement)?.tagName
    const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

    for (const def of this.shortcuts.values()) {
      if (def.enabled === false) continue
      if (!this.matchesCombo(e, def.key)) continue

      // Scoped shortcuts are suppressed when focus is in an editable field.
      if (def.scope !== 'global' && inEditable) continue

      // Check scope predicate.
      if (def.scope !== 'global') {
        const pred = this.scopePredicates.get(def.scope)
        if (pred && !pred()) continue
      }

      e.preventDefault()
      e.stopPropagation()
      def.action()
      return // first match wins
    }
  }

  /** Test whether a KeyboardEvent matches a combo string like 'Mod+k' or 'Escape'. */
  private matchesCombo(e: KeyboardEvent, combo: string): boolean {
    const parts = combo.split('+').map((p) => p.trim().toLowerCase())
    const key = parts[parts.length - 1]
    const hasMod = parts.includes('mod')
    const hasShift = parts.includes('shift')
    const hasAlt = parts.includes('alt')

    const eventKey = e.key.toLowerCase()
    // Normalize: 'escape' === 'esc'
    const match =
      eventKey === key ||
      (key === 'escape' && eventKey === 'esc') ||
      (key === 'esc' && eventKey === 'escape') ||
      (key === '/' && eventKey === '/')

    if (!match) return false

    // 'Mod' maps to metaKey on macOS, ctrlKey elsewhere.
    const modPressed = e.metaKey || e.ctrlKey
    if (hasMod && !modPressed) return false
    if (!hasMod && modPressed) return false
    if (hasShift && !e.shiftKey) return false
    if (!hasShift && e.shiftKey && key.length === 1) return false // ignore accidental shift on letter keys
    if (hasAlt && !e.altKey) return false

    return true
  }
}

/** Singleton instance used across the app. */
export const shortcutManager = new ShortcutManager()
