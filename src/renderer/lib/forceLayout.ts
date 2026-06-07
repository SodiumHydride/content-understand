/**
 * Force-directed layout engine for wiki map.
 * Pure TypeScript, no d3 dependency. Uses requestAnimationFrame for animation.
 */

import type { MapNodePos } from '../stores/types'

export interface ForceNode {
  slug: string
  x: number
  y: number
  vx: number
  vy: number
  pinned: boolean
}

export interface ForceEdge {
  source: string
  target: string
}

export interface ForceConfig {
  /** Repulsion force between all node pairs (default 800). */
  repulsion: number
  /** Attraction force along edges (default 0.01). */
  attraction: number
  /** Velocity damping factor per tick (default 0.85). */
  damping: number
  /** Minimum distance between node centres (default 120). */
  minDistance: number
  /** Max iterations per tick (default 1). */
  maxIterations: number
  /** Stop when total movement per tick < this (default 0.5). */
  convergenceThreshold: number
}

const DEFAULT_CONFIG: ForceConfig = {
  repulsion: 800,
  attraction: 0.01,
  damping: 0.85,
  minDistance: 120,
  maxIterations: 1,
  convergenceThreshold: 0.5,
}

/**
 * Initialise force nodes from a layout map and edge list.
 * Pinned nodes keep their current position and do not move during simulation.
 */
export function initForceNodes(
  layout: Record<string, MapNodePos>,
  edges: ForceEdge[],
  pinnedSlugs?: Set<string>
): ForceNode[] {
  // Collect all slugs that appear in layout or edges
  const slugSet = new Set(Object.keys(layout))
  for (const e of edges) {
    slugSet.add(e.source)
    slugSet.add(e.target)
  }

  return Array.from(slugSet).map(slug => ({
    slug,
    x: layout[slug]?.x ?? 0,
    y: layout[slug]?.y ?? 0,
    vx: 0,
    vy: 0,
    pinned: pinnedSlugs?.has(slug) ?? false,
  }))
}

/**
 * Run one tick of the force simulation.
 * Returns the total displacement (sum of |displacement| for all non-pinned nodes).
 */
