import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'

export interface SelectOption {
  value: string
  label: string
  group?: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  className,
  disabled
}: SelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  // Group options by `group` field
  const groups = React.useMemo(() => {
    const map = new Map<string, SelectOption[]>()
    for (const opt of options) {
      const g = opt.group || ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(opt)
    }
    return map
  }, [options])

  const selected = options.find((o) => o.value === value)

  React.useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open])

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={clsx(
          'settings-input flex w-full items-center justify-between gap-2 text-left',
          open && 'border-[var(--color-accent)]'
        )}
      >
        <span className={clsx(!selected && 'text-ink-500')}>
          {selected ? selected.label : placeholder ?? ''}
        </span>
        <ChevronDown
          size={14}
          className={clsx(
            'shrink-0 text-ink-500 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-white py-1 shadow-md"
          role="listbox"
        >
          {Array.from(groups.entries()).map(([group, opts]) => (
            <div key={group}>
              {group && (
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  {group}
                </div>
              )}
              {opts.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  disabled={opt.disabled}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={clsx(
                    'flex w-full items-center px-3 py-1.5 text-left text-[var(--text-caption)] transition-colors',
                    opt.value === value
                      ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                      : 'text-ink-800 hover:bg-[var(--color-shelf)]',
                    opt.disabled && 'cursor-not-allowed opacity-40'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
