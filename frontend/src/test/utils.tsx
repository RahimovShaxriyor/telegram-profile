import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { AppProviders, createQueryClient } from '@/App'
import type { ChatDetails, Dialog, Message, SessionInfo, Status } from '@/lib/types'

export interface ApiCall {
  method: string
  path: string
  url: URL
  body: unknown
}

type Handler = (call: ApiCall) => unknown
export type Routes = Record<string, unknown | Handler>

/** Replaces fetch with an in-memory API keyed by "METHOD /path". Unknown routes return 404. */
export const guestSession: SessionInfo = {
  signed_in: true,
  kind: 'guest',
  user: null,
  registration_open: true,
  server_configured: true,
  setup_allowed: false,
  login: null,
}

export function mockApi(customRoutes: Routes): ApiCall[] {
  const routes: Routes = { 'GET /api/session': guestSession, ...customRoutes }
  const calls: ApiCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      const call = { method, path: url.pathname, url, body }
      calls.push(call)
      const route = routes[`${method} ${url.pathname}`]
      if (route === undefined) {
        return new Response(JSON.stringify({ error: { code: 'not_found', message: `no mock for ${method} ${url.pathname}` } }), {
          status: 404,
        })
      }
      const result = typeof route === 'function' ? await (route as Handler)(call) : route
      if (result instanceof Response) return result
      if (result === undefined) return new Response(null, { status: 204 })
      return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
  return calls
}

export function apiError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status })
}

export function renderWithApp(ui: ReactElement, { path = '/' }: { path?: string } = {}) {
  const client = createQueryClient()
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } })
  return render(
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </AppProviders>,
  )
}

export const demoStatus: Status = {
  version: '0.1.0',
  mode: 'demo',
  automation_enabled: false,
  updates_version: 0,
  is_owner: false,
  connection: {
    mode: 'demo',
    state: 'connected',
    account: { id: 1, first_name: 'Демо', last_name: 'Пользователь', username: 'demo_user', phone_masked: null, is_premium: false },
    dc_id: 2,
    session_path: null,
    device_model: 'Демо-режим',
    error: null,
  },
}

export const dialog = (overrides: Partial<Dialog>): Dialog => ({
  id: 2001,
  title: 'Анна Смирнова',
  kind: 'user',
  username: null,
  unread_count: 0,
  pinned: false,
  last_message_text: 'Привет',
  last_message_date: new Date().toISOString(),
  last_message_outgoing: false,
  can_post: false,
  ...overrides,
})

export const chatDetails = (overrides: Partial<ChatDetails> = {}): ChatDetails => ({
  id: 2001,
  title: 'Анна Смирнова',
  kind: 'user',
  username: null,
  about: null,
  participants_count: null,
  is_admin: false,
  is_creator: false,
  can_send: true,
  can_post: false,
  can_view_participants: false,
  ...overrides,
})

export const message = (overrides: Partial<Message>): Message => ({
  id: 1,
  chat_id: 2001,
  date: new Date().toISOString(),
  text: 'Привет!',
  outgoing: false,
  sender_id: 2001,
  sender_name: 'Анна Смирнова',
  reply_to_id: null,
  media: null,
  views: null,
  forwards: null,
  edited: false,
  service: false,
  deleted: false,
  ...overrides,
})
