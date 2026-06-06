import type { ThinkingCanvasDocument } from './types'
import { migrateLegacyToDocument } from './document'
import { DEFAULT_TOOL_PREFERENCES } from './defaults'
import type {
  LegacyScratchNode,
  LegacyThinkingStroke,
  LegacyThinkingTextNode
} from './types'

export function parseCanvasDocument(raw: unknown): ThinkingCanvasDocument {
  if (!raw || typeof raw !== 'object') {
    return migrateLegacyToDocument({
      textStyle: DEFAULT_TOOL_PREFERENCES.text,
      penStyle: DEFAULT_TOOL_PREFERENCES.pen
    })
  }
  const data = raw as ThinkingCanvasDocument
  if (!Array.isArray(data.elements)) {
    return migrateLegacyToDocument({
      textStyle: DEFAULT_TOOL_PREFERENCES.text,
      penStyle: DEFAULT_TOOL_PREFERENCES.pen
    })
  }
  return {
    schemaVersion: data.schemaVersion ?? 1,
    revision: data.revision ?? 0,
    elements: data.elements
  }
}

export function buildMigrationFromPersistedState(state: {
  thinkingTexts?: LegacyThinkingTextNode[]
  thinkingStrokes?: LegacyThinkingStroke[]
  thinkingScratch?: LegacyScratchNode[]
}): ThinkingCanvasDocument {
  return migrateLegacyToDocument({
    texts: state.thinkingTexts,
    strokes: state.thinkingStrokes,
    scratch: state.thinkingScratch,
    textStyle: DEFAULT_TOOL_PREFERENCES.text,
    penStyle: DEFAULT_TOOL_PREFERENCES.pen
  })
}
