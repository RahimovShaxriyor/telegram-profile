import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/App'
import { AiAssistantCard } from '@/components/AiAssistantCard'
import type { AiStatus, Rule } from '@/lib/types'
import { apiError, demoStatus, mockApi, renderWithApp } from './utils'

const automation = {
  enabled: false,
  limits: { global_per_hour: 20, global_per_day: 100, per_chat_per_hour: 3, min_cooldown_minutes: 5, max_message_age_seconds: 120 },
  sent_last_hour: 0,
  sent_last_day: 0,
}
const settings = { persona: '', knowledge: '', max_reply_chars: 600, history_messages: 12 }
const aiOff: AiStatus = { configured: false, key_source: null, model: 'claude-opus-5-5', settings }
const aiOn: AiStatus = { ...aiOff, configured: true, key_source: 'account' }

describe('AI assistant card', () => {
  it('verifies and stores the key, then saves the knowledge base', async () => {
    const calls = mockApi({
      'GET /api/ai': aiOff,
      'PUT /api/ai/key': aiOn,
      'PUT /api/ai/settings': ({ body }: { body: unknown }) => ({ ...aiOn, settings: body }),
    })
    const user = userEvent.setup()
    renderWithApp(<AiAssistantCard />)
    expect(await screen.findByText('Нужен ключ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Получить ответ/ })).toBeDisabled()

    await user.type(screen.getByLabelText('Ключ Anthropic API'), 'sk-ant-api03-' + 'x'.repeat(30))
    await user.click(screen.getByRole('button', { name: 'Проверить и сохранить' }))
    expect(await screen.findByText('Подключён')).toBeInTheDocument()
    expect(screen.getByText(/в зашифрованном виде и используется только/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('База знаний'), 'Доставка 15 000 сум')
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/ai/settings')).toBe(true))
    expect(calls.find((c) => c.path === '/api/ai/settings')!.body).toMatchObject({ knowledge: 'Доставка 15 000 сум' })
  })

  it('shows the key error from the server', async () => {
    mockApi({ 'GET /api/ai': aiOff, 'PUT /api/ai/key': () => apiError(502, 'ai_bad_key', 'Anthropic не принял ключ.') })
    const user = userEvent.setup()
    renderWithApp(<AiAssistantCard />)
    await user.type(await screen.findByLabelText('Ключ Anthropic API'), 'sk-ant-api03-' + 'x'.repeat(30))
    await user.click(screen.getByRole('button', { name: 'Проверить и сохранить' }))
    expect(await screen.findByText('Anthropic не принял ключ.')).toBeInTheDocument()
  })

  it('previews a reply or a decision not to answer', async () => {
    let decline = false
    mockApi({
      'GET /api/ai': aiOn,
      'POST /api/ai/preview': () =>
        decline
          ? { should_reply: false, reply: '', reason: 'Спам', input_tokens: 90, output_tokens: 10 }
          : { should_reply: true, reply: 'Доставка стоит 15 000 сум.', reason: 'Вопрос о доставке', input_tokens: 100, output_tokens: 20 },
    })
    const user = userEvent.setup()
    renderWithApp(<AiAssistantCard />)
    const input = await screen.findByLabelText('Пример входящего сообщения для ИИ')
    await user.type(input, 'Сколько доставка?{Enter}')
    expect(await screen.findByText('Доставка стоит 15 000 сум.')).toBeInTheDocument()
    expect(screen.getByText(/токенов: 100 \+ 20/)).toBeInTheDocument()
    decline = true
    await user.click(screen.getByRole('button', { name: /Получить ответ/ }))
    expect(await screen.findByText(/не стал бы отвечать/)).toBeInTheDocument()
  })
})

describe('AI rule', () => {
  it('creates a rule whose reply is written by AI', async () => {
    let created: Record<string, unknown> | null = null
    const rules: Rule[] = []
    mockApi({
      'GET /api/status': demoStatus,
      'GET /api/updates': { version: 0 },
      'GET /api/automation': automation,
      'GET /api/ai': aiOn,
      'GET /api/rules': () => rules,
      'GET /api/activity': { items: [], total: 0 },
      'POST /api/rules': ({ body }: { body: unknown }) => {
        created = body as Record<string, unknown>
        const rule = { ...(body as Rule), id: 1, created_at: '', updated_at: '' }
        rules.push(rule)
        return rule
      },
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/automation' })
    await user.click(await screen.findByRole('button', { name: 'Новое правило' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Название'), 'Ответы клиентам')
    await user.click(screen.getByRole('tab', { name: 'На любое сообщение' }))
    await user.click(screen.getByRole('tab', { name: /Ответ составит ИИ/ }))
    expect(screen.queryByLabelText('Текст автоответа')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/Указания для ИИ/), 'Только про доставку')
    await user.click(screen.getByRole('button', { name: 'Создать правило' }))
    await waitFor(() => expect(created).not.toBeNull())
    expect(created).toMatchObject({ reply_mode: 'ai', ai_instructions: 'Только про доставку', reply_text: '', match_mode: 'any' })
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(await screen.findByText('Только про доставку')).toBeInTheDocument()
  })
})
