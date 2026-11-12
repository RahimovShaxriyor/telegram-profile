import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Clock, Lock, Megaphone, SearchX, Send, Trash2 } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { EmptyState, ErrorState } from '@/components/common'
import { NotConnected, useConnected } from '@/components/NotConnected'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatInfoPanel } from '@/components/chat/ChatInfoPanel'
import { ChatList } from '@/components/chat/ChatList'
import { ChatWorkspace, NoChatSelected, SearchInput, SidebarHeader, useSelectedChat } from '@/components/chat/ChatWorkspace'
import { useAppendMessage } from '@/components/chat/Composer'
import { MessageList } from '@/components/chat/MessageList'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/form'
import { Badge, Skeleton, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { notify } from '@/lib/notify'
import { keys, useChat, useDialogs, useStatus } from '@/lib/queries'
import type { ChatDetails } from '@/lib/types'

const MAX_POST = 4096

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultScheduleTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setMinutes(0, 0, 0)
  return toLocalInput(date)
}

function PublishPanel({ chat }: { chat: ChatDetails }) {
  const [text, setText] = useState('')
  const [scheduled, setScheduled] = useState(false)
  const [when, setWhen] = useState(defaultScheduleTime)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const append = useAppendMessage()

  if (!chat.can_post) {
    return (
      <div className="flex items-center justify-center gap-2 border-t border-border bg-surface px-4 py-4 text-[13px] text-muted-foreground">
        <Lock className="size-4" /> Вы читаете этот канал. Публиковать могут только администраторы с правом публикации.
      </div>
    )
  }

  const scheduleDate = scheduled ? new Date(when) : null
  const scheduleInvalid = scheduled && (!when || Number.isNaN(scheduleDate!.getTime()) || scheduleDate!.getTime() < Date.now() + 60_000)
  const canSubmit = text.trim().length > 0 && text.length <= MAX_POST && !scheduleInvalid && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    try {
      const message = await api.publish(chat.id, text, scheduleDate ? scheduleDate.toISOString() : null)
      if (scheduleDate) {
        await queryClient.invalidateQueries({ queryKey: keys.scheduled(chat.id) })
        notify.success('Публикация запланирована', `Telegram опубликует пост ${formatDateTime(message.date)}`)
      } else {
        append(chat.id, message)
        notify.success('Пост опубликован')
      }
      setText('')
    } catch (error) {
      notify.error(error, 'Не удалось опубликовать')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border bg-surface p-3 sm:p-4">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Текст публикации"
        aria-label="Текст публикации"
        className="min-h-[88px] bg-surface-2"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit()
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <Switch checked={scheduled} onCheckedChange={setScheduled} aria-label="Отложенная публикация" />
          Опубликовать позже
        </label>
        {scheduled && (
          <Input
            type="datetime-local"
            value={when}
            min={toLocalInput(new Date(Date.now() + 2 * 60_000))}
            onChange={(event) => setWhen(event.target.value)}
            className="h-8 w-auto"
            aria-label="Дата и время публикации"
            aria-invalid={scheduleInvalid || undefined}
          />
        )}
        <span className={text.length > MAX_POST ? 'text-[12px] text-danger tabular' : 'text-[12px] text-subtle-foreground tabular'}>
          {text.length > 0 && `${text.length} / ${MAX_POST}`}
        </span>
        <Button className="ml-auto" onClick={submit} disabled={!canSubmit} loading={busy}>
          {scheduled ? <CalendarClock /> : <Send />}
          {scheduled ? 'Запланировать' : 'Опубликовать'}
        </Button>
      </div>
      {scheduleInvalid && when && <p className="text-[12.5px] text-danger">Выберите время хотя бы на пару минут позже текущего.</p>}
      {scheduled && !scheduleInvalid && (
        <p className="text-[12.5px] text-muted-foreground">
          Публикацию выполнит сам Telegram — даже если TPAM будет выключен.
        </p>
      )}
    </div>
  )
}

