import React from 'react'
import { Info, AlertTriangle, CheckCircle, Skull, Quote } from 'lucide-react'

export function CalloutIcon({ type }: { type: string }): React.JSX.Element {
  switch (type) {
    case 'note':
    case 'info':
    case 'todo':
      return <Info size={16} className="text-[var(--color-accent)]" />
    case 'tip':
    case 'hint':
    case 'important':
      return <CheckCircle size={16} className="text-[#7eb89a]" />
    case 'warning':
    case 'caution':
    case 'attention':
      return <AlertTriangle size={16} className="text-[#d4b07a]" />
    case 'failure':
    case 'danger':
    case 'bug':
      return <Skull size={16} className="text-[var(--color-danger)]" />
    case 'quote':
    case 'cite':
      return <Quote size={16} className="text-ink-500" />
    default:
      return <Info size={16} className="text-[var(--color-accent)]" />
  }
}
