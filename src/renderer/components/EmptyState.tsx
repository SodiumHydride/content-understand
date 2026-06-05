import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  hint,
  detail,
  action
}: {
  icon: ReactNode
  title: string
  hint?: string
  detail?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden>
        {icon}
      </div>
      <p className="empty-state-title">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {detail && <p className="map-empty-hint-mode">{detail}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
