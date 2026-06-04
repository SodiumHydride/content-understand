import clsx from 'clsx'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { ArrowRight, ChevronRight, Link2, PenLine } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import {
  detectPlatformHint,
  normalizeShelfType,
  PLATFORM_QUICK,
  TYPE_STYLES,
  type ShelfType
} from '../lib/contentMeta'
import { PipelineStepper } from './PipelineStepper'

dayjs.extend(relativeTime)

export function CaptureView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const inputUrl = useAppStore((s) => s.inputUrl)
  const setInputUrl = useAppStore((s) => s.setInputUrl)
  const isDragging = useAppStore((s) => s.isDragging)
  const setDragging = useAppStore((s) => s.setDragging)
  const startUnderstand = useAppStore((s) => s.startUnderstand)
  const tasks = useAppStore((s) => s.tasks)
  const library = useAppStore((s) => s.library)
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const createNote = useAppStore((s) => s.createNote)

  const [submitting, setSubmitting] = useState(false)
  const [activeChip, setActiveChip] = useState<'bilibili' | 'youtube' | 'article' | null>(null)
  const hint = detectPlatformHint(inputUrl)
  const activeTasks = tasks.filter((task) => task.status === 'processing')
  const recentNotes = library.slice(0, 2)
  const locale = i18n.language.startsWith('zh') ? 'zh-cn' : 'en'

  const submit = useCallback(async () => {
    const url = inputUrl.trim()
    if (!url) return
    setSubmitting(true)
    try {
      await startUnderstand(url)
    } finally {
      setSubmitting(false)
    }
  }, [inputUrl, startUnderstand])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) {
        setSubmitting(true)
        try {
          await startUnderstand(file.path || file.name)
        } finally {
          setSubmitting(false)
        }
      }
    },
    [setDragging, startUnderstand]
  )

  const onChipClick = (platform: 'bilibili' | 'youtube' | 'article'): void => {
    setActiveChip(platform)
    setInputUrl(PLATFORM_QUICK[platform].prefix)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const placeholder =
    activeChip != null ? t(`capture.placeholder.${activeChip}`) : t('home.placeholder')

  return (
    <div
      className="capture-page relative"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[rgb(255_252_249/0.72)] backdrop-blur-[3px]">
          <p className="capture-title text-accent">{t('home.dropHere')}</p>
        </div>
      )}

      <div className="capture-stage no-drag">
        <div className="capture-layout">
          <div className="capture-copy">
            <h1 className="capture-title">{t('capture.title')}</h1>
            <p className="capture-lead">{t('capture.lead')}</p>
          </div>

          <div className="capture-composer-wrap">
            <div className="capture-composer">
              <div className="capture-input-row">
                <Link2 size={17} className="mt-0.5 shrink-0 text-ink-500" strokeWidth={1.5} />
                <input
                  ref={inputRef}
                  value={inputUrl}
                  onChange={(e) => {
                    setInputUrl(e.target.value)
                    if (activeChip && !e.target.value.startsWith(PLATFORM_QUICK[activeChip].prefix)) {
                      setActiveChip(null)
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                  placeholder={placeholder}
                  className="capture-input"
                />
              </div>
              <div className="capture-composer-foot">
                <div className="platform-hints">
                  {(['bilibili', 'youtube', 'article'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onChipClick(p)}
                      className={clsx(
                        'platform-chip',
                        (hint === p || activeChip === p) && 'platform-chip-active'
                      )}
                    >
                      {t(`platform.${p}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submit()}
                  className="btn-primary shrink-0"
                >
                  {t('home.understand')}
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          </div>

          <div className="capture-write-row">
            <button type="button" className="capture-write-btn" onClick={() => createNote()}>
              <PenLine size={16} strokeWidth={1.75} />
              {t('capture.writeNote')}
            </button>
          </div>
        </div>

        {activeTasks.length > 0 && (
          <div className="capture-pipeline-inline">
            <span className="section-label">{t('capture.pipelineTitle')}</span>
            <div className="mt-2 flex flex-col gap-2">
              {activeTasks.map((task) => (
                <PipelineStepper key={task.id} task={task} />
              ))}
            </div>
          </div>
        )}
      </div>

      {recentNotes.length > 0 && activeTasks.length === 0 && (
        <footer className="capture-foot no-drag">
          <div className="capture-foot-head">
            <span className="capture-foot-label">{t('capture.recentNotes')}</span>
            <button type="button" className="capture-foot-link" onClick={() => setViewMode('journal')}>
              {t('capture.viewJournal')}
              <ChevronRight size={12} />
            </button>
          </div>
          <ul className="capture-recent-list">
            {recentNotes.map((item) => {
              const type = normalizeShelfType(String(item.type)) as ShelfType
              const accent = TYPE_STYLES[type].accent
              return (
                <li key={item.slug}>
                  <button
                    type="button"
                    className="capture-recent-row"
                    onClick={() => {
                      selectItem(item.slug)
                      setViewMode('journal')
                    }}
                  >
                    <span className="capture-recent-dot" style={{ background: accent }} aria-hidden />
                    <span className="capture-recent-title">{item.title}</span>
                    <span className="capture-recent-time">
                      {dayjs(item.updated).locale(locale).fromNow()}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </footer>
      )}
    </div>
  )
}
