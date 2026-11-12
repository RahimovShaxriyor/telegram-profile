import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api, type DialogFilter } from './api'
import { notify } from './notify'
import { getPrefs } from './prefs'

export const keys = {
  status: ['status'] as const,
  session: ['session'] as const,
  overview: ['overview'] as const,
  dialogs: (kind: DialogFilter, limit: number) => ['dialogs', kind, limit] as const,
  chat: (id: number) => ['chat', id] as const,
  messages: (id: number) => ['messages', id] as const,
  participants: (id: number, q: string) => ['participants', id, q] as const,
  search: (q: string, chatId: number | null) => ['search', q, chatId] as const,
  scheduled: (id: number) => ['scheduled', id] as const,
  automation: ['automation'] as const,
  ai: ['ai'] as const,
  rules: ['rules'] as const,
  activity: (params: object) => ['activity', params] as const,
  system: ['system'] as const,
  auth: ['auth'] as const,
}

export function useStatus() {
  return useQuery({ queryKey: keys.status, queryFn: api.status, refetchInterval: 10_000 })
}

export function useDialogs(kind: DialogFilter, limit = 100, enabled = true) {
  return useQuery({ queryKey: keys.dialogs(kind, limit), queryFn: () => api.dialogs(kind, limit), enabled })
}

export function useChat(id: number | null) {
  return useQuery({ queryKey: keys.chat(id ?? 0), queryFn: () => api.chat(id!), enabled: id !== null })
}

export function useMessages(id: number | null, pageSize = 40) {
  return useInfiniteQuery({
    queryKey: keys.messages(id ?? 0),
    queryFn: ({ pageParam }) => api.messages(id!, pageParam, pageSize),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_before_id,
    enabled: id !== null,
    maxPages: 12, // caps memory for very long scrolling sessions
  })
}

/**
 * Polls a cheap local counter and refreshes Telegram-backed data only when new
 * updates arrived, so the UI stays live without hammering Telegram.
 */
export function useLiveUpdates(enabled: boolean) {
  const queryClient = useQueryClient()
  const last = useRef<number | null>(null)
  const { data } = useQuery({
    queryKey: ['updates'],
    queryFn: api.updates,
    refetchInterval: 3_000,
    enabled,
  })

  useEffect(() => {
    if (data === undefined) return
    const previous = last.current
    last.current = data.version
    if (previous === null || data.version === previous) return
    for (const key of ['dialogs', 'messages', 'overview', 'activity', 'automation', 'archive']) {
      void queryClient.invalidateQueries({ queryKey: [key] })
    }
    if (getPrefs().newMessageToasts && document.visibilityState === 'visible') {
      notify.info('Новые сообщения', 'Список диалогов обновлён')
    }
  }, [data, queryClient])
}
