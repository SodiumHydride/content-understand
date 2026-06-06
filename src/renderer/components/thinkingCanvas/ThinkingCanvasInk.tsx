import type { ThinkingStrokeElement } from '../../lib/thinkingCanvas/types'
import { strokeCircleNodes, strokePathD } from '../../lib/thinkingCanvas/strokeGeometry'

export function ThinkingCanvasInk({
  strokes,
  activeStroke
}: {
  strokes: ThinkingStrokeElement[]
  activeStroke: ThinkingStrokeElement | null
}): React.JSX.Element {
  const all = activeStroke ? [...strokes, activeStroke] : strokes

  return (
    <svg className="thinking-canvas-ink" aria-hidden>
      {all.map((stroke) => {
        if (stroke.points.length < 2) {
          if (stroke.points.length === 1) {
            const p = stroke.points[0]!
            const r = stroke.style.width / 2
            return (
              <circle
                key={stroke.id}
                cx={p.x}
                cy={p.y}
                r={r}
                fill={stroke.style.color}
                opacity={stroke.style.opacity}
              />
            )
          }
          return null
        }

        if (stroke.style.variant === 'highlighter') {
          return (
            <path
              key={stroke.id}
              d={strokePathD(stroke.points)}
              fill="none"
              stroke={stroke.style.color}
              strokeWidth={stroke.style.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={stroke.style.opacity}
            />
          )
        }

        const nodes = strokeCircleNodes(stroke.points, stroke.style.width)
        return (
          <g key={stroke.id} opacity={stroke.style.opacity}>
            {nodes.map((n, i) => (
              <circle key={`${stroke.id}-${i}`} cx={n.cx} cy={n.cy} r={n.r} fill={stroke.style.color} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
