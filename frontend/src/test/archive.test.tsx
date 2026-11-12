import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/App'
import type { ArchivedMessage, ArchiveStats, ImportStatus } from '@/lib/types'
import { apiError, chatDetails, demoStatus, dialog, message, mockApi, renderWithApp } from './utils'

const stats: ArchiveStats = { messages: 3, deleted: 1, edited: 1, chats: 1, media_files: 0, media_bytes: 0, database_bytes: 1 }

const archived = (overrides: Partial<ArchivedMessage>): ArchivedMessage => ({
  id: 1,
  chat_id: 2001,
  chat_title: 'Анна Смирнова',
  message_id: 10,
  date: new Date().toISOString(),
  sender_name: 'Анна Смирнова',
  outgoing: false,
  text: 'Привет',
  reply_to_id: null,
  media: null,
  has_file: false,
  edited_at: null,
  deleted_at: null,
  edit_count: 0,
  source: 'live',
  ...overrides,
})

const base = {
  'GET /api/status': demoStatus,
  'GET /api/updates': { version: 0 },
  'GET /api/archive/stats': stats,
  'GET /api/archive/chats': [{ id: 2001, title: 'Анна Смирнова', kind: 'user', messages: 3, deleted: 1, edited: 1, last_date: null }],
}

describe('deleted messages in a chat', () => {
  it('keeps a deleted message visible with a clear mark', async () => {
    mockApi({
      ...base,
      'GET /api/dialogs': { items: [dialog({})], total: 1 },
      'GET /api/chats/2001': chatDetails(),
      'GET /api/chats/2001/messages': {
        items: [message({ id: 1, text: 'Обычное' }), message({ id: 2, text: 'Это удалили', deleted: true })],
        next_before_id: null,
      },
    })
    renderWithApp(<AppRoutes />, { path: '/messages?chat=2001' })
    expect(await screen.findByText('Это удалили')).toBeInTheDocument()
    expect(screen.getByText(/Удалено · сохранено в архиве/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Ответить на сообщение/ })).toHaveLength(1) // no reply to deleted
  })
})

describe('archive page', () => {
  it('filters deleted messages and shows edit history', async () => {
    const calls = mockApi({
      ...base,
      'GET /api/archive/messages': ({ url }: { url: URL }) => {
        const only = url.searchParams.get('only')
        const items =
          only === 'deleted'
            ? [archived({ id: 2, text: 'Удалённое сообщение', deleted_at: new Date().toISOString() })]
            : [archived({ id: 3, text: 'Цена 150', edited_at: new Date().toISOString(), edit_count: 1 })]
        return { items, total: items.length, next_cursor: null }
      },
      'GET /api/archive/messages/3/edits': [{ old_text: 'Цена 100', new_text: 'Цена 150', edited_at: new Date().toISOString() }],
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/archive' })
    expect(await screen.findByText('Сообщений в архиве')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Изменено · 1/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Цена 100')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('tab', { name: /Удалённые/ }))
    expect(await screen.findByText('Удалённое сообщение')).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.url.searchParams.get('only') === 'deleted')).toBe(true))
  })

  it('uploads a Telegram export and reports a bad file', async () => {
    let status: ImportStatus = {
      state: 'idle', path: null, chats_done: 0, messages_imported: 0, messages_skipped: 0,
      current_chat: null, error: null, started_at: null, finished_at: null,
    }
    let attempts = 0
    mockApi({
      ...base,
      'GET /api/archive/messages': { items: [], total: 0, next_cursor: null },
      'GET /api/archive/import': () => status,
      'POST /api/archive/import/upload': () => {
        attempts += 1
        if (attempts === 1) return apiError(422, 'validation_failed', 'Выберите файл result.json из папки экспорта Telegram')
        status = { ...status, state: 'done', chats_done: 2, messages_imported: 5 }
        return status
      },
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/archive' })
    await user.click(await screen.findByRole('tab', { name: /Импорт/ }))
    const input = screen.getByLabelText('Файл result.json')
    expect(screen.queryByLabelText(/папка экспорта на сервере/i)).not.toBeInTheDocument() // owner only
    await user.upload(input, new File(['{}'], 'result.json', { type: 'application/json' }))
    await user.click(screen.getByRole('button', { name: /Загрузить и импортировать/ }))
    expect(await screen.findByText('Выберите файл result.json из папки экспорта Telegram')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Загрузить и импортировать/ }))
    expect(await screen.findByText('Импорт завершён')).toBeInTheDocument()
    expect(screen.getByText(/добавлено сообщений: 5/)).toBeInTheDocument()
  })

  it('saves archive scope settings', async () => {
    const calls = mockApi({
      ...base,
      'GET /api/archive/messages': { items: [], total: 0, next_cursor: null },
      'GET /api/archive/settings': { enabled: true, private_chats: true, groups: false, chat_ids: [], media: 'photos', max_media_mb: 20 },
      'PUT /api/archive/settings': ({ body }: { body: unknown }) => body,
      'GET /api/system/autostart': { enabled: false, supported: true },
      'GET /api/dialogs': { items: [], total: 0 },
    })
    const user = userEvent.setup()
    renderWithApp(<AppRoutes />, { path: '/archive' })
    await user.click(await screen.findByRole('tab', { name: 'Настройки' }))
    await user.click(await screen.findByRole('switch', { name: 'Все группы' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ groups: true, private_chats: true })
    expect(screen.queryByRole('switch', { name: 'Автозапуск с Windows' })).not.toBeInTheDocument() // server setting: owner only
  })
})
