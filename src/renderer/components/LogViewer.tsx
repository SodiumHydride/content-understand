import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Search, ChevronDown, Copy, Check } from 'lucide-react'
import clsx from 'clsx'
import { useLogs } from '../hooks/useOllamaQueries'
import type { LogEntry } from '../lib/sidecar'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-ink-500',
  info: 'text-ink-700',
  warn: 'text-[var(--color-cream-300)]',
  error: 'text-[var(--color-danger)]'
}

const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: 'bg-[var(--color-paper-deep)] text-ink-500',
  info: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  warn: 'bg-[var(--color-cream-100)] text-[var(--color-cream-300)]',
  error: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
}

const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']

function mapLevel(raw: string): LogLevel {
  const l = raw.toLowerCase()
  if (l === 'warning' || l === 'warn') return 'warn'
  if (l === 'error' || l === 'critical') return 'error'
  if (l === 'debug') return 'debug'
  return 'info'
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function LogLine({
  log,
  onCopy
}: {
  log: LogEntry
  onCopy: (text: string) => void
}): React.JSX.Element {
  const level = mapLevel(log.level)
  const [copied, setCopied] = useState(false)

  const handleCopy = (): void => {
    onCopy(`[${formatTime(log.ts)}] [${log.level.toUpperCase()}] [${log.logger}] ${log.message}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group flex items-start gap-3 px-3 py-0.5 font-mono text-[11px] leading-[18px] hover:bg-[var(--color-paper-deep)]">
      <span className="shrink-0 text-ink-500">{formatTime(log.ts)}</span>
      <span className={clsx('shrink-0 w-12', LEVEL_COLORS[level])}>
        {log.level.toUpperCase()}
      </span>
      <span className="shrink-0 max-w-[120px] truncate text-ink-500">[{log.logger}]</span>
      <span className={clsx('min-w-0 flex-1 break-all', LEVEL_COLORS[level])}>{log.message}</span>
      <button
        type="button"
        className="invisible shrink-0 p-0.5 text-ink-500 hover:text-ink-800 group-hover:visible"
        onClick={handleCopy}
        title="Copy"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
      </button>
    </div>
  )
}

interface LogViewerProps {
  isZh: boolean
}

export function LogViewer({ isZh }: LogViewerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<Set<LogLevel>>(
    new Set(['error', 'warn', 'info', 'debug'])
  )
  const [autoScroll, setAutoScroll] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const { data: logs = [] } = useLogs({ limit: 500 })

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      const level = mapLevel(log.level)
      if (!levelFilter.has(level)) return false
      if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [logs, search, levelFilter])

  const handleCopy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text)
  }, [])

  useEffect(() => {
    if (autoScroll && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: filtered.length - 1, align: 'end' })
    }
  }, [filtered.length, autoScroll])

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--divider)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--divider)] px-2 py-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
          <input
            type="text"
            placeholder={isZh ? '搜索日志…' : 'Filter logs…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border-none bg-[var(--color-paper-deep)] py-1 pl-7 pr-2 text-[11px] text-ink-800 outline-none placeholder:text-ink-500"
          />
        </div>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => {
              setLevelFilter((prev) => {
                const next = new Set(prev)
                next.has(level) ? next.delete(level) : next.add(level)
                return next
              })
            }}
            className={clsx(
              'rounded px-1.5 py-0.5 text-[10px] font-medium transition',
              levelFilter.has(level) ? LEVEL_BADGE[level] : 'opacity-30'
            )}
          >
            {level.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAutoScroll(!autoScroll)}
          className={clsx(
            'rounded p-1 transition',
            autoScroll
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-paper-deep)] text-ink-500'
          )}
          title={isZh ? '自动滚动' : 'Auto-scroll'}
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* Log content */}
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-[11px] text-ink-500">
            {logs.length === 0
              ? isZh
                ? '暂无日志'
                : 'No logs yet'
              : isZh
                ? '无匹配日志'
                : 'No matching logs'}
          </p>
        </div>
      ) : (
        <>
          <div className="border-b border-[var(--divider)] px-3 py-0.5 text-[10px] text-ink-500">
            {filtered.length} {isZh ? '条' : 'entries'}
          </div>
          <Virtuoso
            ref={virtuosoRef}
            data={filtered}
            followOutput={autoScroll ? 'smooth' : false}
            increaseViewportBy={200}
            className="flex-1"
            itemContent={(index, log) => (
              <LogLine key={`${log.ts}-${index}`} log={log} onCopy={handleCopy} />
            )}
          />
        </>
      )}
    </div>
  )
}
