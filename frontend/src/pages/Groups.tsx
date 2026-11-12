import { SearchX, Users } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { EmptyState, ErrorState } from '@/components/common'
import { NotConnected, useConnected } from '@/components/NotConnected'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatInfoPanel } from '@/components/chat/ChatInfoPanel'
import { ChatList } from '@/components/chat/ChatList'
import { ChatWorkspace, NoChatSelected, SearchInput, SidebarHeader, useSelectedChat } from '@/components/chat/ChatWorkspace'
import { Composer } from '@/components/chat/Composer'
import { DemoMessageActions } from '@/components/chat/DemoMessageActions'
import { MessageList } from '@/components/chat/MessageList'
import { useChat, useDialogs, useStatus } from '@/lib/queries'
import type { Message } from '@/lib/types'

export default function Groups() {
  const connected = useConnected()
  const status = useStatus()
  const [chatId, selectChat] = useSelectedChat()
  const [search, setSearch] = useState('')
  const [infoOpen, setInfoOpen] = useState(true)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const deferred = useDeferredValue(search.trim().toLowerCase())
  const dialogs = useDialogs('groups', 500, connected)
  const chat = useChat(connected ? chatId : null)

  const visible = useMemo(
    () => (dialogs.data?.items ?? []).filter((d) => !deferred || d.title.toLowerCase().includes(deferred)),
    [dialogs.data, deferred],
  )

  if (!connected) return <NotConnected />
  const selected = dialogs.data?.items.find((d) => d.id === chatId)

  const sidebar = (
    <>
      <SidebarHeader title="Группы">
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск групп" label="Поиск групп" />
      </SidebarHeader>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <ChatList
          label="Группы"
          dialogs={visible}
          loading={dialogs.isPending}
          error={dialogs.error}
          onRetry={() => dialogs.refetch()}
          selectedId={chatId}
          onSelect={(id) => {
            setReplyTo(null)
            selectChat(id)
          }}
          empty={
            deferred ? (
              <EmptyState icon={SearchX} title="Группы не найдены" />
            ) : (
              <EmptyState icon={Users} title="Вы не состоите в группах" description="Группы и супергруппы появятся здесь." />
            )
          }
        />
      </div>
    </>
  )

  return (
    <ChatWorkspace hasSelection={chatId !== null} sidebar={sidebar}>
      {chatId === null ? (
        <NoChatSelected icon={Users} title="Выберите группу" description="Здесь появятся история сообщений, описание и участники." />
      ) : chat.isError ? (
        <div className="flex flex-1 items-center justify-center">
          <ErrorState error={chat.error} onRetry={() => chat.refetch()} title="Не удалось открыть группу" />
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
            />
            <MessageList
              chatId={chatId}
              chatKind={chat.data?.kind}
              onReply={chat.data?.can_send ? setReplyTo : undefined}
              demoActions={status.data?.mode === 'demo' ? (m) => <DemoMessageActions message={m} /> : undefined}
            />
            {chat.data && <Composer key={chat.data.id} chat={chat.data} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />}
          </div>
          {infoOpen && chat.data && <ChatInfoPanel chat={chat.data} onClose={() => setInfoOpen(false)} />}
        </div>
      )}
    </ChatWorkspace>
  )
}
