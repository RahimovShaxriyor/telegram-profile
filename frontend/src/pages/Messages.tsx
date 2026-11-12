import { useQuery } from '@tanstack/react-query'
import { Inbox, MessageCircle, SearchX, TextSearch } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Avatar, EmptyState, ErrorState, ListSkeleton } from '@/components/common'
import { NotConnected, useConnected } from '@/components/NotConnected'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatList } from '@/components/chat/ChatList'
import { ChatWorkspace, NoChatSelected, SearchInput, SidebarHeader, useSelectedChat } from '@/components/chat/ChatWorkspace'
import { Composer } from '@/components/chat/Composer'
import { DemoMessageActions } from '@/components/chat/DemoMessageActions'
import { MessageList } from '@/components/chat/MessageList'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { api, type DialogFilter } from '@/lib/api'
import { formatListTime } from '@/lib/format'
import { keys, useChat, useDialogs, useStatus } from '@/lib/queries'
import type { Dialog, Message, SearchHit } from '@/lib/types'
import { cn } from '@/lib/utils'

type Filter = DialogFilter | 'unread'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'private', label: 'Личные' },
  { value: 'groups', label: 'Группы' },
  { value: 'channels', label: 'Каналы' },
  { value: 'unread', label: 'Новые' },
]
const PAGE = 100
const MAX_DIALOGS = 500

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0 || !query) return <>{text}</>
  const start = Math.max(0, index - 40)
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, index)}
      <mark className="rounded bg-warning-soft px-0.5 text-foreground">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