export function forceTick(
  nodes: ForceNode[],
  edges: ForceEdge[],
  config?: Partial<ForceConfig>
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const nodeMap = new Map<string, ForceNode>()
  for (const n of nodes) nodeMap.set(n.slug, n)

  // Accumulate forces in fx / fy (reuse vx/vy as accumulator before damping)
  // First zero out forces for non-pinned nodes
  const fx = new Map<string, number>()
  const fy = new Map<string, number>()
  for (const n of nodes) {
    fx.set(n.slug, 0)
    fy.set(n.slug, 0)
  }

  // Repulsion: every pair of nodes pushes apart
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      const distSq = dx * dx + dy * dy
      const dist = Math.sqrt(distSq)
      if (dist < 1) continue // overlapping, skip

      // Inverse-square repulsion: F = repulsion / distSq
      // Direction: push a away from b (negative direction)
      const force = cfg.repulsion / distSq
      const nx = dx / dist // unit vector from a to b
      const ny = dy / dist

      // a is pushed away from b (subtract)
      fx.set(a.slug, (fx.get(a.slug) ?? 0) - nx * force)
      fy.set(a.slug, (fy.get(a.slug) ?? 0) - ny * force)
      // b is pushed away from a (add)
      fx.set(b.slug, (fx.get(b.slug) ?? 0) + nx * force)
      fy.set(b.slug, (fy.get(b.slug) ?? 0) + ny * force)
    }
  }

  // Attraction: edges pull connected nodes together (spring force)
  for (const edge of edges) {
    const a = nodeMap.get(edge.source)
    const b = nodeMap.get(edge.target)
    if (!a || !b) continue

    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) continue

    // Spring force: F = distance * attraction
    const force = dist * cfg.attraction
    const nx = dx / dist
    const ny = dy / dist

    fx.set(a.slug, (fx.get(a.slug) ?? 0) + nx * force)
    fy.set(a.slug, (fy.get(a.slug) ?? 0) + ny * force)
    fx.set(b.slug, (fx.get(b.slug) ?? 0) - nx * force)
    fy.set(b.slug, (fy.get(b.slug) ?? 0) - ny * force)
  }

  // Apply forces: update velocity and position
  let totalMovement = 0
  for (const n of nodes) {
    if (n.pinned) continue

    // Update velocity with damping
    n.vx = (n.vx + (fx.get(n.slug) ?? 0)) * cfg.damping
    n.vy = (n.vy + (fy.get(n.slug) ?? 0)) * cfg.damping

    // Clamp velocity to prevent explosions
    const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
    const maxSpeed = 50
    if (speed > maxSpeed) {
      n.vx = (n.vx / speed) * maxSpeed
      n.vy = (n.vy / speed) * maxSpeed
    }

    // Update position
    const moveX = n.vx
    const moveY = n.vy
    n.x += moveX
    n.y += moveY
    totalMovement += Math.sqrt(moveX * moveX + moveY * moveY)
  }

  // Minimum distance enforcement: push overlapping nodes apart
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist >= cfg.minDistance || dist < 0.01) continue

      const overlap = (cfg.minDistance - dist) / 2
      const nx = dx / dist
      const ny = dy / dist

      if (!a.pinned && !b.pinned) {
        a.x -= nx * overlap
        a.y -= ny * overlap
        b.x += nx * overlap
        b.y += ny * overlap
      } else if (a.pinned) {
        b.x += nx * overlap * 2
        b.y += ny * overlap * 2
      } else {
        a.x -= nx * overlap * 2
        a.y -= ny * overlap * 2
      }
    }
  }

  return totalMovement
}

/**
 * Run the simulation synchronously until convergence or maxIter total iterations.
 * Returns the final node positions as a layout map.
 */
export function runForceLayout(
  layout: Record<string, MapNodePos>,
  edges: ForceEdge[],
  pinnedSlugs?: Set<string>,
  maxIter = 300
): Record<string, MapNodePos> {
  const nodes = initForceNodes(layout, edges, pinnedSlugs)
  const cfg = DEFAULT_CONFIG

  for (let i = 0; i < maxIter; i++) {
    const movement = forceTick(nodes, edges, cfg)
    if (movement < cfg.convergenceThreshold) break
  }

  const out: Record<string, MapNodePos> = {}
  for (const n of nodes) {
    out[n.slug] = { x: n.x, y: n.y }
  }
  return out
}

/**
 * Animate the force layout with requestAnimationFrame.
 * Calls onUpdate with intermediate positions on each frame.
 * Calls onComplete when converged or maxFrames reached.
 * Returns a cancel function.
 */
export function animateForceLayout(
  layout: Record<string, MapNodePos>,
  edges: ForceEdge[],
  pinnedSlugs: Set<string>,
  onUpdate: (positions: Record<string, MapNodePos>) => void,
  onComplete: (positions: Record<string, MapNodePos>) => void,
  maxFrames = 300
): () => void {
  const nodes = initForceNodes(layout, edges, pinnedSlugs)
  const cfg = DEFAULT_CONFIG
  let frame = 0
  let rafId = 0
  let cancelled = false

  const tick = () => {
    if (cancelled) return
    frame++

    const movement = forceTick(nodes, edges, cfg)

    // Build positions snapshot
    const positions: Record<string, MapNodePos> = {}
    for (const n of nodes) {
      positions[n.slug] = { x: n.x, y: n.y }
    }
    onUpdate(positions)

    if (movement < cfg.convergenceThreshold || frame >= maxFrames) {
      onComplete(positions)
      return
    }

    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)

  return () => {
    cancelled = true
    if (rafId) cancelAnimationFrame(rafId)
  }
}
