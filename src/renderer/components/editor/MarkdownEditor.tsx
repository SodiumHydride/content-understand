import React, { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { useAppStore } from '../../stores/appStore'
import { wikilinkHighlight, wikilinkClickHandler } from './extensions/wikilinkHighlight'

interface MarkdownEditorProps {
  value: string
  onChange: (val: string) => void
}

/** Build the base CodeMirror theme (non-dynamic parts). */
function makeBaseTheme() {
  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: 'var(--reading-size, 16px)',
      fontFamily: 'var(--reading-font, var(--font-serif))',
      lineHeight: 'var(--reading-leading, 1.82)',
      color: 'var(--color-ink-800)',
      backgroundColor: 'var(--color-paper)'
    },
    '.cm-content': {
      padding: '1.5rem 0',
      caretColor: 'var(--color-accent)'
    },
    '.cm-line': {
      paddingLeft: '0.5rem',
      paddingRight: '0.5rem'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--color-accent)',
      borderLeftWidth: '2px'
    },
    '.cm-scroller': {
      overflow: 'auto',
      height: '100%',
      fontFamily: 'inherit'
    },
    '.cm-tooltip': {
      border: '1px solid var(--border)',
      backgroundColor: 'var(--color-paper-deep)',
      color: 'var(--color-ink-800)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: '4px'
    },
    '.cm-tooltip-autocomplete > ul > li': {
      padding: '4px 8px',
      borderRadius: 'var(--radius-sm)',
      fontSize: '13px'
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-accent-soft)',
      color: 'var(--color-ink-900)'
    }
  })
}

/** Build the dark-mode overlay theme. */
function makeDarkTheme() {
  return EditorView.theme(
    {
      '.cm-selectionBackground': {
        backgroundColor: '#3b4252'
      }
    },
    { dark: true }
  )
}

/** Build the light-mode overlay theme. */
function makeLightTheme() {
  return EditorView.theme(
    {
      '.cm-selectionBackground': {
        backgroundColor: '#e2e8f0'
      }
    },
    { dark: false }
  )
}

/** Build a wikilink autocompletion extension for the given library items. */
function makeWikilinkCompletion(
  library: Array<{ title: string; platform?: string }>
) {
  return autocompletion({
    override: [
      (context: CompletionContext) => {
        const before = context.matchBefore(/\[\[[^\]]*$/)
        if (!before) return null
        const query = before.text.slice(2).toLowerCase()

        // Filter library options based on the typed title query
        const options = library
          .filter((item) => item.title.toLowerCase().includes(query))
          .map((item) => ({
            label: item.title,
            displayLabel: item.title,
            detail: item.platform || 'note',
            apply: item.title + ']]'
          }))

        return {
          from: before.from + 2,
          options
        }
      }
    ]
  })
}

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const library = useAppStore((s) => s.library)
  const themeSetting = useAppStore((s) => s.settings.theme || 'system')

  // Detect dark mode to apply appropriate CodeMirror styles
  const isDark =
    themeSetting === 'dark' ||
    (themeSetting === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Keep a ref to the current library so the stable autocomplete source
  // closure always reads the latest data without triggering editor rebuilds.
  const libraryRef = useRef(library)
  libraryRef.current = library

  // Handle onChange callback safely to avoid infinite loops
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // --- Compartments for runtime-reconfigurable extensions ---
  const themeCompartment = useRef(new Compartment())
  const autocompleteCompartment = useRef(new Compartment())
  const wikilinkCompartment = useRef(new Compartment())

  // ---------------------------------------------------------------
  // Effect 1 (CREATE): Create the EditorView once.
  // Only depends on [initialValue, onSave] (via refs).
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return

    // Initial theme based on current isDark at mount time
    const initialTheme = isDark
      ? [makeBaseTheme(), makeDarkTheme()]
      : [makeBaseTheme(), makeLightTheme()]

    // Initial autocomplete using current library at mount time
    const initialAutocomplete = makeWikilinkCompletion(libraryRef.current)

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        autocompleteCompartment.current.of(initialAutocomplete),
        wikilinkCompartment.current.of([
          wikilinkHighlight(libraryRef.current),
          wikilinkClickHandler((title) => {
            const match = libraryRef.current.find((item) => item.title === title)
            if (match) {
              // Navigate to the matched library item
              const { selectItem } = useAppStore.getState()
              selectItem(match.slug, { reader: true })
            }
          })
        ]),
        EditorView.lineWrapping,
        drawSelection(),
        themeCompartment.current.of(initialTheme),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        })
      ]
    })

    const view = new EditorView({
      state,
      parent: containerRef.current
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------
  // Effect 2 (RECONFIGURE): Reconfigure theme when isDark changes.
  // Uses Compartment API -- no editor destruction, preserves cursor
  // position and undo history.
  // ---------------------------------------------------------------
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const newTheme = isDark
      ? [makeBaseTheme(), makeDarkTheme()]
      : [makeBaseTheme(), makeLightTheme()]

    view.dispatch({
      effects: themeCompartment.current.reconfigure(newTheme)
    })
  }, [isDark])

  // ---------------------------------------------------------------
  // Effect 3 (RECONFIGURE): Reconfigure autocomplete and wikilink
  // highlighting when library changes. Uses Compartment API.
  // ---------------------------------------------------------------
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const newAutocomplete = makeWikilinkCompletion(library)
    view.dispatch({
      effects: autocompleteCompartment.current.reconfigure(newAutocomplete)
    })

    const newWikilinkExt = [
      wikilinkHighlight(library),
      wikilinkClickHandler((title) => {
        const match = library.find((item) => item.title === title)
        if (match) {
          const { selectItem } = useAppStore.getState()
          selectItem(match.slug, { reader: true })
        }
      })
    ]
    view.dispatch({
      effects: wikilinkCompartment.current.reconfigure(newWikilinkExt)
    })
  }, [library])

  // Keep CodeMirror document updated if value changes externally (e.g. page loading)
  useEffect(() => {
    const view = viewRef.current
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value }
      })
    }
  }, [value])

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
}