function SearchResults({
  query,
  chatId,
  onOpen,
}: {
  query: string
  chatId: number | null
  onOpen: (hit: SearchHit) => void
}) {
  const results = useQuery({
    queryKey: keys.search(query, chatId),
    queryFn: () => api.search(query, chatId),
    enabled: query.length >= 2,
  })
  if (results.isPending) return <ListSkeleton rows={5} />
  if (results.isError) return <ErrorState error={results.error} onRetry={() => results.refetch()} />
  if (results.data.length === 0) {
    return <EmptyState icon={SearchX} title="Ничего не найдено" description={`По запросу «${query}» сообщений нет.`} />
  }
  return (
    <ul className="space-y-0.5 p-2" aria-label="Результаты поиска">
      {results.data.map((hit) => (
        <li key={`${hit.chat_id}-${hit.message.id}`}>
          <button
            type="button"
            onClick={() => onOpen(hit)}
            className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <Avatar id={hit.chat_id} name={hit.chat_title} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13.5px] font-medium">{hit.chat_title}</span>
                <span className="ml-auto shrink-0 text-[11.5px] text-subtle-foreground">{formatListTime(hit.message.date)}</span>
              </div>
              <p className="line-clamp-2 text-[12.5px] text-muted-foreground">
                {hit.message.sender_name && <span className="text-foreground/70">{hit.message.sender_name}: </span>}
                <Highlight text={hit.message.text} query={query} />
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function Messages() {
  const connected = useConnected()
  const status = useStatus()
  const [params, setParams] = useSearchParams()
  const filter = (FILTERS.find((f) => f.value === params.get('filter'))?.value ?? 'all') as Filter
  const [chatId, selectChat] = useSelectedChat()
  const highlightId = Number(params.get('msg')) || null
  const [limit, setLimit] = useState(PAGE)
  const [search, setSearch] = useState('')
  const [searchMessages, setSearchMessages] = useState(false)
  const [searchInChat, setSearchInChat] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const deferredSearch = useDeferredValue(search.trim())

  const dialogs = useDialogs(filter === 'unread' ? 'all' : filter, limit, connected)
  const chat = useChat(connected ? chatId : null)

  const visible = useMemo(() => {
    let items: Dialog[] = dialogs.data?.items ?? []
    if (filter === 'unread') items = items.filter((d) => d.unread_count > 0)
    if (deferredSearch && !searchMessages) {
      const needle = deferredSearch.toLowerCase()
      items = items.filter((d) => d.title.toLowerCase().includes(needle) || d.username?.toLowerCase().includes(needle))
    }
    return items
  }, [dialogs.data, filter, deferredSearch, searchMessages])

  if (!connected) return <NotConnected />

  const selectedDialog = dialogs.data?.items.find((d) => d.id === chatId)
  const canLoadMore = dialogs.data && dialogs.data.total > dialogs.data.items.length && limit < MAX_DIALOGS && filter !== 'unread'

  function setFilter(value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value === 'all') next.delete('filter')
      else next.set('filter', value)
      return next
    })
  }

  function open(id: number) {
    setReplyTo(null)
    selectChat(id)
  }

  function openHit(hit: SearchHit) {
    setReplyTo(null)
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('chat', String(hit.chat_id))
      next.set('msg', String(hit.message.id))
      return next
    })
  }

  const sidebar = (
    <>
      <SidebarHeader title="Сообщения">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value)
            if (!value) setSearchMessages(false)
          }}
          placeholder={searchMessages ? 'Поиск по тексту сообщений' : 'Поиск чатов'}
          label="Поиск"
        />
        {deferredSearch.length >= 2 && (
          <div className="flex flex-wrap items-center gap-2 animate-fade">
            <Button
              size="sm"
              variant={searchMessages ? 'default' : 'outline'}
              onClick={() => setSearchMessages((v) => !v)}
              aria-pressed={searchMessages}
            >
              <TextSearch /> {searchMessages ? 'Ищем в сообщениях' : 'Искать в сообщениях'}
            </Button>
            {searchMessages && chatId !== null && (
              <Button size="sm" variant={searchInChat ? 'secondary' : 'ghost'} onClick={() => setSearchInChat((v) => !v)} aria-pressed={searchInChat}>
                {searchInChat ? 'Только в этом чате' : 'Во всех чатах'}
              </Button>
            )}
          </div>
        )}
        {!searchMessages && (
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="w-full">
              {FILTERS.map((f) => (
                <TabsTrigger key={f.value} value={f.value} className="flex-1 px-1.5">
                  {f.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </SidebarHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {searchMessages && deferredSearch.length >= 2 ? (
          <SearchResults query={deferredSearch} chatId={searchInChat ? chatId : null} onOpen={openHit} />
        ) : (
          <ChatList
            label="Диалоги"
            dialogs={visible}
            loading={dialogs.isPending}
            error={dialogs.error}
            onRetry={() => dialogs.refetch()}
            selectedId={chatId}
            onSelect={open}
            empty={
              deferredSearch ? (
                <EmptyState icon={SearchX} title="Чаты не найдены" description="Попробуйте искать по тексту сообщений." />
              ) : filter === 'unread' ? (
                <EmptyState icon={Inbox} title="Всё прочитано" description="Новых сообщений нет." />
              ) : (
                <EmptyState icon={MessageCircle} title="Диалогов нет" description="Здесь появятся ваши чаты." />
              )
            }
            footer={
              canLoadMore && (
                <div className="px-4 pb-4">
                  <Button variant="outline" size="sm" className="w-full" loading={dialogs.isFetching} onClick={() => setLimit((l) => l + PAGE)}>
                    Показать ещё
                  </Button>
                </div>
              )
            }
          />
        )}
      </div>
    </>
  )

  return (
    <ChatWorkspace hasSelection={chatId !== null} sidebar={sidebar}>
      {chatId === null ? (
        <NoChatSelected icon={MessageCircle} title="Выберите диалог" description="Откройте чат слева, чтобы читать и отправлять сообщения." />
      ) : chat.isError ? (
        <div className="flex flex-1 items-center justify-center">
          <ErrorState error={chat.error} onRetry={() => chat.refetch()} title="Не удалось открыть чат" />
        </div>
      ) : (
        <div className={cn('flex min-h-0 flex-1 flex-col')}>
          <ChatHeader
            chat={chat.data}
            unread={selectedDialog?.unread_count ?? 0}
            demo={status.data?.mode === 'demo'}
            onBack={() => selectChat(null)}
          />
          <MessageList
            chatId={chatId}
            chatKind={chat.data?.kind}
            variant={chat.data?.kind === 'channel' ? 'posts' : 'bubbles'}
            onReply={chat.data?.can_send ? setReplyTo : undefined}
            highlightId={highlightId}
            demoActions={status.data?.mode === 'demo' ? (m) => <DemoMessageActions message={m} /> : undefined}
          />
          {chat.data && <Composer key={chat.data.id} chat={chat.data} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />}
        </div>
      )}
    </ChatWorkspace>
  )
}
