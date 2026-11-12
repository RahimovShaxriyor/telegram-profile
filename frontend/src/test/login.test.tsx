import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/App'
import type { SessionInfo, Status } from '@/lib/types'
import { apiError, demoStatus, mockApi, renderWithApp } from './utils'

const signedOut: SessionInfo = {
  signed_in: false,
  kind: null,
  user: null,
  registration_open: true,
  server_configured: true,
  setup_allowed: false,
  login: null,
}

const owner: SessionInfo = {
  ...signedOut,
  signed_in: true,
  kind: 'user',
  user: { id: 42, name: 'Иван Тестов', username: 'ivan', phone_masked: '+998 *** *** 55', is_owner: true },
}

const userStatus: Status = {
  ...demoStatus,
  mode: 'telegram',
  is_owner: true,
  connection: { ...demoStatus.connection, mode: 'telegram' },
}

const overview = {
  dialogs_total: 0, dialogs_loaded: 0, kinds: { user: 0, bot: 0, group: 0, supergroup: 0, channel: 0 }, unread_chats: 0,
  rules_total: 0, rules_enabled: 0, recent_activity: [],
  automation: { enabled: false, limits: { global_per_hour: 20, global_per_day: 100, per_chat_per_hour: 3, min_cooldown_minutes: 5, max_message_age_seconds: 120 }, sent_last_hour: 0, sent_last_day: 0 },
}

describe('sign-in screen', () => {
  it('signs in with phone and code', async () => {
    let session = signedOut
    const calls = mockApi({
      'GET /api/session': () => session,
      'POST /api/login/phone': { step: 'code', phone_masked: '+998 *** *** 55', password_hint: null },
      'POST /api/login/code': ({ body }: { body: unknown }) => {
        if ((body as { code: string }).code !== '12345') return apiError(422, 'validation_failed', 'Неверный код.')
        session = owner
        return { step: 'done', phone_masked: null, password_hint: null }
      },
      'GET /api/status': userStatus,
      'GET /api/updates': { version: 0 },
      'GET /api/overview': overview,
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />)
    expect(await screen.findByRole('heading', { name: 'Вход через Telegram' })).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: /Получить код/ })
    await user.type(screen.getByLabelText('Номер телефона'), '998901234555')
    expect(submit).toBeDisabled() // terms not accepted yet
    await user.click(screen.getByRole('checkbox'))
    await user.click(submit)
    expect(calls.find((c) => c.path === '/api/login/phone')!.body).toEqual({ phone: '+998901234555', accept_terms: true })

    expect(await screen.findByText(/Никому не сообщайте/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Код из Telegram'), '00000')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByText('Неверный код.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Код из Telegram'))
    await user.type(screen.getByLabelText('Код из Telegram'), '12345')
    await user.click(screen.getByRole('button', { name: 'Войти' }))
    expect(await screen.findByRole('heading', { level: 1, name: /, Демо$/ })).toBeInTheDocument()
  })

  it('asks for the 2FA password with its hint', async () => {
    mockApi({
      'GET /api/session': { ...signedOut, login: { step: 'password', phone_masked: '+998 *** *** 55', password_hint: 'кот' } },
      'POST /api/login/password': () => apiError(422, 'validation_failed', 'Неверный облачный пароль'),
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />)
    expect(await screen.findByText('Подсказка: кот')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Пароль/), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Подтвердить' }))
    expect(await screen.findByText('Неверный облачный пароль')).toBeInTheDocument()
  })

  it('opens the demo without signing in', async () => {
    let session = signedOut
    const calls = mockApi({
      'GET /api/session': () => session,
      'POST /api/guest': () => {
        session = { ...signedOut, signed_in: true, kind: 'guest' }
        return undefined
      },
      'GET /api/status': demoStatus,
      'GET /api/updates': { version: 0 },
      'GET /api/overview': overview,
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />)
    await user.click(await screen.findByRole('button', { name: /Посмотреть демо/ }))
    expect(await screen.findByText(/все чаты и сообщения вымышленные/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/guest')).toBe(true)
  })

  it('shows first-run setup only on the server computer', async () => {
    const calls = mockApi({
      'GET /api/session': { ...signedOut, server_configured: false, setup_allowed: true },
      'POST /api/setup': undefined,
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />)
    expect(await screen.findByRole('heading', { name: 'Настройка сервера' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('API ID'), '1234567')
    await user.type(screen.getByLabelText('API HASH'), 'a'.repeat(32))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/setup')).toBe(true))
  })

  it('warns when registration is closed', async () => {
    mockApi({ 'GET /api/session': { ...signedOut, registration_open: false } })
    renderWithApp(<AppRoutes />)
    expect(await screen.findByText(/Регистрация новых пользователей закрыта/)).toBeInTheDocument()
  })
})

describe('signed-in user', () => {
  it('logs out back to the sign-in screen', async () => {
    let session: SessionInfo = owner
    mockApi({
      'GET /api/session': () => session,
      'GET /api/status': userStatus,
      'GET /api/updates': { version: 0 },
      'POST /api/logout': () => {
        session = signedOut
        return undefined
      },
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/account' })
    await user.click(await screen.findByRole('button', { name: /Выйти на этом устройстве/ }))
    expect(await screen.findByRole('heading', { name: 'Вход через Telegram' })).toBeInTheDocument()
  })

  it('shows the admin page only to the owner', async () => {
    mockApi({
      'GET /api/session': owner,
      'GET /api/status': userStatus,
      'GET /api/updates': { version: 0 },
      'GET /api/admin': {
        registration_open: true, max_users: 200, guests_active: 1,
        users: [
          { id: 42, name: 'Иван', username: null, phone_masked: null, is_owner: true, online: true, created_at: new Date().toISOString(), last_login_at: new Date().toISOString() },
          { id: 7, name: 'Анна', username: 'anna', phone_masked: null, is_owner: false, online: false, created_at: new Date().toISOString(), last_login_at: new Date().toISOString() },
        ],
      },
    })
    renderWithApp(<AppRoutes />, { path: '/admin' })
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' })
    expect(await within(nav).findByRole('link', { name: 'Пользователи' })).toBeInTheDocument()
    expect(await screen.findByText('Анна')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить Анна' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить Иван' })).not.toBeInTheDocument()
  })

  it('hides admin navigation from regular users', async () => {
    mockApi({
      'GET /api/session': { ...owner, user: { ...owner.user!, is_owner: false } },
      'GET /api/status': { ...userStatus, is_owner: false },
      'GET /api/updates': { version: 0 },
      'GET /api/overview': overview,
    })
    renderWithApp(<AppRoutes />)
    const nav = await screen.findByRole('navigation', { name: 'Основная навигация' })
    expect(within(nav).queryByRole('link', { name: 'Пользователи' })).not.toBeInTheDocument()
  })
})
