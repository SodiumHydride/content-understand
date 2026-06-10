import type { LibraryItem } from './types'

const demoSlugs = new Set(['video/demo-welcome', 'article/demo-read', 'notes/demo-thought'])

export function buildDemoLibrary(lng: 'zh' | 'en'): LibraryItem[] {
  if (lng === 'zh') {
    return [
      {
        slug: 'video/demo-welcome',
        path: 'video/demo-welcome.md',
        title: '欢迎使用 Content Understand',
        type: 'video',
        platform: 'demo',
        url: 'https://example.com/welcome',
        summary: '演示笔记。连接引擎后，理解结果会写入你的 Vault。',
        tags: ['demo'],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        body: `# 欢迎使用\n\n## 摘要\n\n这是演示数据。\n\n## 要点\n\n- 粘贴链接或写一条笔记\n- 重要的贴上便签架\n- 在导图里随意摆`
      },
      {
        slug: 'article/demo-read',
        path: 'article/demo-read.md',
        title: '如何建立个人 Wiki',
        type: 'article',
        platform: 'web',
        url: 'https://example.com/wiki',
        summary: '收录 → 时间线积累 → 导图看关系。重要的贴便签架。',
        tags: ['wiki', '方法'],
        created: new Date(Date.now() - 86400000).toISOString(),
        updated: new Date(Date.now() - 3600000).toISOString(),
        body: `# 如何建立个人 Wiki\n\n## 摘要\n\n用时间线感受积累，用便签架放精选。\n\n## 要点\n\n- 时间线：全部笔记\n- 便签架：pinned 重要\n- 导图：思考 + 全库`
      },
      {
        slug: 'notes/demo-thought',
        path: 'notes/demo-thought.md',
        title: '一条手写笔记',
        type: 'article',
        platform: 'self',
        url: '',
        summary: '自己写的想法也会出现在时间线里，重要的可以贴上便签架。',
        tags: ['笔记'],
        created: new Date(Date.now() - 172800000).toISOString(),
        updated: new Date(Date.now() - 7200000).toISOString(),
        body: `# 一条手写笔记\n\n这里是从「写一条」进来的空白笔记示例。\n\n可以贴上便签架，也可以拖进思考导图。`
      }
    ]
  }
  return [
    {
      slug: 'video/demo-welcome',
      path: 'video/demo-welcome.md',
      title: 'Welcome to Content Understand',
      type: 'video',
      platform: 'demo',
      url: 'https://example.com/welcome',
      summary: 'Demo note. Connect the engine for real results.',
      tags: ['demo'],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      body: `# Welcome\n\n## Summary\n\nDemo data for the UI.\n\n## Highlights\n\n- Paste a link or write a note\n- Pin important ones\n- Arrange on the map`
    },
    {
      slug: 'article/demo-read',
      path: 'article/demo-read.md',
      title: 'Building a personal wiki',
      type: 'article',
      platform: 'web',
      url: 'https://example.com/wiki',
      summary: 'Capture → timeline → map. Pin what matters on the sticky wall.',
      tags: ['wiki'],
      created: new Date(Date.now() - 86400000).toISOString(),
      updated: new Date(Date.now() - 3600000).toISOString(),
      body: `# Building a personal wiki\n\n## Summary\n\nTimeline for growth, sticky wall for favorites.\n\n## Highlights\n\n- Timeline: everything\n- Sticky wall: pinned\n- Map: thinking + wiki`
    },
    {
      slug: 'notes/demo-thought',
      path: 'notes/demo-thought.md',
      title: 'A handwritten note',
      type: 'article',
      platform: 'self',
      url: '',
      summary: 'Notes you write appear on the timeline; pin the important ones.',
      tags: ['note'],
      created: new Date(Date.now() - 172800000).toISOString(),
      updated: new Date(Date.now() - 7200000).toISOString(),
      body: `# A handwritten note\n\nExample from **Write a note**.\n\nPin it or drop it on the thinking map.`
    }
  ]
}

export function demoLibraryFor(lng: 'zh' | 'en'): LibraryItem[] {
  return buildDemoLibrary(lng)
}

export function isDemoLibrary(items: LibraryItem[]): boolean {
  if (items.length === 0) return false
  return items.every((i) => demoSlugs.has(i.slug))
}
