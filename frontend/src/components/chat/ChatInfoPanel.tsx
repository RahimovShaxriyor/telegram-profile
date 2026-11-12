import { useQuery } from '@tanstack/react-query'
import { Bot, Crown, Lock, Search, ShieldCheck, Users, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { Avatar, EmptyState, ErrorState, ListSkeleton } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form'
import { Badge } from '@/components/ui/primitives'
import { ApiError, api } from '@/lib/api'
import { formatNumber, KIND_LABEL } from '@/lib/format'
import { keys } from '@/lib/queries'
import type { ChatDetails } from '@/lib/types'

function Rights({ chat }: { chat: ChatDetails }) {
  const items = [
    { label: 'Вы администратор', value: chat.is_admin },
    chat.kind === 'channel'
      ? { label: 'Можно публиковать', value: chat.can_post }
      : { label: 'Можно писать сообщения', value: chat.can_send },
    { label: 'Виден список участников', value: chat.can_view_participants },
  ]
  return (
    <ul className="space-y-1.5 text-[13px]">
      {items.map((item) => (
        <li key={item.label} className="flex items-center justify-between">
          <span className="text-muted-foreground">{item.label}</span>
          <span className={item.value ? 'font-medium text-success' : 'text-subtle-foreground'}>{item.value ? 'Да' : 'Нет'}</span>
        </li>
      ))}
    </ul>
  )
}

function Participants({ chat }: { chat: ChatDetails }) {
  const [q, setQ] = useState('')
  const query = useDeferredValue(q.trim())
  const participants = useQuery({
    queryKey: keys.participants(chat.id, query),
    queryFn: () => api.participants(chat.id, query),
    enabled: chat.can_view_participants,
    placeholderData: (previous) => previous,
  })

  if (!chat.can_view_participants) {
    return (
      <EmptyState
        icon={Lock}
        title="Список участников скрыт"
        description="Администраторы этой группы ограничили просмотр участников. Это ограничение Telegram, а не приложения."
        className="py-8"
      />
    )
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground" />
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Поиск участников"
          className="pl-9"
          aria-label="Поиск участников"
        />
      </div>
      {participants.isPending ? (
        <ListSkeleton rows={5} />
      ) : participants.isError ? (
        participants.error instanceof ApiError && participants.error.status === 403 ? (
          <EmptyState icon={Lock} title="Нет доступа" description={participants.error.message} className="py-8" />
        ) : (
          <ErrorState error={participants.error} onRetry={() => participants.refetch()} />
        )
      ) : participants.data.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">Никого не найдено</p>
      ) : (
        <ul className="space-y-0.5" aria-label="Участники">
          {participants.data.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
              <Avatar id={p.id} name={p.name} size={32} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px] font-medium">{p.name}</div>
                {p.username && <div className="truncate text-[12px] text-muted-foreground">@{p.username}</div>}
              </div>
              {p.role === 'creator' && (
                <Badge tone="warning">
                  <Crown /> Владелец
                </Badge>
              )}
              {p.role === 'admin' && (
                <Badge tone="primary">
                  <ShieldCheck /> Админ
                </Badge>
              )}
              {p.is_bot && (
                <Badge>
                  <Bot /> Бот
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ChatInfoPanel({ chat, onClose }: { chat: ChatDetails; onClose: () => void }) {
  return (
    <aside
      className="flex w-full shrink-0 flex-col border-l border-border bg-surface md:w-[320px] animate-enter"
      aria-label="Информация о чате"
    >
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-border px-4">
        <h3 className="text-[14px] font-semibold">Информация</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Закрыть панель">
          <X />
        </Button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto p-4 scrollbar-thin">
        <div className="flex flex-col items-center text-center">
          <Avatar id={chat.id} name={chat.title} size={72} />
          <h4 className="mt-3 text-[16px] font-semibold">{chat.title}</h4>
          <p className="text-[12.5px] text-muted-foreground">
            {KIND_LABEL[chat.kind]}
            {chat.username ? ` · @${chat.username}` : ''}
          </p>
        </div>
        {chat.about && (
          <section>
            <h5 className="mb-1 text-[12px] font-medium tracking-wide text-subtle-foreground uppercase">Описание</h5>
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{chat.about}</p>
          </section>
        )}
        <section>
          <h5 className="mb-2 text-[12px] font-medium tracking-wide text-subtle-foreground uppercase">Ваши права</h5>
          <Rights chat={chat} />
        </section>
        {chat.kind !== 'user' && chat.kind !== 'bot' && (
          <section>
            <h5 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-subtle-foreground uppercase">
              <Users className="size-3.5" /> Участники
              {chat.participants_count != null && <span className="normal-case">· {formatNumber(chat.participants_count)}</span>}
            </h5>
            <Participants chat={chat} />
          </section>
        )}
      </div>
    </aside>
  )
}
