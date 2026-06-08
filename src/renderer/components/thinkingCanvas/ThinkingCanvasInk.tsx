import type { ThinkingStrokeElement } from '../../lib/thinkingCanvas/types'
import { strokePathD, strokePressurePathD } from '../../lib/thinkingCanvas/strokeGeometry'

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

        const d = strokePressurePathD(stroke.points, stroke.style.width)
        if (!d) return null
        return (
          <path
            key={stroke.id}
            d={d}
            fill={stroke.style.color}
            opacity={stroke.style.opacity}
          />
        )
      })}
    </svg>
  )
}
