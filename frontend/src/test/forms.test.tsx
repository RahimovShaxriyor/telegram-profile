import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/App'
import { EMPTY_RULE, validateRule } from '@/components/RuleEditor'
import type { Rule } from '@/lib/types'
import { apiError, demoStatus, mockApi, renderWithApp } from './utils'

const automation = {
  enabled: false,
  limits: { global_per_hour: 20, global_per_day: 100, per_chat_per_hour: 3, min_cooldown_minutes: 5, max_message_age_seconds: 120 },
  sent_last_hour: 0,
  sent_last_day: 0,
}

describe('rule validation', () => {
  it('requires name, reply and keywords; forbids groups without allowlist', () => {
    const errors = validateRule({ ...EMPTY_RULE, private_only: false })
    expect(Object.keys(errors).sort()).toEqual(['chat_ids', 'keywords', 'name', 'reply_text'])
  })
  it('enforces safety minimums and regex syntax', () => {
    const errors = validateRule({
      ...EMPTY_RULE, name: 'x', reply_text: 'ok', match_mode: 'regex', pattern: '(', cooldown_minutes: 1, daily_limit: 99,
    })
    expect(errors.pattern).toBeDefined()
    expect(errors.cooldown_minutes).toBe('Не меньше 5 минут')
    expect(errors.daily_limit).toBe('От 1 до 50')
  })
})

describe('rule editor', () => {
  it('validates, then creates a dry-run rule', async () => {
    let created: unknown = null
    const rules: Rule[] = []
    const calls = mockApi({
      'GET /api/status': demoStatus,
      'GET /api/updates': { version: 0 },
      'GET /api/automation': automation,
      'GET /api/rules': () => rules,
      'GET /api/activity': { items: [], total: 0 },
      'POST /api/rules': ({ body }: { body: unknown }) => {
        created = body
        const rule = { ...(body as Rule), id: 1, created_at: '', updated_at: '' }
        rules.push(rule)
        return rule
      },
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/automation' })
    await user.click(await screen.findByRole('button', { name: 'Новое правило' }))
    await user.click(screen.getByRole('button', { name: 'Создать правило' }))
    expect(screen.getByText('Назовите правило, чтобы узнавать его в журнале')).toBeInTheDocument()
    expect(screen.getByText('Добавьте хотя бы одно ключевое слово')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    await user.type(screen.getByLabelText('Название'), 'Отпуск')
    await user.type(screen.getByLabelText('Ключевые слова'), 'созвон{Enter}встреча{Enter}')
    await user.type(screen.getByLabelText('Текст автоответа'), 'Я в отпуске')
    await user.click(screen.getByRole('button', { name: 'Создать правило' }))

    await waitFor(() => expect(created).not.toBeNull())
    expect(created).toMatchObject({
      name: 'Отпуск', keywords: ['созвон', 'встреча'], reply_text: 'Я в отпуске', dry_run: true, enabled: false, private_only: true,
    })
    expect(await screen.findByText('Отпуск')).toBeInTheDocument()
    expect(screen.getByText('Тестовый режим')).toBeInTheDocument()
  })

  it('shows the server validation message', async () => {
    mockApi({
      'GET /api/status': demoStatus,
      'GET /api/updates': { version: 0 },
      'GET /api/automation': automation,
      'GET /api/rules': [],
      'GET /api/activity': { items: [], total: 0 },
      'POST /api/rules': () => apiError(422, 'validation_failed', 'Некорректное регулярное выражение'),
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/automation' })
    await user.click(await screen.findByRole('button', { name: 'Новое правило' }))
    await user.type(screen.getByLabelText('Название'), 'x')
    await user.type(screen.getByLabelText('Ключевые слова'), 'a{Enter}')
    await user.type(screen.getByLabelText('Текст автоответа'), 'ok')
    await user.click(screen.getByRole('button', { name: 'Создать правило' }))
    expect(await screen.findByText('Некорректное регулярное выражение')).toBeInTheDocument()
  })
})