function ScheduledList({ chat }: { chat: ChatDetails }) {
  const queryClient = useQueryClient()
  const scheduled = useQuery({
    queryKey: keys.scheduled(chat.id),
    queryFn: () => api.scheduled(chat.id),
    enabled: chat.can_post,
  })

  if (!chat.can_post) {
    return <EmptyState icon={Lock} title="Нет доступа" description="Отложенные публикации видны только администраторам с правом публикации." />
  }
  if (scheduled.isPending) {
    return (
      <div className="space-y-3 p-6">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    )
  }
  if (scheduled.isError) return <ErrorState error={scheduled.error} onRetry={() => scheduled.refetch()} />
  if (scheduled.data.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="Нет отложенных публикаций"
        description="Включите «Опубликовать позже» под лентой, чтобы запланировать пост."
        className="py-16"
      />
    )
  }
  return (
    <ul className="space-y-3 p-4 sm:p-6">
      {scheduled.data.map((post) => (
        <li key={post.id} className="rounded-xl border border-border bg-surface p-4 shadow-xs animate-enter">
          <div className="mb-2 flex items-center gap-2">
            <Badge tone="primary">
              <CalendarClock /> {formatDateTime(post.date)}
            </Badge>
            <ConfirmDialog
              title="Отменить публикацию?"
              description="Пост будет удалён из очереди Telegram и не опубликуется."
              confirmLabel="Отменить публикацию"
              destructive
              onConfirm={async () => {
                try {
                  await api.cancelScheduled(chat.id, post.id)
                  await queryClient.invalidateQueries({ queryKey: keys.scheduled(chat.id) })
                  notify.success('Публикация отменена')
                } catch (error) {
                  notify.error(error)
                  throw error
                }
              }}
              trigger={
                <Button variant="danger-ghost" size="sm" className="ml-auto">
                  <Trash2 /> Отменить
                </Button>
              }
            />
          </div>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{post.text}</p>
        </li>
      ))}
    </ul>
  )
}

export default function Channels() {
  const connected = useConnected()
  const status = useStatus()
  const [chatId, selectChat] = useSelectedChat()
  const [search, setSearch] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [tab, setTab] = useState<'posts' | 'scheduled'>('posts')
  const [infoOpen, setInfoOpen] = useState(false)
  const deferred = useDeferredValue(search.trim().toLowerCase())
  const dialogs = useDialogs('channels', 500, connected)
  const chat = useChat(connected ? chatId : null)

  const visible = useMemo(
    () => (dialogs.data?.items ?? []).filter((d) => !deferred || d.title.toLowerCase().includes(deferred)),
    [dialogs.data, deferred],
  )
  const filtered = onlyMine ? visible.filter((d) => d.can_post) : visible

  if (!connected) return <NotConnected />
  const selected = dialogs.data?.items.find((d) => d.id === chatId)

  const sidebar = (
    <>
      <SidebarHeader title="Каналы">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск каналов" label="Поиск каналов" />
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={onlyMine} onCheckedChange={setOnlyMine} aria-label="Только каналы, где я могу публиковать" />
          Только где я могу публиковать
        </label>
      </SidebarHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <ChatList
          label="Каналы"
          dialogs={filtered}
          loading={dialogs.isPending}
          error={dialogs.error}
          onRetry={() => dialogs.refetch()}
          selectedId={chatId}
          onSelect={(id) => {
            setTab('posts')
            selectChat(id)
          }}
          empty={
            deferred || onlyMine ? (
              <EmptyState icon={SearchX} title="Каналы не найдены" />
            ) : (
              <EmptyState icon={Megaphone} title="Нет каналов" description="Каналы, на которые вы подписаны, появятся здесь." />
            )
          }
        />
      </div>
    </>
  )

  return (
    <ChatWorkspace hasSelection={chatId !== null} sidebar={sidebar}>
      {chatId === null ? (
        <NoChatSelected icon={Megaphone} title="Выберите канал" description="Смотрите публикации со статистикой и публикуйте в своих каналах." />
      ) : chat.isError ? (
        <div className="flex flex-1 items-center justify-center">
          <ErrorState error={chat.error} onRetry={() => chat.refetch()} title="Не удалось открыть канал" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className={infoOpen ? 'hidden min-w-0 flex-1 flex-col lg:flex' : 'flex min-w-0 flex-1 flex-col'}>
            <ChatHeader
              chat={chat.data}
              unread={selected?.unread_count ?? 0}
              demo={status.data?.mode === 'demo'}
              onBack={() => selectChat(null)}
              infoOpen={infoOpen}
              onToggleInfo={() => setInfoOpen((v) => !v)}
              extra={
                chat.data?.can_post && (
                  <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mr-1 hidden sm:block">
                    <TabsList>
                      <TabsTrigger value="posts">Лента</TabsTrigger>
                      <TabsTrigger value="scheduled">Отложенные</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )
              }
            />
            {chat.data?.can_post && (
              <div className="border-b border-border bg-surface px-3 py-2 sm:hidden">
                <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
                  <TabsList className="w-full">
                    <TabsTrigger value="posts" className="flex-1">Лента</TabsTrigger>
                    <TabsTrigger value="scheduled" className="flex-1">Отложенные</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}
            {tab === 'scheduled' && chat.data ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-chat-backdrop scrollbar-thin">
                <ScheduledList chat={chat.data} />
              </div>
            ) : (
              <MessageList chatId={chatId} chatKind="channel" variant="posts" />
            )}
            {chat.data && <PublishPanel chat={chat.data} />}
          </div>
          {infoOpen && chat.data && <ChatInfoPanel chat={chat.data} onClose={() => setInfoOpen(false)} />}
        </div>
      )}
    </ChatWorkspace>
  )
}
