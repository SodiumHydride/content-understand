import { ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder, type Range } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { LibraryItem } from '../../../stores/types'

/**
 * Build a regex that matches [[...]] with balanced content.
 * We use a simple pattern that handles nested brackets by matching
 * any characters between [[ and ]], greedy but non-overlapping.
 *
 * The regex: match [[ followed by any content (non-greedy to handle
 * consecutive wikilinks on the same line) followed by ]].
 * We allow single ] inside as long as it doesn't form ]].
 */
const WIKILINK_PATTERN = /\[\[([^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*?)\]\]/g

const wikilinkDecoration = Decoration.mark({
  class: 'cm-wikilink'
})

const brokenWikilinkDecoration = Decoration.mark({
  class: 'cm-wikilink cm-wikilink-broken'
})

interface WikilinkSpec {
  from: number
  to: number
  target: string
}

/** Scan a text range for [[wikilink]] patterns. */
function findWikilinks(text: string, offset: number): WikilinkSpec[] {
  const results: WikilinkSpec[] = []
  // Reset regex state
  const re = new RegExp(WIKILINK_PATTERN.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]
    // Skip empty wikilinks [[  ]]
    if (inner.trim().length === 0) continue
    // Extract the target: if [[display|target]], use target; otherwise use the full inner text
    const pipeIdx = inner.indexOf('|')
    const target = pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner.trim()
    if (target.length === 0) continue
    results.push({
      from: offset + m.index,
      to: offset + m.index + m[0].length,
      target
    })
  }
  return results
}

/** Build a full DecorationSet by scanning every line. */
function buildFullDecorationSet(
  doc: { lines: number; line(n: number): { text: string; from: number } },
  librarySet: Set<string>
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    addLineDecorations(builder, line.text, line.from, librarySet)
  }
  return builder.finish()
}

/** Add decorations for a single line to a builder. */
function addLineDecorations(
  builder: RangeSetBuilder<Decoration>,
  text: string,
  offset: number,
  librarySet: Set<string>
): void {
  const links = findWikilinks(text, offset)
  for (const link of links) {
    const deco = librarySet.has(link.target)
      ? wikilinkDecoration
      : brokenWikilinkDecoration
    builder.add(link.from, link.to, deco)
  }
}

/** Build decorations for a range of lines, returning a sorted Range array. */
function scanLineRanges(
  doc: { length: number; lines: number; line(n: number): { text: string; from: number }; lineAt(pos: number): { number: number; from: number; to: number } },
  from: number,
  to: number,
  librarySet: Set<string>
): Range<Decoration>[] {
  const result: Range<Decoration>[] = []
  const startLine = doc.lineAt(from)
  const endLine = doc.lineAt(Math.min(to, doc.length))
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i)
    const links = findWikilinks(line.text, line.from)
    for (const link of links) {
      const deco = librarySet.has(link.target)
        ? wikilinkDecoration
        : brokenWikilinkDecoration
      result.push(deco.range(link.from, link.to))
    }
  }
  return result
}

/** Create a title lookup set from the library for broken-link detection. */
function makeLibrarySet(library: LibraryItem[]): Set<string> {
  return new Set(library.map((item) => item.title))
}

/**
 * Create the wikilink highlight extension.
 *
 * Uses CM6's incremental decoration update API:
 * - `DecorationSet.map(changes)` to remap existing decorations through document changes
 * - `DecorationSet.update({ filterFrom, filterTo, filter, add })` to replace only
 *   decorations on affected lines, leaving the rest untouched
 *
 * This avoids O(n) full-document scans on every keystroke.
 *
 * @param library - current library items for broken-link detection
 * @returns ViewPlugin that decorates [[wikilink]] patterns
 */
export function wikilinkHighlight(library: LibraryItem[]) {
  const librarySet = makeLibrarySet(library)
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildFullDecorationSet(view.state.doc, librarySet)
      }
      update(update: ViewUpdate) {
        if (update.docChanged) {
          // 1. Map existing decorations through the document changes.
          //    This handles position shifts for decorations outside changed ranges.
          let mapped = this.decorations.map(update.changes)

          // 2. Collect all changed ranges and re-scan those lines only.
          //    We remove old decorations in the changed line ranges and add fresh ones.
          const doc = update.state.doc
          const newDecos: Range<Decoration>[] = []

          update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            const startLine = doc.lineAt(fromB)
            const endLine = doc.lineAt(Math.min(toB, doc.length))
            // Remove existing decorations on these lines and re-scan
            mapped = mapped.update({
              filterFrom: startLine.from,
              filterTo: endLine.to,
              filter: () => false,
            })
            newDecos.push(...scanLineRanges(doc, fromB, toB, librarySet))
          })

          // 3. Add the freshly scanned decorations.
          if (newDecos.length > 0) {
            mapped = mapped.update({ add: newDecos, sort: true })
          }

          this.decorations = mapped
        } else if (update.viewportChanged) {
          // Viewport changes (scroll) may reveal lines that weren't previously
          // decorated. Rebuild for the full document — this is acceptable since
          // viewport changes are far less frequent than keystroke edits.
          this.decorations = buildFullDecorationSet(update.state.doc, librarySet)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )
}

/**
 * Create a click handler extension for wikilink navigation.
 *
 * @param onSelect - callback when a wikilink is clicked, receives the target title
 * @returns ViewPlugin with DOM event handler for click navigation
 */
export function wikilinkClickHandler(onSelect: (title: string) => void) {
  return ViewPlugin.fromClass(
    class {
      mousedown(event: MouseEvent, view: EditorView) {
        const target = event.target as HTMLElement
        if (!target.closest('.cm-wikilink')) return

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return

        const line = view.state.doc.lineAt(pos)
        const links = findWikilinks(line.text, line.from)
        for (const link of links) {
          if (pos >= link.from && pos <= link.to) {
            event.preventDefault()
            onSelect(link.target)
            return
          }
        }
      }
    }
  )
}
