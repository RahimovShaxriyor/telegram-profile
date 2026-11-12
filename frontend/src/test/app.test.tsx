import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/App'
import { formatBytes, initials, plural } from '@/lib/format'
import type { Overview } from '@/lib/types'
import { apiError, chatDetails, demoStatus, dialog, message, mockApi, renderWithApp } from './utils'

const overview: Overview = {
  dialogs_total: 13,
  dialogs_loaded: 13,
  kinds: { user: 6, bot: 1, group: 1, supergroup: 2, channel: 3 },
  unread_chats: 5,
  rules_total: 0,
  rules_enabled: 0,
  automation: {
    enabled: false,
    limits: { global_per_hour: 20, global_per_day: 100, per_chat_per_hour: 3, min_cooldown_minutes: 5, max_message_age_seconds: 120 },
    sent_last_hour: 0,
    sent_last_day: 0,
  },
  recent_activity: [],
}

const baseRoutes = {
  'GET /api/status': demoStatus,
  'GET /api/updates': { version: 0 },
  'GET /api/overview': overview,
}

describe('format helpers', () => {
  it('pluralizes Russian nouns', () => {
    expect(plural(1, 'час', 'часа', 'часов')).toBe('час')
    expect(plural(3, 'час', 'часа', 'часов')).toBe('часа')
    expect(plural(11, 'час', 'часа', 'часов')).toBe('часов')
    expect(plural(22, 'час', 'часа', 'часов')).toBe('часа')
  })
  it('formats sizes and initials', () => {
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(1536)).toBe('1,5 КБ')
    expect(initials('Анна Смирнова')).toBe('АС')
    expect(initials('🎉')).toBe('?')
  })
})

describe('navigation', () => {
  it('renders the dashboard with demo data and the demo banner', async () => {
    mockApi(baseRoutes)
    renderWithApp(<AppRoutes />)
    expect(await screen.findByRole('heading', { name: /Демо$/ })).toBeInTheDocument()
    expect(await screen.findByText('Непрочитанные чаты')).toBeInTheDocument()
    expect(screen.getByText(/все чаты и сообщения вымышленные/)).toBeInTheDocument()
  })

  it('navigates between sections from the sidebar', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/automation': overview.automation,
      'GET /api/rules': [],
      'GET /api/activity': { items: [], total: 0 },
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />)
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' })
    await user.click(within(nav).getByRole('link', { name: 'Автоматизация' }))
    expect(await screen.findByRole('heading', { name: 'Автоматизация', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Правил пока нет')).toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Журнал' }))
    expect(await screen.findByRole('heading', { name: 'Журнал действий' })).toBeInTheDocument()
    expect(await screen.findByText('Журнал пуст')).toBeInTheDocument()
  })

  it('shows a not-found page for unknown routes', async () => {
    mockApi(baseRoutes)
    renderWithApp(<AppRoutes />, { path: '/nope' })
    expect(await screen.findByText('Страница не найдена')).toBeInTheDocument()
  })

  it('asks to connect Telegram when real mode is not configured', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/status': {
        ...demoStatus,
        mode: 'telegram',
        connection: { ...demoStatus.connection, mode: 'telegram', state: 'not_configured', account: null },
      },
    })
    renderWithApp(<AppRoutes />, { path: '/messages' })
    expect(await screen.findByText('Telegram не подключён')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Подключить Telegram' })).toHaveAttribute('href', '/account')
  })
})

describe('messages scenario', () => {
  it('opens a chat, replies to a message and sends text', async () => {
    const sent = message({ id: 3, text: 'Буду в 15:30', outgoing: true, reply_to_id: 2, sender_name: 'Демо Пользователь' })
    const calls = mockApi({
      ...baseRoutes,
      'GET /api/dialogs': { items: [dialog({ unread_count: 2 }), dialog({ id: -100, title: 'Команда', kind: 'supergroup' })], total: 2 },
      'GET /api/chats/2001': chatDetails(),
      'GET /api/chats/2001/messages': {
        items: [message({ id: 1, text: 'Привет!' }), message({ id: 2, text: 'Созвон в 15:00?' })],
        next_before_id: null,
      },
      'POST /api/chats/2001/messages': sent,
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/messages' })

    await user.click(await screen.findByRole('button', { name: /Анна Смирнова/ }))
    expect(await screen.findByText('Созвон в 15:00?')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /Ответить на сообщение/ })[1])
    expect(screen.getByText('Ответ: Анна Смирнова')).toBeInTheDocument()

    const box = screen.getByLabelText('Текст сообщения')
    await user.type(box, 'Буду в 15:30{Enter}')

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ text: 'Буду в 15:30', reply_to: 2 })
    expect(await screen.findByText('Буду в 15:30')).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(screen.queryByText('Ответ: Анна Смирнова')).not.toBeInTheDocument()
  })

  it('filters dialogs by title and switches to message search', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/dialogs': { items: [dialog({}), dialog({ id: -100, title: 'Команда', kind: 'supergroup' })], total: 2 },
      'GET /api/search': [{ chat_id: -100, chat_title: 'Команда', message: message({ chat_id: -100, text: 'релиз в четверг' }) }],
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/messages' })
    await screen.findByRole('button', { name: /Анна Смирнова/ })
    await user.type(screen.getByLabelText('Поиск'), 'ком')
    await waitFor(() => expect(screen.queryByRole('button', { name: /Анна Смирнова/ })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Команда/ })).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Поиск'))
    await user.type(screen.getByLabelText('Поиск'), 'релиз')
    await user.click(await screen.findByRole('button', { name: 'Искать в сообщениях' }))
    expect(await screen.findByRole('list', { name: 'Результаты поиска' })).toHaveTextContent('релиз в четверг')
  })

  it('shows a friendly error and keeps the text when sending fails', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/dialogs': { items: [dialog({})], total: 1 },
      'GET /api/chats/2001': chatDetails(),
      'GET /api/chats/2001/messages': { items: [message({})], next_before_id: null },
      'POST /api/chats/2001/messages': () => apiError(403, 'permission_denied', 'Вам запрещено писать в этот чат'),
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/messages?chat=2001' })
    const box = await screen.findByLabelText('Текст сообщения')
    await user.type(box, 'тест{Enter}')
    expect(await screen.findByText('Вам запрещено писать в этот чат')).toBeInTheDocument()
    expect(box).toHaveValue('тест')
  })

  it('disables the composer where sending is not allowed', async () => {
    mockApi({
      ...baseRoutes,
      'GET /api/dialogs': { items: [dialog({ id: -5, title: 'Новости', kind: 'channel' })], total: 1 },
      'GET /api/chats/-5': chatDetails({ id: -5, title: 'Новости', kind: 'channel', can_send: false }),
      'GET /api/chats/-5/messages': { items: [message({ chat_id: -5, views: 1200 })], next_before_id: null },
    })
    renderWithApp(<AppRoutes />, { path: '/messages?chat=-5' })
    expect(await screen.findByText(/нет права публиковать/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Текст сообщения')).not.toBeInTheDocument()
  })
})
