import { describe, expect, it } from 'bun:test'
import {
  FEISHU_MENU_KEYS,
  buildSessionCenterCard,
  buildSessionSearchCard,
  buildSessionSelectedCard,
  isCurrentSessionIntent,
  isNewSessionIntent,
  isSessionCenterIntent,
  normalizeSessionCenterCategory,
} from '../session-center.js'

const NOW = Date.UTC(2026, 7, 28, 10, 0, 0)

describe('Feishu customer session center', () => {
  it('renders current session, categories and button-only session selection', () => {
    const current = {
      id: 's-current',
      title: '客户交付计划',
      updatedAt: NOW - 60_000,
      busy: true,
      projectName: 'Moss',
      originChannel: 'feishu' as const,
    }
    const card = buildSessionCenterCard({
      activeSessionId: current.id,
      currentSession: current,
      sessions: [
        current,
        {
          id: 's-old',
          title: '旧会话',
          updatedAt: NOW - 3_600_000,
          busy: false,
          originChannel: 'desktop',
        },
      ],
      category: 'recent',
      page: 0,
      pageSize: 5,
      total: 7,
      hasPrevious: false,
      hasNext: true,
    }, NOW) as any

    expect(card.schema).toBe('2.0')
    expect(card.header.title.content).toBe('会话中心')
    const visibleText = JSON.stringify(card, (key, value) => key === 'value' ? undefined : value)
    expect(visibleText).toContain('客户交付计划')
    expect(visibleText).not.toContain('s-current')

    const buttons = card.body.elements
      .flatMap((element: any) => element.columns || [])
      .flatMap((column: any) => column.elements || [])
      .filter((element: any) => element.tag === 'button')
    expect(buttons.some((button: any) => button.value.action === 'pick_session')).toBe(true)
    expect(buttons.some((button: any) => button.value.action === 'session_page')).toBe(true)
    expect(buttons.find((button: any) => button.value.sessionId === 's-current')?.disabled).toBe(true)
  })

  it('renders an input form for customer search', () => {
    const card = buildSessionSearchCard('project') as any
    const form = card.body.elements.find((element: any) => element.tag === 'form')
    expect(form.elements.find((element: any) => element.tag === 'input')?.name).toBe('query')
    expect(form.elements.find((element: any) => element.action_type === 'form_submit')?.value)
      .toEqual({ action: 'submit_session_search', category: 'project' })
  })

  it('renders a post-selection confirmation without exposing session ids', () => {
    const card = buildSessionSelectedCard({
      id: 'secret-id',
      title: '售后跟进',
      updatedAt: NOW,
      busy: false,
    })
    expect(JSON.stringify(card)).toContain('售后跟进')
    expect(JSON.stringify(card)).not.toContain('secret-id')
  })

  it('supports natural customer phrases while keeping legacy commands compatible', () => {
    expect(isSessionCenterIntent('切换会话')).toBe(true)
    expect(isSessionCenterIntent('会话中心')).toBe(true)
    expect(isSessionCenterIntent('/sessions 交付')).toBe(true)
    expect(isNewSessionIntent('开始新会话')).toBe(true)
    expect(isCurrentSessionIntent('当前会话')).toBe(true)
    expect(normalizeSessionCenterCategory('unknown')).toBe('recent')
    expect(FEISHU_MENU_KEYS).toEqual({
      sessions: 'moss.sessions',
      newSession: 'moss.new_session',
      current: 'moss.current',
      stop: 'moss.stop',
    })
  })
})
