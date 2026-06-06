/** Map note card footprint (px) — matches `.map-node` in globals.css. */
export const MAP_NODE_W = 176 // 11rem
export const MAP_NODE_H = 132

/** Scratch sticky on thinking canvas — matches `.map-scratch`. */
export const MAP_SCRATCH_W = 152 // 9.5rem
export const MAP_SCRATCH_H = 112 // 7rem min-height

/** Inline text block on thinking canvas. */
export const MAP_TEXT_W = 176
export const MAP_TEXT_H = 40

export type MapCanvasRect = { x: number; y: number; w: number; h: number }
