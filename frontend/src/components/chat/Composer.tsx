import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Lock, Paperclip, SendHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { formatBytes, MEDIA_LABEL } from '@/lib/format'
import { notify } from '@/lib/notify'
import { usePrefs } from '@/lib/prefs'
import { keys } from '@/lib/queries'
import type { ChatDetails, Message, MessagePage } from '@/lib/types'
import { cn } from '@/lib/utils'

const MAX_TEXT = 4096
const MAX_CAPTION = 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024

interface ComposerProps {
  chat: ChatDetails
  replyTo: Message | null
  onCancelReply: () => void
}

/** Appends a sent message to the newest cached page so it shows instantly without a refetch. */
export function useAppendMessage() {
  const queryClient = useQueryClient()
  return (chatId: number, message: Message) => {
    queryClient.setQueryData<InfiniteData<MessagePage>>(keys.messages(chatId), (data) => {
      if (!data?.pages.length) return data
      const [first, ...rest] = data.pages
      if (first.items.some((m) => m.id === message.id)) return data
      return { ...data, pages: [{ ...first, items: [...first.items, message] }, ...rest] }
    })
    void queryClient.invalidateQueries({ queryKey: ['dialogs'] })
    void queryClient.invalidateQueries({ queryKey: ['overview'] })
    void queryClient.invalidateQueries({ queryKey: ['activity'] })
  }
}

export function Composer({ chat, replyTo, onCancelReply }: ComposerProps) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { enterToSend } = usePrefs()
  const append = useAppendMessage()

  const limit = file ? MAX_CAPTION : MAX_TEXT
  const tooLong = text.length > limit
  const canSubmit = !sending && !tooLong && (file !== null || text.trim().length > 0)

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus()
  }, [replyTo])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  if (!chat.can_send) {
    return (
      <div className="flex items-center justify-center gap-2 border-t border-border bg-surface px-4 py-4 text-[13px] text-muted-foreground">
        <Lock className="size-4" />
        {chat.kind === 'channel'
          ? 'В этом канале у вас нет права публиковать сообщения.'
          : 'Отправка сообщений в этот чат ограничена.'}
      </div>
    )
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSubmit) return
    setSending(true)
    try {
      const message = file
        ? await api.sendFile(chat.id, file, text.trim(), replyTo?.id)
        : await api.send(chat.id, text, replyTo?.id)
      append(chat.id, message)
      setText('')
      setFile(null)
      onCancelReply()
      textareaRef.current?.focus()
    } catch (error) {
      notify.error(error, 'Сообщение не отправлено')
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape' && replyTo) {
      onCancelReply()
      return
    }
    const sendCombo = enterToSend ? !event.shiftKey : event.ctrlKey || event.metaKey
    if (event.key === 'Enter' && sendCombo && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  function pickFile(selected: File | undefined) {
    if (!selected) return
    if (selected.size > MAX_FILE_BYTES) {
      notify.error(null, 'Файл больше 50 МБ — такие файлы пока не поддерживаются')
      return
    }
    setFile(selected)
    textareaRef.current?.focus()
  }

  return (
    <form onSubmit={submit} className="border-t border-border bg-surface px-3 py-3 sm:px-4">
      {(replyTo || file) && (
        <div className="mb-2 space-y-1.5">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-lg border-l-2 border-primary bg-primary-soft/60 py-1.5 pr-1 pl-3 animate-enter">
              <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
                <div className="font-medium text-primary">Ответ: {replyTo.sender_name ?? 'сообщение'}</div>
                <div className="truncate text-muted-foreground">
                  {replyTo.text || (replyTo.media ? MEDIA_LABEL[replyTo.media.kind] : '')}
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={onCancelReply} aria-label="Отменить ответ">
                <X />
              </Button>
            </div>
          )}
          {file && (
            <div className="flex items-center gap-2 rounded-lg bg-muted py-1.5 pr-1 pl-3 animate-enter">
              <Paperclip className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {file.name} <span className="text-muted-foreground">· {formatBytes(file.size)}</span>
              </span>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setFile(null)} aria-label="Убрать файл">
                <X />
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            pickFile(event.target.files?.[0])
            event.target.value = ''
          }}
          aria-hidden
          tabIndex={-1}
        />
        <Tooltip content="Прикрепить файл (до 50 МБ)">
          <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Прикрепить файл">
            <Paperclip />
          </Button>
        </Tooltip>
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={file ? 'Подпись к файлу (необязательно)' : 'Сообщение'}
            aria-label={file ? 'Подпись к файлу' : 'Текст сообщения'}
            aria-invalid={tooLong || undefined}
            className={cn(
              'block max-h-[200px] w-full resize-none rounded-xl border border-input bg-surface-2 px-3.5 py-2 text-[14px] leading-relaxed outline-none scrollbar-thin placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring',
              tooLong && 'border-danger',
            )}
          />
          {text.length > limit * 0.8 && (
            <span
              className={cn(
                'absolute right-3 -bottom-4.5 text-[11px] tabular',
                tooLong ? 'text-danger' : 'text-subtle-foreground',
              )}
            >
              {text.length} / {limit}
            </span>
          )}
        </div>
        <Tooltip content={enterToSend ? 'Отправить (Enter)' : 'Отправить (Ctrl+Enter)'}>
          <Button type="submit" size="icon" disabled={!canSubmit} loading={sending} aria-label="Отправить">
            {!sending && <SendHorizontal />}
          </Button>
        </Tooltip>
      </div>
    </form>
  )
}
