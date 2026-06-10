import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, CheckCircle, RefreshCw, X, ChevronRight, BookOpen } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import type { LibraryItem } from '../stores/types'
import { notify } from '../lib/notify'

interface DailyReviewProps {
  onClose: () => void
}

interface ReviewItemState {
  interval: number // in days
  easeFactor: number
  repetitions: number
  nextReviewDate: string // ISO string
}

type ReviewDb = Record<string, ReviewItemState>

export function DailyReview({ onClose }: DailyReviewProps): React.JSX.Element {
  const { t } = useTranslation()
  const library = useAppStore((s) => s.library)
  const selectItem = useAppStore((s) => s.selectItem)
  const setViewMode = useAppStore((s) => s.setViewMode)

  const [sessionNotes, setSessionNotes] = useState<LibraryItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [isCompleted, setIsCompleted] = useState(false)

  // 1. Load or initialize review sessions from localStorage
  useEffect(() => {
    if (library.length === 0) return

    const storedStr = localStorage.getItem('content-app:reviews')
    const db: ReviewDb = storedStr ? JSON.parse(storedStr) : {}
    const now = new Date()

    // Find notes due for review
    const dueNotes: LibraryItem[] = []
    const newNotes: LibraryItem[] = []

    library.forEach((item) => {
      const stats = db[item.slug]
      if (stats) {
        if (new Date(stats.nextReviewDate) <= now) {
          dueNotes.push(item)
        }
      } else {
        newNotes.push(item)
      }
    })

    // Combine due notes first, then pad with new notes, up to 5 total
    let selected = [...dueNotes]
    if (selected.length < 5) {
      const needed = 5 - selected.length
      // Shuffle new notes to review random new material
      const shuffledNew = [...newNotes].sort(() => 0.5 - Math.random())
      selected = [...selected, ...shuffledNew.slice(0, needed)]
    }

    // Shuffle the final selection slightly to mix due and new
    selected = selected.slice(0, 5).sort(() => 0.5 - Math.random())
    setSessionNotes(selected)
  }, [library])

  const currentNote = sessionNotes[currentIndex]

  // SM-2 algorithm review handler
  const handleScore = useCallback((score: number) => {
    if (!currentNote) return

    const slug = currentNote.slug
    const storedStr = localStorage.getItem('content-app:reviews')
    const db: ReviewDb = storedStr ? JSON.parse(storedStr) : {}
    const now = new Date()

    const stats = db[slug] || {
      interval: 0,
      easeFactor: 2.5,
      repetitions: 0,
      nextReviewDate: now.toISOString()
    }

    let { interval, easeFactor, repetitions } = stats

    // SM-2 calculation
    if (score >= 3) {
      if (repetitions === 0) {
        interval = 1
      } else if (repetitions === 1) {
        interval = 6
      } else {
        interval = Math.round(interval * easeFactor)
      }
      repetitions += 1
    } else {
      repetitions = 0
      interval = 1
    }

    // Update ease factor
    easeFactor = easeFactor + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02))
    if (easeFactor < 1.3) {
      easeFactor = 1.3
    }

    const nextReview = new Date()
    nextReview.setDate(nextReview.getDate() + interval)

    db[slug] = {
      interval,
      easeFactor,
      repetitions,
      nextReviewDate: nextReview.toISOString()
    }

    localStorage.setItem('content-app:reviews', JSON.stringify(db))
    notify(t('review.statsUpdated', { defaultValue: '记忆强度已更新' }), { type: 'success' })

    // Move to next card with delay for flip transition back
    setIsFlipped(false)
    setTimeout(() => {
      if (currentIndex + 1 < sessionNotes.length) {
        setCurrentIndex((prev) => prev + 1)
      } else {
        setIsCompleted(true)
      }
    }, 200)
  }, [currentNote, currentIndex, sessionNotes, t])

  const handleOpenNote = () => {
    if (!currentNote) return
    selectItem(currentNote.slug, { reader: true })
    setViewMode('journal')
    onClose()
  }

  // Pre-process summary text to clean markdown heading
  const summaryClean = useMemo(() => {
    if (!currentNote?.summary) return ''
    return currentNote.summary.replace(/^#+\s*.+\n+/, '').trim()
  }, [currentNote])

  if (library.length === 0 || sessionNotes.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md">
        <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--color-paper)] p-8 shadow-2xl text-center">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1.5 hover:bg-[var(--color-paper-deep)] text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)] transition-colors cursor-pointer border-none bg-transparent"
          >
            <X size={18} />
          </button>
          <div className="w-12 h-12 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] flex items-center justify-center mx-auto mb-4">
            <Brain size={24} />
          </div>
          <h2 className="text-lg font-bold text-[var(--color-ink-900)] mb-2">
            {t('review.empty', { defaultValue: '今日无复习任务' })}
          </h2>
          <p className="text-sm text-[var(--color-ink-500)] mb-6 leading-relaxed">
            {t('review.emptyHint', { defaultValue: '你已经完成了所有的回顾，或者知识库中还没有足够的笔记。' })}
          </p>
          <button
            onClick={onClose}
            className="btn-primary px-6 py-2.5 mx-auto"
          >
            {t('review.close', { defaultValue: '关闭' })}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md p-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--color-paper)] p-6 shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--divider)] mb-6 shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="text-[var(--color-accent)]" size={20} />
            <h2 className="text-base font-bold text-[var(--color-ink-900)]">
              {t('review.title', { defaultValue: '知识回顾' })}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-[var(--color-paper-deep)] text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)] transition-colors cursor-pointer border-none bg-transparent"
          >
            <X size={18} />
          </button>
        </div>

        {isCompleted ? (
          /* Completion Screen */
          <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-4">
              <CheckCircle size={36} />
            </div>
            <h3 className="text-xl font-bold text-[var(--color-ink-900)] mb-2">
              {t('review.complete', { defaultValue: '恭喜完成！' })}
            </h3>
            <p className="text-sm text-[var(--color-ink-500)] mb-6 max-w-xs leading-relaxed">
              {t('review.completeHint', { count: sessionNotes.length, defaultValue: `今天已复习 ${sessionNotes.length} 篇笔记。保持这个好习惯！` })}
            </p>
            <button
              onClick={onClose}
              className="btn-primary px-8 py-2.5"
            >
              {t('review.close', { defaultValue: '关闭' })}
            </button>
          </div>
        ) : (
          /* Card Review Session */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Progress */}
            <div className="flex items-center justify-between text-xs text-[var(--color-ink-500)] mb-4 shrink-0 font-medium">
              <span>{t('review.cardProgress', { current: currentIndex + 1, total: sessionNotes.length, defaultValue: `进度: ${currentIndex + 1} / ${sessionNotes.length}` })}</span>
              <span className="capitalize px-2 py-0.5 rounded bg-[var(--color-paper-deep)] border border-[var(--border)]">
                {currentNote?.type}
              </span>
            </div>

            {/* Flip Card Container */}
            <div className="flex-1 min-h-[260px] relative perspective-1000 mb-6">
              <div
                onClick={() => !isFlipped && setIsFlipped(true)}
                className={`w-full h-full rounded-xl border border-[var(--border)] bg-white shadow-sm transition-all duration-500 transform-style-3d cursor-pointer relative ${
                  isFlipped ? 'rotate-y-180' : 'hover:shadow-md'
                }`}
              >
                {/* Front Side */}
                <div className="absolute inset-0 backface-hidden p-6 flex flex-col justify-between">
                  <div className="flex-1 flex flex-col justify-center text-center">
                    <h4 className="text-lg font-serif font-bold text-[var(--color-ink-900)] leading-normal mb-4">
                      {currentNote?.title}
                    </h4>
                    {summaryClean && (
                      <p className="text-xs text-[var(--color-ink-500)] italic line-clamp-3 px-4 leading-relaxed">
                        &ldquo;{summaryClean.slice(0, 160)}...&rdquo;
                      </p>
                    )}
                  </div>
                  <div className="text-center text-[10px] text-[var(--color-ink-400)] font-semibold uppercase tracking-wider mt-4 animate-pulse">
                    {t('review.reveal', { defaultValue: '点击翻转显示卡片' })}
                  </div>
                </div>

                {/* Back Side */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 p-6 flex flex-col justify-between bg-[var(--color-cream-100)] rounded-xl overflow-hidden">
                  <div className="flex-1 overflow-y-auto pr-1">
                    <h4 className="text-sm font-semibold text-[var(--color-ink-900)] mb-2 font-serif border-b border-[var(--divider)] pb-1.5">
                      {t('review.showBack', { defaultValue: '核心内容 / 摘要要点' })}
                    </h4>
                    <p className="text-xs text-[var(--color-ink-700)] leading-relaxed whitespace-pre-wrap">
                      {summaryClean || currentNote?.body?.slice(0, 500) || '（无摘要）'}
                    </p>
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleOpenNote()
                    }}
                    className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-semibold border-none bg-transparent cursor-pointer py-1"
                  >
                    <BookOpen size={14} />
                    {t('review.openNote', { defaultValue: '打开笔记详情' })}
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* SM-2 Quality Button Bar */}
            {isFlipped ? (
              <div className="grid grid-cols-3 gap-3 shrink-0">
                <button
                  onClick={() => handleScore(1)}
                  className="flex flex-col items-center justify-center py-2.5 px-3 rounded-xl border border-rose-200 bg-rose-50/50 hover:bg-rose-50 text-rose-700 text-xs font-semibold transition-all cursor-pointer"
                >
                  <span className="text-sm mb-0.5">😟</span>
                  {t('review.forgot', { defaultValue: '忘记 / 模糊' })}
                </button>
                <button
                  onClick={() => handleScore(3)}
                  className="flex flex-col items-center justify-center py-2.5 px-3 rounded-xl border border-[var(--border)] bg-[var(--color-paper-deep)] hover:bg-[var(--color-accent-soft)] hover:border-[var(--color-accent)] text-[var(--color-ink-800)] hover:text-[var(--color-ink-900)] text-xs font-semibold transition-all cursor-pointer"
                >
                  <span className="text-sm mb-0.5">😐</span>
                  {t('review.good', { defaultValue: '记住 / 一般' })}
                </button>
                <button
                  onClick={() => handleScore(5)}
                  className="flex flex-col items-center justify-center py-2.5 px-3 rounded-xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 text-xs font-semibold transition-all cursor-pointer"
                >
                  <span className="text-sm mb-0.5">😊</span>
                  {t('review.easy', { defaultValue: '熟练 / 简单' })}
                </button>
              </div>
            ) : (
              <div className="h-[58px] shrink-0" /> // spacer to prevent layout shift
            )}
          </div>
        )}
      </div>
    </div>
  )
}
