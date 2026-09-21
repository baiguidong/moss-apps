export type SessionCenterCategory = 'recent' | 'feishu' | 'project'

export type SessionCenterItem = {
  id: string
  title: string
  preview?: string
  updatedAt: number
  busy: boolean
  projectName?: string | null
  originChannel?: 'desktop' | 'feishu' | 'cron'
}

export type SessionCenterPage = {
  activeSessionId?: string | null
  currentSession?: SessionCenterItem | null
  sessions: SessionCenterItem[]
  category: SessionCenterCategory
  query?: string
  page: number
  pageSize: number
  total: number
  hasPrevious: boolean
  hasNext: boolean
}

export const FEISHU_MENU_KEYS = {
  sessions: 'moss.sessions',
  newSession: 'moss.new_session',
  current: 'moss.current',
  stop: 'moss.stop',
} as const

const CATEGORY_LABELS: Record<SessionCenterCategory, string> = {
  recent: '最近',
  feishu: '飞书',
  project: '项目',
}

function escapeCardMarkdown(value: unknown): string {
  return String(value || '').replace(/([\\`*_{}\[\]()#+.!|>~-])/g, '\\$1')
}

function formatRelativeTime(updatedAt: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - Number(updatedAt || 0))
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function normalizeSessionCenterCategory(value: unknown): SessionCenterCategory {
  return value === 'feishu' || value === 'project' ? value : 'recent'
}

export function isSessionCenterIntent(text: string): boolean {
  const normalized = text.trim()
  return [
    '会话',
    '会话中心',
    '会话列表',
    '切换会话',
    '选择会话',
    '打开会话',
    '/sessions',
  ].includes(normalized) || normalized.startsWith('/sessions ')
}

export function isNewSessionIntent(text: string): boolean {
  const normalized = text.trim()
  return normalized === '新会话' || normalized === '开始新会话' || normalized === '/new'
    || normalized.startsWith('/new ')
}

export function isCurrentSessionIntent(text: string): boolean {
  return ['当前会话', '查看当前会话', '/current', '/status', '状态'].includes(text.trim())
}

function sessionContext(session: SessionCenterItem, now?: number): string {
  return [
    session.projectName,
    session.originChannel === 'feishu' ? '来自飞书' : '来自桌面端',
    session.busy ? '处理中' : null,
    formatRelativeTime(session.updatedAt, now),
  ].filter(Boolean).join(' · ')
}

function actionButton(label: string, action: string, value: Record<string, unknown> = {}, type = 'default') {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type,
    size: 'small',
    value: { action, ...value },
  }
}

export function buildSessionCenterCard(data: SessionCenterPage, now = Date.now()): Record<string, unknown> {
  const category = normalizeSessionCenterCategory(data.category)
  const current = data.currentSession || null
  const query = String(data.query || '').trim()
  const elements: Array<Record<string, unknown>> = []

  elements.push({
    tag: 'markdown',
    content: current
      ? `**当前会话**\n${escapeCardMarkdown(current.title)}  ·  ${current.busy ? '处理中' : '可继续'}`
      : '**当前会话**\n尚未选择，发送消息时会自动创建。',
  })
  elements.push({ tag: 'hr', margin: '12px 0' })
  elements.push({
    tag: 'column_set',
    flex_mode: 'stretch',
    horizontal_spacing: '6px',
    columns: (Object.keys(CATEGORY_LABELS) as SessionCenterCategory[]).map((item) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements: [actionButton(
        CATEGORY_LABELS[item],
        'session_center',
        { category: item, page: 0 },
        item === category ? 'primary' : 'default',
      )],
    })),
  })

  if (query) {
    elements.push({
      tag: 'markdown',
      content: `搜索：**${escapeCardMarkdown(query)}**`,
      text_size: 'notation',
      margin: '10px 0 0 0',
    })
  }

  if (data.sessions.length === 0) {
    elements.push({
      tag: 'markdown',
      content: query ? '没有找到匹配的会话。' : '这个分类下还没有可继续的会话。',
      margin: '12px 0 0 0',
    })
  } else {
    data.sessions.forEach((session, index) => {
      const active = session.id === data.activeSessionId
      elements.push({
        tag: 'column_set',
        flex_mode: 'stretch',
        horizontal_spacing: '8px',
        margin: index === 0 ? '12px 0 0 0' : '10px 0 0 0',
        columns: [
          {
            tag: 'column',
            width: 'weighted',
            weight: 1,
            vertical_align: 'center',
            elements: [
              { tag: 'markdown', content: `**${escapeCardMarkdown(session.title)}**${active ? '  ·  当前' : ''}` },
              {
                tag: 'markdown',
                content: escapeCardMarkdown(sessionContext(session, now)),
                text_size: 'notation',
                margin: '2px 0 0 0',
              },
            ],
          },
          {
            tag: 'column',
            width: 'auto',
            vertical_align: 'center',
            elements: [{
              ...actionButton(active ? '当前' : '切换', 'pick_session', { sessionId: session.id }),
              disabled: active,
            }],
          },
        ],
      })
    })
  }

  elements.push({ tag: 'hr', margin: '14px 0 8px 0' })
  const footerColumns: Array<Record<string, unknown>> = [
    {
      tag: 'column', width: 'weighted', weight: 1,
      elements: [actionButton('新建', 'new_session', {}, 'primary')],
    },
    {
      tag: 'column', width: 'weighted', weight: 1,
      elements: [actionButton('搜索', 'search_sessions', { category })],
    },
  ]
  if (data.hasPrevious) {
    footerColumns.push({
      tag: 'column', width: 'weighted', weight: 1,
      elements: [actionButton('上一页', 'session_page', { category, page: data.page - 1, query })],
    })
  }
  if (data.hasNext) {
    footerColumns.push({
      tag: 'column', width: 'weighted', weight: 1,
      elements: [actionButton('下一页', 'session_page', { category, page: data.page + 1, query })],
    })
  }
  elements.push({
    tag: 'column_set',
    flex_mode: 'stretch',
    horizontal_spacing: '6px',
    columns: footerColumns,
  })

  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '会话中心' },
      subtitle: {
        tag: 'plain_text',
        content: data.total > 0
          ? `${CATEGORY_LABELS[category]} · 第 ${data.page + 1} 页 · 共 ${data.total} 个`
          : CATEGORY_LABELS[category],
      },
      template: 'blue',
    },
    body: { elements },
  }
}

export function buildSessionSelectedCard(session: SessionCenterItem): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: session.title || 'Moss 会话' },
      subtitle: { tag: 'plain_text', content: '已设为当前会话' },
      template: 'green',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: session.busy ? '这个会话正在处理任务。新消息会排队执行。' : '现在可以直接发送消息继续这个会话。',
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '返回会话中心' },
          type: 'default',
          value: { action: 'session_center', category: 'recent', page: 0 },
          margin: '10px 0 0 0',
        },
      ],
    },
  }
}

export function buildSessionSearchCard(category: SessionCenterCategory): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '搜索会话' },
      subtitle: { tag: 'plain_text', content: '按会话名称、内容摘要或项目名称搜索' },
      template: 'blue',
    },
    body: {
      elements: [
        {
          tag: 'form',
          name: 'session_search_form',
          elements: [
            {
              tag: 'input',
              name: 'query',
              placeholder: { tag: 'plain_text', content: '输入关键词' },
              width: 'fill',
            },
            {
              tag: 'button',
              name: 'submit_session_search',
              text: { tag: 'plain_text', content: '搜索' },
              type: 'primary',
              action_type: 'form_submit',
              value: { action: 'submit_session_search', category },
              margin: '10px 0 0 0',
            },
          ],
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '返回会话中心' },
          type: 'default',
          value: { action: 'session_center', category, page: 0 },
          margin: '10px 0 0 0',
        },
      ],
    },
  }
}
