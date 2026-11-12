import { ArrowDown, CornerUpLeft, Eye, File, FileText, Film, Forward, Image, MessagesSquare, Mic, Music, Sticker, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EmptyState, ErrorState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Skeleton, Tooltip } from '@/components/ui/primitives'
import { formatBytes, formatCompact, formatDayLabel, formatTime, MEDIA_LABEL } from '@/lib/format'
import { useMessages } from '@/lib/queries'
import type { ChatKind, Media, Message } from '@/lib/types'
import { cn } from '@/lib/utils'

const MEDIA_ICON = {
  photo: Image,
  video: Film,
  gif: Film,
  document: FileText,
  audio: Music,
  voice: Mic,
  sticker: Sticker,
  other: File,
} as const

function MediaChip({ media, outgoing }: { media: Media; outgoing: boolean }) {
  const Icon = MEDIA_ICON[media.kind]
  return (
    <div
      className={cn(
        'mb-1.5 flex items-center gap-2.5 rounded-lg p-2 pr-3',
        outgoing ? 'bg-primary/10' : 'bg-muted',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-primary shadow-xs">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-medium">{media.file_name ?? MEDIA_LABEL[media.kind]}</div>
        <div className="text-[11.5px] text-muted-foreground">
          {MEDIA_LABEL[media.kind]}
          {media.ttl ? ' · исчезающее, не сохраняется' : ''}
          {media.size ? ` · ${formatBytes(media.size)}` : ''}
        </div>
      </div>
    </div>
  )
}

function ReplyQuote({ message, outgoing }: { message: Message | undefined; outgoing: boolean }) {
  return (
    <div
      className={cn(
        'mb-1.5 rounded-md border-l-2 py-1 pr-2 pl-2 text-[12.5px] leading-snug',
        outgoing ? 'border-primary bg-primary/8' : 'border-primary bg-primary-soft/60',
      )}
    >
      <div className="font-medium text-primary">{message?.sender_name ?? 'Сообщение'}</div>
      <div className="line-clamp-1 text-muted-foreground">
        {message ? message.text || (message.media ? MEDIA_LABEL[message.media.kind] : '…') : 'Исходное сообщение не загружено'}
      </div>
    </div>
  )
}

interface BubbleProps {
  message: Message
  showSender: boolean
  replyTarget: Message | undefined
  onReply?: (message: Message) => void
  highlighted: boolean
  demoActions?: (message: Message) => ReactNode
}

function Bubble({ message, showSender, replyTarget, onReply, highlighted, demoActions }: BubbleProps) {
  if (message.service) {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-surface/80 px-3 py-1 text-[12px] text-muted-foreground shadow-xs">{message.text}</span>
      </div>
    )
  }
  const out = message.outgoing
  return (
    <div
      id={`msg-${message.id}`}
      className={cn('group flex items-end gap-1.5 px-3 sm:px-6', out ? 'justify-end' : 'justify-start')}
    >
      {out && onReply && !message.deleted && <ReplyButton message={message} onReply={onReply} />}
      <div
        className={cn(
          'relative max-w-[min(560px,82%)] rounded-2xl px-3 py-2 text-[14px] leading-relaxed shadow-xs transition-shadow',
          out ? 'rounded-br-md bg-bubble-out' : 'rounded-bl-md border border-border/60 bg-bubble-in',
          message.deleted && 'border border-dashed border-danger/40 opacity-80 shadow-none',
          highlighted && 'ring-2 ring-primary',
        )}
      >
        {message.deleted && (
          <Tooltip content="Сообщение удалено в Telegram, копия сохранена в вашем архиве. Telegram не сообщает, кто удалил: собеседник или вы на другом устройстве.">
            <div className="mb-1 flex w-fit items-center gap-1 text-[11.5px] font-medium text-danger" tabIndex={0}>
              <Trash2 className="size-3" /> Удалено · сохранено в архиве
            </div>
          </Tooltip>
        )}
        {showSender && !out && message.sender_name && (
          <div className="mb-0.5 text-[12.5px] font-semibold text-primary">{message.sender_name}</div>
        )}
        {message.reply_to_id && <ReplyQuote message={replyTarget} outgoing={out} />}
        {message.media && <MediaChip media={message.media} outgoing={out} />}
        {message.text && <p className="break-words whitespace-pre-wrap">{message.text}</p>}
        <div className="float-right mt-1 ml-3 flex translate-y-1 items-center gap-1.5 text-[11px] text-subtle-foreground tabular">
          {message.edited && <span>изменено</span>}
          <time dateTime={message.date}>{formatTime(message.date)}</time>
        </div>
      </div>
      {!out && onReply && !message.deleted && <ReplyButton message={message} onReply={onReply} />}
      {!out && !message.deleted && demoActions?.(message)}
    </div>
  )
}

function ReplyButton({ message, onReply }: { message: Message; onReply: (message: Message) => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mb-1 size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      onClick={() => onReply(message)}
      aria-label={`Ответить на сообщение ${message.sender_name ?? ''}`.trim()}
    >
      <CornerUpLeft className="size-3.5" />
    </Button>
  )
}

function Post({ message }: { message: Message }) {
  return (
    <article id={`msg-${message.id}`} className="mx-3 rounded-xl border border-border bg-surface p-4 shadow-xs sm:mx-6">
      {message.media && <MediaChip media={message.media} outgoing={false} />}
      {message.text && <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">{message.text}</p>}
      <footer className="mt-3 flex items-center gap-4 text-[12px] text-muted-foreground tabular">
        {message.views != null && (
          <span className="inline-flex items-center gap-1" title="Просмотры">
            <Eye className="size-3.5" /> {formatCompact(message.views)}
          </span>
        )}
        {message.forwards != null && (
          <span className="inline-flex items-center gap-1" title="Пересылки">
            <Forward className="size-3.5" /> {formatCompact(message.forwards)}
          </span>
        )}
        {message.edited && <span>изменено</span>}
        <time className="ml-auto" dateTime={message.date}>
          {formatTime(message.date)}
        </time>
      </footer>
    </article>
  )
}

interface MessageListProps {
  chatId: number
  chatKind: ChatKind | undefined
  variant?: 'bubbles' | 'posts'
  onReply?: (message: Message) => void
  highlightId?: number | null
  demoActions?: (message: Message) => ReactNode
}

const NEAR_BOTTOM_PX = 160

export function MessageList({ chatId, chatKind, variant = 'bubbles', onReply, highlightId, demoActions }: MessageListProps) {
  const query = useMessages(chatId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const snapshot = useRef({ chatId: 0, firstId: 0, lastId: 0, scrollHeight: 0, scrollTop: 0 })
  const [showJump, setShowJump] = useState(false)

  const messages = useMemo(
    () => (query.data ? [...query.data.pages].reverse().flatMap((page) => page.items) : []),
    [query.data],
  )
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const isGroup = chatKind === 'group' || chatKind === 'supergroup'

  // Keep the viewport stable: stick to bottom on open/new messages, preserve position on prepend.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || messages.length === 0) return
    const prev = snapshot.current
    const firstId = messages[0].id
    const lastId = messages[messages.length - 1].id
    if (prev.chatId !== chatId || prev.lastId === 0) {
      el.scrollTop = el.scrollHeight
    } else if (firstId !== prev.firstId && lastId === prev.lastId) {
      el.scrollTop = el.scrollHeight - prev.scrollHeight + prev.scrollTop
    } else if (lastId !== prev.lastId) {
      const wasNearBottom = prev.scrollHeight - prev.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
      if (wasNearBottom || messages[messages.length - 1].outgoing) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    }
    snapshot.current = { chatId, firstId, lastId, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
  }, [messages, chatId])

  useEffect(() => {
    if (!highlightId) return
    document.getElementById(`msg-${highlightId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightId, messages.length])

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage()
      },
      { root: scrollRef.current, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    snapshot.current.scrollTop = el.scrollTop
    snapshot.current.scrollHeight = el.scrollHeight
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 600)
  }

  if (query.isPending) {
    return (
      <div className="flex-1 space-y-3 overflow-hidden bg-chat-backdrop p-6" aria-busy aria-label="Загрузка сообщений">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={cn('flex', i % 3 === 1 ? 'justify-end' : 'justify-start')}>
            <Skeleton className="h-12 rounded-2xl" style={{ width: `${30 + ((i * 23) % 40)}%` }} />
          </div>
        ))}
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-chat-backdrop">
        <ErrorState error={query.error} onRetry={() => query.refetch()} title="Не удалось загрузить сообщения" />
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto bg-chat-backdrop py-4 scrollbar-thin"
        role="log"
        aria-label="История сообщений"
        aria-live="polite"
      >
        <div ref={sentinelRef} />
        {hasNextPage && (
          <div className="mb-3 flex justify-center">
            <Button variant="outline" size="sm" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
              Загрузить ранние сообщения
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <EmptyState
            icon={MessagesSquare}
            title={variant === 'posts' ? 'Публикаций пока нет' : 'Сообщений пока нет'}
            description={variant === 'posts' ? 'Первая публикация появится здесь.' : 'Напишите первое сообщение.'}
          />
        )}
        <div className={cn(variant === 'posts' ? 'space-y-3' : 'space-y-1')}>
          {messages.map((message, index) => {
            const prev = messages[index - 1]
            const day = formatDayLabel(message.date)
            const newDay = !prev || day !== formatDayLabel(prev.date)
            const showSender = isGroup && (newDay || !prev || prev.sender_id !== message.sender_id || prev.service)
            return (
              <Fragment key={message.id}>
                {newDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-surface/90 px-3 py-1 text-[12px] font-medium text-muted-foreground shadow-xs backdrop-blur">
                      {day}
                    </span>
                  </div>
                )}
                {variant === 'posts' ? (
                  <Post message={message} />
                ) : (
                  <div className={cn(showSender && index > 0 && 'pt-2')}>
                    <Bubble
                      message={message}
                      showSender={showSender}
                      replyTarget={message.reply_to_id ? byId.get(message.reply_to_id) : undefined}
                      onReply={onReply}
                      highlighted={message.id === highlightId}
                      demoActions={demoActions}
                    />
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
      {showJump && (
        <Button
          variant="outline"
          size="icon"
          className="absolute right-5 bottom-4 rounded-full shadow-md animate-pop"
          aria-label="К последним сообщениям"
          onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  )
}
