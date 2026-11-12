import { useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ChevronLeft, FlaskConical, PanelRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Avatar } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/form'
import { Badge, Skeleton, Tooltip } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { formatNumber, KIND_LABEL, plural } from '@/lib/format'
import { notify } from '@/lib/notify'
import type { ChatDetails } from '@/lib/types'

function subtitle(chat: ChatDetails): string {
  const parts: string[] = [KIND_LABEL[chat.kind]]
  if (chat.participants_count != null) {
    const n = chat.participants_count
    parts.push(
      chat.kind === 'channel'
        ? `${formatNumber(n)} ${plural(n, 'подписчик', 'подписчика', 'подписчиков')}`
        : `${formatNumber(n)} ${plural(n, 'участник', 'участника', 'участников')}`,
    )
  }
  if (chat.username) parts.push(`@${chat.username}`)
  return parts.join(' · ')
}

interface ChatHeaderProps {
  chat: ChatDetails | undefined
  unread: number
  demo: boolean
  onBack?: () => void
  infoOpen?: boolean
  onToggleInfo?: () => void
  extra?: ReactNode
}

export function ChatHeader({ chat, unread, demo, onBack, infoOpen, onToggleInfo, extra }: ChatHeaderProps) {
  const queryClient = useQueryClient()
  const [marking, setMarking] = useState(false)

  async function markRead() {
    if (!chat) return
    setMarking(true)
    try {
      await api.markRead(chat.id)
      await queryClient.invalidateQueries({ queryKey: ['dialogs'] })
      notify.success('Чат отмечен прочитанным')
    } catch (error) {
      notify.error(error)
    } finally {
      setMarking(false)
    }
  }

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
      {onBack && (
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Назад к списку">
          <ChevronLeft />
        </Button>
      )}
      {chat ? (
        <>
          <Avatar id={chat.id} name={chat.title} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[14.5px] font-semibold">{chat.title}</h2>
              {chat.is_creator ? (
                <Badge tone="primary">Владелец</Badge>
              ) : chat.is_admin ? (
                <Badge tone="primary">Админ</Badge>
              ) : null}
            </div>
            <p className="truncate text-[12.5px] text-muted-foreground">{subtitle(chat)}</p>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center gap-3">
          <Skeleton className="size-[38px] rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {extra}
        {demo && chat && chat.kind !== 'channel' && <DemoIncomingButton chatId={chat.id} />}
        {unread > 0 && (
          <Tooltip content="Отметить прочитанным. Собеседники увидят, что вы прочитали сообщения.">
            <Button variant="ghost" size="icon-sm" onClick={markRead} loading={marking} aria-label="Отметить прочитанным">
              {!marking && <CheckCheck />}
            </Button>
          </Tooltip>
        )}
        {onToggleInfo && (
          <Tooltip content={infoOpen ? 'Скрыть информацию' : 'Информация и участники'}>
            <Button
              variant={infoOpen ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={onToggleInfo}
              aria-pressed={infoOpen}
              aria-label="Информация о чате"
            >
              <PanelRight />
            </Button>
          </Tooltip>
        )}
      </div>
    </header>
  )
}

/** Demo-only: inject an incoming message to try automation rules end to end. */
function DemoIncomingButton({ chatId }: { chatId: number }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('Привет! Есть минутка на созвон?')
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  async function submit() {
    setBusy(true)
    try {
      await api.demoIncoming(chatId, text)
      await Promise.all(
        ['messages', 'dialogs', 'activity', 'overview', 'automation'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      setOpen(false)
      notify.success('Тестовое сообщение получено', 'Если подходит правило автоматизации — оно сработает.')
    } catch (error) {
      notify.error(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Tooltip content="Демо: получить входящее сообщение от собеседника">
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Симулировать входящее сообщение">
          <FlaskConical />
        </Button>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Входящее сообщение (демо)"
        description="Сообщение придёт от собеседника, как в настоящем Telegram. Так можно проверить правила автоматизации."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button onClick={submit} loading={busy} disabled={!text.trim()}>
              Получить сообщение
            </Button>
          </>
        }
      >
        <Field label="Текст сообщения">
          {(props) => <Textarea {...props} value={text} onChange={(event) => setText(event.target.value)} maxLength={4096} />}
        </Field>
      </Dialog>
    </>
  )
}
