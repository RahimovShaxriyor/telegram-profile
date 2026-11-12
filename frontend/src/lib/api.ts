import type {
  AdminSummary,
  AiResult,
  ArchiveChat,
  ArchiveEdit,
  ArchiveFilter,
  ArchivePage,
  ArchiveSettings,
  ArchiveStats,
  Autostart,
  ImportStatus,
  AiSettings,
  AiStatus,
  AuditPage,
  AuditSource,
  AuditStatus,
  AutomationState,
  ChatDetails,
  ChatKind,
  DialogList,
  Message,
  MessagePage,
  Overview,
  Participant,
  ProviderStatus,
  Rule,
  RuleInput,
  SearchHit,
  SessionInfo,
  LoginStep,
  Status,
  SystemInfo,
} from './types'

export const UNAUTHORIZED_EVENT = 'tpam:unauthorized'

// Sent on every request; the server rejects state-changing calls without it (CSRF defence).
const CSRF_HEADER = { 'X-TPAM-Request': '1' }

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter?: number

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

interface RequestOptions {
  query?: Query
  json?: unknown
  form?: FormData
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const headers: Record<string, string> = { Accept: 'application/json', ...CSRF_HEADER }
  let body: BodyInit | undefined
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  } else if (options.form) {
    body = options.form
  }

  let response: Response
  try {
    response = await fetch(url, { method, headers, body, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с локальным сервером TPAM. Проверьте, что окно запуска открыто.')
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = payload?.error ?? {}
    if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(
      response.status,
      error.code ?? 'unknown',
      error.message ?? `Ошибка сервера (${response.status})`,
      error.retry_after,
    )
  }
  return payload as T
}

export type DialogFilter = 'all' | 'private' | 'groups' | 'channels'

export const api = {
  status: () => request<Status>('GET', '/api/status'),
  updates: () => request<{ version: number }>('GET', '/api/updates'),
  overview: () => request<Overview>('GET', '/api/overview'),
  system: () => request<SystemInfo>('GET', '/api/system'),

  session: () => request<SessionInfo>('GET', '/api/session'),
  loginPhone: (phone: string, acceptTerms: boolean) =>
    request<LoginStep>('POST', '/api/login/phone', { json: { phone, accept_terms: acceptTerms } }),
  loginCode: (code: string) => request<LoginStep>('POST', '/api/login/code', { json: { code } }),
  loginPassword: (password: string) => request<LoginStep>('POST', '/api/login/password', { json: { password } }),
  loginCancel: () => request<void>('POST', '/api/login/cancel'),
  startGuest: () => request<void>('POST', '/api/guest'),
  logout: () => request<void>('POST', '/api/logout'),
  logoutEverywhere: () => request<{ removed: number }>('POST', '/api/logout/all'),
  disconnectAccount: (deleteData: boolean) =>
    request<void>('POST', '/api/account/disconnect', { json: { delete_data: deleteData } }),
  setup: (apiId: number, apiHash: string) =>
    request<void>('POST', '/api/setup', { json: { api_id: apiId, api_hash: apiHash } }),
  reconnect: () => request<ProviderStatus>('POST', '/api/connection/reconnect'),
  admin: () => request<AdminSummary>('GET', '/api/admin'),
  setRegistration: (open: boolean) => request<AdminSummary>('PUT', '/api/admin/registration', { json: { open } }),
  removeUser: (id: number) => request<void>('DELETE', `/api/admin/users/${id}`),
  uploadArchiveImport: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<ImportStatus>('POST', '/api/archive/import/upload', { form })
  },

  dialogs: (kind: DialogFilter, limit: number) =>
    request<DialogList>('GET', '/api/dialogs', { query: { kind, limit } }),
  chat: (chatId: number) => request<ChatDetails>('GET', `/api/chats/${chatId}`),
  messages: (chatId: number, beforeId?: number | null, limit = 40) =>
    request<MessagePage>('GET', `/api/chats/${chatId}/messages`, { query: { before_id: beforeId, limit } }),
  send: (chatId: number, text: string, replyTo?: number | null) =>
    request<Message>('POST', `/api/chats/${chatId}/messages`, { json: { text, reply_to: replyTo ?? null } }),
  sendFile: (chatId: number, file: File, caption: string, replyTo?: number | null) => {
    const form = new FormData()
    form.append('file', file)
    form.append('caption', caption)
    if (replyTo) form.append('reply_to', String(replyTo))
    return request<Message>('POST', `/api/chats/${chatId}/files`, { form })
  },
  markRead: (chatId: number) => request<void>('POST', `/api/chats/${chatId}/read`),
  participants: (chatId: number, q: string) =>
    request<Participant[]>('GET', `/api/chats/${chatId}/participants`, { query: { q, limit: 200 } }),
  search: (q: string, chatId?: number | null) =>
    request<SearchHit[]>('GET', '/api/search', { query: { q, chat_id: chatId, limit: 40 } }),
  publish: (chatId: number, text: string, scheduleAt?: string | null) =>
    request<Message>('POST', `/api/chats/${chatId}/posts`, { json: { text, schedule_at: scheduleAt ?? null } }),
  scheduled: (chatId: number) => request<Message[]>('GET', `/api/chats/${chatId}/scheduled`),
  cancelScheduled: (chatId: number, messageId: number) =>
    request<void>('DELETE', `/api/chats/${chatId}/scheduled/${messageId}`),

  automation: () => request<AutomationState>('GET', '/api/automation'),
  setAutomation: (enabled: boolean) => request<AutomationState>('PUT', '/api/automation', { json: { enabled } }),
  rules: () => request<Rule[]>('GET', '/api/rules'),
  createRule: (rule: RuleInput) => request<Rule>('POST', '/api/rules', { json: rule }),
  updateRule: (id: number, rule: RuleInput) => request<Rule>('PUT', `/api/rules/${id}`, { json: rule }),
  toggleRule: (id: number, enabled: boolean) => request<Rule>('PATCH', `/api/rules/${id}`, { json: { enabled } }),
  deleteRule: (id: number) => request<void>('DELETE', `/api/rules/${id}`),
  checkRule: (rule: RuleInput, text: string, chatKind: ChatKind) =>
    request<{ matches: boolean }>('POST', '/api/rules/check', { json: { rule, text, chat_kind: chatKind } }),

  activity: (params: {
    source?: AuditSource | ''
    status?: AuditStatus | ''
    q?: string
    limit: number
    offset: number
  }) => request<AuditPage>('GET', '/api/activity', { query: params }),
  clearActivity: () => request<{ removed: number }>('DELETE', '/api/activity'),

  ai: () => request<AiStatus>('GET', '/api/ai'),
  saveAiSettings: (settings: AiSettings) => request<AiStatus>('PUT', '/api/ai/settings', { json: settings }),
  setAiKey: (apiKey: string) => request<AiStatus>('PUT', '/api/ai/key', { json: { api_key: apiKey } }),
  deleteAiKey: () => request<AiStatus>('DELETE', '/api/ai/key'),
  aiPreview: (text: string, instructions: string, chatKind: ChatKind) =>
    request<AiResult>('POST', '/api/ai/preview', { json: { text, instructions, chat_kind: chatKind } }),

  archiveSettings: () => request<ArchiveSettings>('GET', '/api/archive/settings'),
  saveArchiveSettings: (settings: ArchiveSettings) =>
    request<ArchiveSettings>('PUT', '/api/archive/settings', { json: settings }),
  archiveStats: () => request<ArchiveStats>('GET', '/api/archive/stats'),
  archiveChats: () => request<ArchiveChat[]>('GET', '/api/archive/chats'),
  archiveMessages: (params: { q: string; chat_id: number | null; only: ArchiveFilter; offset: number; limit: number }) =>
    request<ArchivePage>('GET', '/api/archive/messages', { query: params }),
  archiveEdits: (pk: number) => request<ArchiveEdit[]>('GET', `/api/archive/messages/${pk}/edits`),
  archiveImportStatus: () => request<ImportStatus>('GET', '/api/archive/import'),
  startArchiveImport: (path: string) => request<ImportStatus>('POST', '/api/archive/import', { json: { path } }),
  clearArchive: (chatId?: number | null) =>
    request<{ ok: boolean }>('DELETE', '/api/archive', { query: { chat_id: chatId } }),
  autostart: () => request<Autostart>('GET', '/api/system/autostart'),
  setAutostart: (enabled: boolean) => request<Autostart>('PUT', '/api/system/autostart', { json: { enabled } }),
  demoEdit: (chatId: number, messageId: number, text: string) =>
    request<Message>('POST', '/api/demo/edit', { json: { chat_id: chatId, message_id: messageId, text } }),
  demoDelete: (chatId: number, messageId: number) =>
    request<void>('POST', '/api/demo/delete', { json: { chat_id: chatId, message_id: messageId } }),

  demoIncoming: (chatId: number, text: string) =>
    request<Message>('POST', '/api/demo/incoming', { json: { chat_id: chatId, text } }),
  demoReset: () => request<void>('POST', '/api/demo/reset'),
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} с`
  const minutes = Math.ceil(seconds / 60)
  return minutes < 90 ? `${minutes} мин` : `${Math.ceil(minutes / 60)} ч`
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited' && error.retryAfter) {
      return `${error.message}. Повторить можно через ${formatWait(error.retryAfter)}.`
    }
    return error.message
  }
  return 'Что-то пошло не так. Попробуйте ещё раз.'
}

/** Downloads an authenticated binary resource (media, CSV) as a Blob. */
export async function fetchBlob(path: string, query: Record<string, string | number | null | undefined> = {}): Promise<Blob> {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, { headers: CSRF_HEADER, credentials: 'same-origin' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new ApiError(response.status, payload?.error?.code ?? 'unknown', payload?.error?.message ?? 'Не удалось загрузить файл')
  }
  return response.blob()
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
