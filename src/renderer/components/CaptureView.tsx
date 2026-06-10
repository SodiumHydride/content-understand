import clsx from 'clsx'
import { useCallback, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { ArrowRight, ChevronRight, Link2, PenLine, Send, Brain, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/appStore'
import { notify } from '../lib/notify'
import {
  detectPlatformHint,
  normalizeShelfType,
  PLATFORM_QUICK,
  TYPE_STYLES,
  type ShelfType
} from '../lib/contentMeta'
import { PipelineStepper } from './PipelineStepper'
import { askVault, type QASourceItem } from '../lib/sidecar'

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
  
  const [activeTab, setActiveTab] = useState<'capture' | 'qa'>('capture')
  const [chatHistory, setChatHistory] = useState<{
    role: 'user' | 'assistant'
    content: string
    sources?: QASourceItem[]
  }[]>([])
  const [qaInput, setQaInput] = useState('')
  const [qaLoading, setQaLoading] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const handleQaSubmit = useCallback(async () => {
    const text = qaInput.trim()
    if (!text || qaLoading) return
    setQaInput('')
    setQaLoading(true)

    const userMsg = { role: 'user' as const, content: text }
    const nextHistory = [...chatHistory, userMsg]
    setChatHistory(nextHistory)

    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

    try {
      const backendHistory = chatHistory.map(h => ({
        role: h.role,
        content: h.content
      }))
      const res = await askVault(text, backendHistory)
      if (res) {
        setChatHistory(prev => [
          ...prev,
          { role: 'assistant' as const, content: res.answer, sources: res.sources }
        ])
      } else {
        notify('Failed to generate response from assistant backend', { type: 'error' })
      }
    } catch (e) {
      notify('An error occurred during Q&A', { type: 'error' })
    } finally {
      setQaLoading(false)
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [qaInput, qaLoading, chatHistory])
  const findSlugByTitle = useCallback(
    (title: string): string | null => {
      const item = library.find((x) => x.title.toLowerCase() === title.toLowerCase())
      return item ? item.slug : null
    },
    [library]
  )

  const preprocessMarkdown = useCallback((text: string) => {
    return text.replace(/\[\[(.*?)\]\]/g, (_, title) => {
      return `[${title}](wikilink:${encodeURIComponent(title)})`
    })
  }, [])

  const hint = detectPlatformHint(inputUrl)
  const activeTasks = tasks.filter((task) => task.status === 'processing')
  const failedTasks = tasks.filter((task) => task.status === 'failed').slice(0, 3)
  const pipelineTasks = [...activeTasks, ...failedTasks]
  const recentNotes = library.slice(0, 2)
  const locale = i18n.language.startsWith('zh') ? 'zh-cn' : 'en'

  const submit = useCallback(async () => {
    const url = inputUrl.trim()
    if (!url) return
    const isUrl = /^https?:\/\//.test(url)
    const isLocal = url.startsWith('/') || url.startsWith('~') || /^[A-Z]:\\/i.test(url)
    if (!isUrl && !isLocal) {
      notify(t('errors.invalidUrl') || 'Please enter a valid URL or file path', { type: 'error' })
      return
    }
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
          await startUnderstand((file as File & { path?: string }).path || file.name)
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
      className="capture-page relative h-full flex flex-col overflow-hidden"
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

      {/* Tabs Header */}
      <div className="flex border-b border-[var(--border)] px-[var(--page-pad-x)] pt-4 gap-6 no-drag bg-[var(--color-paper)] z-10 shrink-0">
        <button
          onClick={() => setActiveTab('capture')}
          className={clsx(
            'pb-2 px-1 text-sm font-medium transition-all border-b-2 cursor-pointer border-none bg-transparent',
            activeTab === 'capture'
              ? 'border-b-2 border-solid border-[var(--color-accent)] text-[var(--color-ink-900)] font-semibold'
              : 'border-transparent text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)]'
          )}
        >
          {t('qa.captureTab')}
        </button>
        <button
          onClick={() => setActiveTab('qa')}
          className={clsx(
            'pb-2 px-1 text-sm font-medium transition-all border-b-2 cursor-pointer border-none bg-transparent',
            activeTab === 'qa'
              ? 'border-b-2 border-solid border-[var(--color-accent)] text-[var(--color-ink-900)] font-semibold'
              : 'border-transparent text-[var(--color-ink-500)] hover:text-[var(--color-ink-700)]'
          )}
        >
          {t('qa.tab')}
        </button>
      </div>

      {activeTab === 'capture' ? (
        <div className="capture-stage no-drag flex-1 overflow-y-auto w-full flex flex-col items-center">
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

          {pipelineTasks.length > 0 && (
            <div className="capture-pipeline-inline w-full">
              <span className="section-label">{t('capture.pipelineTitle')}</span>
              <div className="mt-2 flex flex-col gap-2">
                {pipelineTasks.map((task) => (
                  <PipelineStepper key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}

          {recentNotes.length > 0 && activeTasks.length === 0 && (
            <footer className="capture-foot no-drag w-full mt-auto">
              <div className="capture-foot-head">
                <span className="capture-foot-label">{t('capture.recentNotes')}</span>
                <button type="button" className="capture-foot-link border-none bg-transparent cursor-pointer" onClick={() => setViewMode('journal')}>
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
      ) : (
        <div className="qa-stage flex-1 flex flex-col min-h-0 no-drag bg-[var(--color-paper)] p-6">
          <div className="qa-messages flex-1 overflow-y-auto pr-1 mb-4 flex flex-col gap-4">
            {chatHistory.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
                <div className="w-12 h-12 rounded-full bg-[var(--color-accent-soft)] flex items-center justify-center text-[var(--color-accent)] mb-4">
                  <Brain size={24} />
                </div>
                <h3 className="text-base font-semibold text-[var(--color-ink-900)] mb-1">
                  {t('qa.empty')}
                </h3>
                <p className="text-xs text-[var(--color-ink-500)] mb-6">
                  {t('qa.emptyHint')}
                </p>
                <div className="w-full flex flex-col gap-2">
                  {[
                    t('qa.suggest1', { defaultValue: '我的知识库里有哪些核心主题？' }),
                    t('qa.suggest2', { defaultValue: '帮我整理一下最近添加的信息要点。' }),
                    t('qa.suggest3', { defaultValue: '告诉我关于多模态内容理解的内容。' })
                  ].map((suggest, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setQaInput(suggest)
                      }}
                      className="text-left px-4 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--color-paper-deep)] hover:bg-[var(--color-accent-soft)] hover:border-[var(--color-accent)] text-xs text-[var(--color-ink-700)] hover:text-[var(--color-ink-900)] transition-all cursor-pointer"
                    >
                      {suggest}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              chatHistory.map((msg, index) => (
                <div
                  key={index}
                  className={clsx(
                    'flex gap-3 max-w-[85%]',
                    msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start'
                  )}
                >
                  <div
                    className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center shrink-0 border border-[var(--border)]',
                      msg.role === 'user'
                        ? 'bg-[var(--color-paper-deep)] text-[var(--color-ink-700)]'
                        : 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    )}
                  >
                    {msg.role === 'user' ? <User size={14} /> : <Brain size={14} />}
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div
                      className={clsx(
                        'px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed shadow-sm',
                        msg.role === 'user'
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-ink-900)] rounded-tr-none'
                          : 'bg-white border border-[var(--border)] text-[var(--color-ink-800)] rounded-tl-none markdown-body prose prose-stone max-w-none'
                      )}
                    >
                      {msg.role === 'user' ? (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node, ...props }) => {
                              const href = props.href || ''
                              if (href.startsWith('wikilink:')) {
                                const title = decodeURIComponent(href.replace('wikilink:', ''))
                                const slug = findSlugByTitle(title)
                                if (slug) {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        selectItem(slug)
                                        setViewMode('journal')
                                      }}
                                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)] hover:text-white text-xs font-semibold text-[var(--color-accent)] transition-all cursor-pointer border-none align-baseline font-serif"
                                    >
                                      {title}
                                    </button>
                                  )
                                } else {
                                  return <span className="text-ink-500 font-medium font-serif">[[{title}]]</span>
                                }
                              }
                              return (
                                <a
                                  className="text-[var(--color-accent)] hover:underline"
                                  {...props}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                />
                              )
                            }
                          }}
                        >
                          {preprocessMarkdown(msg.content)}
                        </ReactMarkdown>
                      )}
                    </div>

                    {msg.sources && msg.sources.length > 0 && (
                      <div className="flex flex-col gap-1 pl-1">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-500)]">
                          {t('qa.sources')} ({msg.sources.length})
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.sources.map((src) => (
                            <button
                              key={src.slug}
                              type="button"
                              onClick={() => {
                                selectItem(src.slug)
                                setViewMode('journal')
                              }}
                              className="px-2 py-0.5 rounded-full border border-[var(--border)] bg-[var(--color-paper-deep)] hover:bg-[var(--color-accent-soft)] hover:border-[var(--color-accent)] text-[10px] text-[var(--color-ink-600)] hover:text-[var(--color-ink-900)] transition-all cursor-pointer"
                            >
                              {src.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {qaLoading && (
              <div className="flex gap-3 max-w-[85%] self-start">
                <div className="w-8 h-8 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <Brain size={14} className="animate-pulse" />
                </div>
                <div className="bg-white border border-[var(--border)] px-4 py-2.5 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1.5 text-xs text-[var(--color-ink-500)]">
                  <span className="animate-pulse">{t('qa.loading')}</span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          <div className="border border-[var(--border)] rounded-xl bg-white p-2 flex gap-2 shadow-sm items-end focus-within:border-[rgb(106_158_196/45%)] focus-within:shadow-[0_0_0_3px_rgba(106,158,196,0.1)] transition-all shrink-0">
            <textarea
              value={qaInput}
              onChange={(e) => setQaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleQaSubmit()
                }
              }}
              placeholder={t('qa.placeholder')}
              rows={1}
              className="flex-1 resize-none max-h-32 border-none outline-none text-[13px] bg-transparent text-[var(--color-ink-900)] py-1.5 px-2"
              style={{ minHeight: '36px' }}
            />
            <button
              onClick={() => void handleQaSubmit()}
              disabled={!qaInput.trim() || qaLoading}
              className="btn-primary w-8 h-8 p-0 rounded-lg shrink-0 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-none"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
