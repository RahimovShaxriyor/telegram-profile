import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive as ArchiveIcon,
  CircleAlert,
  CircleCheck,
  Download,
  FileDown,
  FolderInput,
  History,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  SearchX,
  Trash2,
} from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState, ErrorState, PageHeader } from '@/components/common'
import { SearchInput } from '@/components/chat/ChatWorkspace'
import { useConnected } from '@/components/NotConnected'
import { Page } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog, Dialog } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { Badge, Card, CardHeader, Skeleton, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { api, ApiError, fetchBlob, saveBlob } from '@/lib/api'
import { formatBytes, formatDateTime, formatNumber, KIND_LABEL, MEDIA_LABEL } from '@/lib/format'
import { notify } from '@/lib/notify'
import { useDialogs, useStatus } from '@/lib/queries'
import type { ArchiveFilter, ArchivedMessage, ArchiveSettings, ImportStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50
type Tab = 'messages' | 'import' | 'settings'

/* ------------------------------------------------------------------ stats */

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'primary' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[20px] font-semibold tracking-tight tabular',
          tone === 'danger' && 'text-danger',
          tone === 'primary' && 'text-primary',
        )}
      >
        {value}
      </div>
    </div>
  )
}

function Stats() {
  const stats = useQuery({ queryKey: ['archive', 'stats'], queryFn: api.archiveStats, refetchInterval: 15_000 })
  if (!stats.data) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
    )
  }
  const s = stats.data
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Сообщений в архиве" value={formatNumber(s.messages)} />
      <Stat label="Удалено в Telegram" value={formatNumber(s.deleted)} tone={s.deleted ? 'danger' : undefined} />
      <Stat label="Изменено" value={formatNumber(s.edited)} tone={s.edited ? 'primary' : undefined} />
      <Stat
        label={s.media_files ? 'Чатов · файлы' : 'Чатов'}
        value={s.media_files ? `${formatNumber(s.chats)} · ${formatBytes(s.media_bytes)}` : formatNumber(s.chats)}
      />
    </div>
  )
}

/* --------------------------------------------------------------- messages */

function MediaPreview({ message }: { message: ArchivedMessage }) {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const media = message.media!
  const isPhoto = media.kind === 'photo'

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  async function load(download: boolean) {
    setBusy(true)
    try {
      const blob = await fetchBlob(`/api/archive/messages/${message.id}/media`)
      if (download) saveBlob(blob, media.file_name ?? `${media.kind}-${message.message_id}`)
      else setUrl(URL.createObjectURL(blob))
    } catch (error) {
      notify.error(error)
    } finally {
      setBusy(false)
    }
  }

  if (url) return <img src={url} alt="Фото из архива" className="mt-2 max-h-72 rounded-lg border border-border" />
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1">
        <ImageIcon className="size-3.5" />
        {media.file_name ?? MEDIA_LABEL[media.kind]}
        {media.size ? ` · ${formatBytes(media.size)}` : ''}
      </span>
      {media.ttl ? (
        <span>исчезающее медиа — не сохраняется</span>
      ) : message.has_file ? (
        <Button variant="ghost" size="sm" loading={busy} onClick={() => load(!isPhoto)}>
          {isPhoto ? 'Показать фото' : 'Скачать'}
        </Button>
      ) : (
        <span>файл не сохранён</span>
      )}
    </div>
  )
}

function EditsDialog({ message, onClose }: { message: ArchivedMessage; onClose: () => void }) {
  const edits = useQuery({ queryKey: ['archive', 'edits', message.id], queryFn: () => api.archiveEdits(message.id) })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="История изменений" description="Как менялся текст сообщения.">
      {edits.isPending ? (
        <Skeleton className="h-24" />
      ) : edits.isError ? (
        <ErrorState error={edits.error} />
      ) : edits.data.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Telegram отметил сообщение как изменённое, но прежняя версия не была сохранена (например, при импорте экспорта).
        </p>
      ) : (
        <ol className="space-y-3">
          {edits.data.map((edit, i) => (
            <li key={i} className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-[13.5px]">
              <div className="text-[12px] text-subtle-foreground">{formatDateTime(edit.edited_at)}</div>
              <p className="whitespace-pre-wrap text-muted-foreground line-through decoration-danger/50">{edit.old_text || '(пусто)'}</p>
              <p className="whitespace-pre-wrap">{edit.new_text || '(пусто)'}</p>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  )
}

function MessageCard({ message, onShowEdits }: { message: ArchivedMessage; onShowEdits: () => void }) {
  return (
    <li className={cn('px-4 py-3.5', message.deleted_at && 'bg-danger-soft/30')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        <span className="font-medium text-foreground">{message.chat_title ?? message.chat_id}</span>
        {(message.outgoing || message.sender_name !== message.chat_title) && (
          <span className="text-muted-foreground">· {message.outgoing ? 'Вы' : (message.sender_name ?? 'Собеседник')}</span>
        )}
        <span className="text-subtle-foreground tabular">· {formatDateTime(message.date)}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {message.deleted_at && (
            <Badge tone="danger">
              <Trash2 /> Удалено {formatDateTime(message.deleted_at)}
            </Badge>
          )}
          {message.edited_at && (
            <button type="button" onClick={onShowEdits} className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
              <Badge tone="primary" className="cursor-pointer hover:opacity-80">
                <Pencil /> Изменено{message.edit_count ? ` · ${message.edit_count}` : ''}
              </Badge>
            </button>
          )}
          {message.source === 'import' && <Badge>Импорт</Badge>}
        </span>
      </div>
      {message.text ? (
        <p className="mt-1.5 text-[14px] leading-relaxed break-words whitespace-pre-wrap">{message.text}</p>
      ) : (
        !message.media && <p className="mt-1.5 text-[13px] text-subtle-foreground italic">Без текста</p>
      )}
      {message.media && <MediaPreview message={message} />}
    </li>
  )
}

function MessagesTab() {
  const [params, setParams] = useSearchParams()
  const only = (['all', 'deleted', 'edited'].includes(params.get('only') ?? '') ? params.get('only') : 'all') as ArchiveFilter
  const [chatId, setChatId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [editsFor, setEditsFor] = useState<ArchivedMessage | null>(null)
  const [exporting, setExporting] = useState(false)
  const q = useDeferredValue(search.trim())
  const chats = useQuery({ queryKey: ['archive', 'chats'], queryFn: api.archiveChats })
  const messages = useInfiniteQuery({
    queryKey: ['archive', 'messages', { q, chatId, only }],
    queryFn: ({ pageParam }) => api.archiveMessages({ q, chat_id: chatId, only, offset: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_cursor,
    placeholderData: keepPreviousData,
  })
  const items = useMemo(() => messages.data?.pages.flatMap((p) => p.items) ?? [], [messages.data])
  const total = messages.data?.pages[0]?.total ?? 0

  async function exportCsv() {
    setExporting(true)
    try {
      saveBlob(await fetchBlob('/api/archive/export.csv', { chat_id: chatId, only }), 'tpam-archive.csv')
    } catch (error) {
      notify.error(error, 'Не удалось выгрузить')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
        <Tabs
          value={only}
          onValueChange={(value) =>
            setParams((current) => {
              const next = new URLSearchParams(current)
              if (value === 'all') next.delete('only')
              else next.set('only', value)
              return next
            })
          }
        >
          <TabsList>
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="deleted">
              <Trash2 /> Удалённые
            </TabsTrigger>
            <TabsTrigger value="edited">
              <Pencil /> Изменённые
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <NativeSelect
          value={chatId ?? ''}
          onChange={(e) => setChatId(e.target.value ? Number(e.target.value) : null)}
          className="h-8 lg:w-64"
          aria-label="Чат"
        >
          <option value="">Все чаты</option>
          {chats.data?.map((chat) => (
            <option key={chat.id} value={chat.id}>
              {chat.title} · {formatNumber(chat.messages)}
              {chat.deleted ? ` · удалено ${chat.deleted}` : ''}
            </option>
          ))}
        </NativeSelect>
        <div className="lg:ml-auto lg:w-72">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск по тексту" label="Поиск по архиву" />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} loading={exporting} disabled={!total}>
          {!exporting && <FileDown />} CSV
        </Button>
      </div>

      {messages.isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : messages.isError ? (
        <ErrorState error={messages.error} onRetry={() => messages.refetch()} />
      ) : items.length === 0 ? (
        q || chatId || only !== 'all' ? (
          <EmptyState icon={SearchX} title="Ничего не найдено" description="Измените фильтры или запрос." />
        ) : (
          <EmptyState
            icon={ArchiveIcon}
            title="Архив пока пуст"
            description="Новые сообщения будут сохраняться автоматически. Старую переписку можно загрузить на вкладке «Импорт»."
          />
        )
      ) : (
        <>
          <p className="px-4 pt-3 text-[12.5px] text-muted-foreground">Найдено: {formatNumber(total)}</p>
          <ul className={cn('divide-y divide-border', messages.isPlaceholderData && 'opacity-60')}>
            {items.map((message) => (
              <MessageCard key={message.id} message={message} onShowEdits={() => setEditsFor(message)} />
            ))}
          </ul>
          {messages.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="outline" size="sm" loading={messages.isFetchingNextPage} onClick={() => messages.fetchNextPage()}>
                Показать ещё
              </Button>
            </div>
          )}
        </>
      )}
      {editsFor && <EditsDialog message={editsFor} onClose={() => setEditsFor(null)} />}
    </Card>
  )
}

/* ----------------------------------------------------------------- import */

function ImportProgress({ status }: { status: ImportStatus }) {
  if (status.state === 'idle') return null
  const icon =
    status.state === 'running' ? (
      <LoaderCircle className="size-5 animate-spin text-primary" />
    ) : status.state === 'done' ? (
      <CircleCheck className="size-5 text-success" />
    ) : (
      <CircleAlert className="size-5 text-danger" />
    )
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-4 animate-enter" role="status" aria-live="polite">
      {icon}
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-medium">
          {status.state === 'running' ? 'Импорт идёт…' : status.state === 'done' ? 'Импорт завершён' : 'Импорт не удался'}
        </div>
        {status.error && <p className="mt-0.5 text-danger">{status.error}</p>}
        <p className="mt-0.5 text-muted-foreground tabular">
          Чатов: {formatNumber(status.chats_done)} · добавлено сообщений: {formatNumber(status.messages_imported)}
          {status.messages_skipped ? ` · уже были в архиве: ${formatNumber(status.messages_skipped)}` : ''}
        </p>
        {status.current_chat && status.state === 'running' && (
          <p className="mt-0.5 truncate text-subtle-foreground">Сейчас: {status.current_chat}</p>
        )}
      </div>
    </div>
  )
}

function ImportTab() {
  const queryClient = useQueryClient()
  const isOwner = useStatus().data?.is_owner ?? false
  const [path, setPath] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ['archive', 'import'],
    queryFn: api.archiveImportStatus,
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1000 : false),
  })
  const running = status.data?.state === 'running'
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (status.data?.state === 'done') {
      for (const key of ['stats', 'chats', 'messages']) void queryClient.invalidateQueries({ queryKey: ['archive', key] })
    }
  }, [status.data?.state, queryClient])

  async function begin(action: () => Promise<ImportStatus>) {
    setError(null)
    setUploading(true)
    try {
      queryClient.setQueryData(['archive', 'import'], await action())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось начать импорт')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Импорт истории из Telegram" description="Загрузите прошлую переписку из официального экспорта. Повторный импорт не создаёт дублей." />
      <div className="space-y-5 px-5 pb-5">
        <ol className="list-decimal space-y-1.5 rounded-xl bg-surface-2 p-4 pl-9 text-[13px] leading-relaxed text-muted-foreground">
          <li>Откройте Telegram Desktop → Настройки → Продвинутые настройки → «Экспорт данных из Telegram».</li>
          <li>
            Отметьте нужные чаты. Внизу выберите формат <b className="text-foreground">«Машиночитаемый JSON»</b>.
          </li>
          <li>Подтвердите экспорт в Telegram на телефоне — появится папка «DataExport_…» с файлом result.json.</li>
          <li>Выберите этот файл ниже.</li>
        </ol>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (file) void begin(() => api.uploadArchiveImport(file))
          }}
          className="space-y-3"
          noValidate
        >
          <Field label="Файл result.json" hint="Загружается только текст переписки (до 1 ГБ). Фото и файлы остаются у вас.">
            {(props) => (
              <Input
                {...props}
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setError(null)
                }}
                className="h-auto py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-[13px]"
              />
            )}
          </Field>
          <Button type="submit" disabled={!file || running} loading={uploading || running}>
            {!(uploading || running) && <FolderInput />} Загрузить и импортировать
          </Button>
        </form>
        {isOwner && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              void begin(() => api.startArchiveImport(path))
            }}
            className="space-y-3 border-t border-border pt-5"
            noValidate
          >
            <Field
              label="Или папка экспорта на сервере (администратор)"
              hint="Вместе с фото и файлами: архив ссылается на них в папке, поэтому не удаляйте её после импорта."
            >
              {(props) => (
                <Input
                  {...props}
                  value={path}
                  onChange={(e) => {
                    setPath(e.target.value)
                    setError(null)
                  }}
                  placeholder="C:\Users\…\Downloads\Telegram Desktop\DataExport_2026-11-12"
                  spellCheck={false}
                  className="font-mono text-[13px]"
                />
              )}
            </Field>
            <Button type="submit" variant="outline" disabled={path.trim().length < 3 || running}>
              Импортировать из папки
            </Button>
          </form>
        )}
        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-soft-foreground" role="alert">
            {error}
          </p>
        )}
        {status.data && <ImportProgress status={status.data} />}
      </div>
    </Card>
  )
}

/* --------------------------------------------------------------- settings */

function ExtraChats({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const connected = useConnected()
  const dialogs = useDialogs('all', 500, connected)
  const [q, setQ] = useState('')
  if (!connected) return <p className="text-[12.5px] text-muted-foreground">Список чатов доступен после подключения Telegram.</p>
  const options = (dialogs.data?.items ?? []).filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти чат" aria-label="Найти чат для архива" />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-1 scrollbar-thin" role="group" aria-label="Дополнительные чаты">
        {options.map((d) => {
          const checked = value.includes(d.id)
          return (
            <label key={d.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked ? value.filter((id) => id !== d.id) : [...value, d.id])}
                className="size-4 accent-[var(--primary)]"
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">{d.title}</span>
              <span className="text-[11.5px] text-subtle-foreground">{KIND_LABEL[d.kind]}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function ToggleRow({ title, description, checked, onChange, label }: {
  title: string
  description: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12.5px] leading-relaxed text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  )
}

function SettingsForm({ initial }: { initial: ArchiveSettings }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const set = <K extends keyof ArchiveSettings>(key: K, value: ArchiveSettings[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function save() {
    setSaving(true)
    try {
      queryClient.setQueryData(['archive', 'settings'], await api.saveArchiveSettings(form))
      notify.success('Настройки архива сохранены')
    } catch (error) {
      notify.error(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="divide-y divide-border">
        <ToggleRow
          title="Сохранять сообщения"
          description="Каждое новое сообщение сразу копируется в архив на этом компьютере. Если его потом удалят или изменят в Telegram, копия останется."
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
          label="Сохранять сообщения"
        />
        <ToggleRow
          title="Все личные чаты"
          description="Переписка с людьми (без ботов)."
          checked={form.private_chats}
          onChange={(v) => set('private_chats', v)}
          label="Все личные чаты"
        />
        <ToggleRow
          title="Все группы"
          description="Может занимать много места в активных группах."
          checked={form.groups}
          onChange={(v) => set('groups', v)}
          label="Все группы"
        />
      </div>
      <Field label="Дополнительно сохранять эти чаты" hint="Например, один важный канал, бот или конкретная группа.">
        {() => <ExtraChats value={form.chat_ids} onChange={(v) => set('chat_ids', v)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Медиа" hint="Исчезающие фото и видео («просмотр один раз») не сохраняются никогда.">
          {(props) => (
            <NativeSelect {...props} value={form.media} onChange={(e) => set('media', e.target.value as ArchiveSettings['media'])}>
              <option value="none">Только текст</option>
              <option value="photos">Текст и фото</option>
              <option value="all">Текст, фото, видео и файлы</option>
            </NativeSelect>
          )}
        </Field>
        <Field label="Максимальный размер файла">
          {(props) => (
            <NativeSelect {...props} value={form.max_media_mb} onChange={(e) => set('max_media_mb', Number(e.target.value))} disabled={form.media === 'none'}>
              {[5, 20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  до {n} МБ
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <Button onClick={save} loading={saving} disabled={!dirty}>
        Сохранить
      </Button>
    </div>
  )
}

function AutostartRow() {
  const queryClient = useQueryClient()
  const isOwner = useStatus().data?.is_owner ?? false
  const autostart = useQuery({ queryKey: ['autostart'], queryFn: api.autostart, enabled: isOwner })
  const [busy, setBusy] = useState(false)
  if (!autostart.data?.supported) return null
  return (
    <ToggleRow
      title="Запускать TPAM вместе с Windows"
      description="Архив сохраняет только то, что пришло, пока TPAM работает. Автозапуск свёрнут и без открытия браузера."
      checked={autostart.data.enabled}
      onChange={async (enabled) => {
        if (busy) return
        setBusy(true)
        try {
          queryClient.setQueryData(['autostart'], await api.setAutostart(enabled))
          notify.success(enabled ? 'Автозапуск включён' : 'Автозапуск выключен')
        } catch (error) {
          notify.error(error)
        } finally {
          setBusy(false)
        }
      }}
      label="Автозапуск с Windows"
    />
  )
}

function SettingsTab() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['archive', 'settings'], queryFn: api.archiveSettings })
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Что сохранять" />
        <div className="px-5 pb-5">
          {settings.data ? (
            <SettingsForm key={JSON.stringify(settings.data)} initial={settings.data} />
          ) : settings.isError ? (
            <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
          ) : (
            <Skeleton className="h-64" />
          )}
        </div>
      </Card>
      <AutostartCard />
      <Card>
        <CardHeader title="Данные архива" description="Хранятся только на этом компьютере, в папке, доступной лишь вашей учётной записи Windows." />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <ConfirmDialog
            title="Очистить весь архив?"
            description="Будут удалены все сохранённые сообщения, история изменений и скачанные файлы. Сообщения в Telegram это не затрагивает. Отменить нельзя."
            confirmLabel="Очистить архив"
            destructive
            onConfirm={async () => {
              try {
                await api.clearArchive()
                await queryClient.invalidateQueries({ queryKey: ['archive'] })
                notify.success('Архив очищен')
              } catch (error) {
                notify.error(error)
                throw error
              }
            }}
            trigger={
              <Button variant="danger-ghost">
                <Trash2 /> Очистить архив
              </Button>
            }
          />
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------- page */

export default function Archive() {
  const [tab, setTab] = useState<Tab>('messages')
  return (
    <Page>
      <PageHeader
        title="Архив"
        description="Копия ваших переписок на этом компьютере. Сообщения, удалённые или изменённые в Telegram, здесь остаются."
        actions={
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="messages">
                <History /> Сообщения
              </TabsTrigger>
              <TabsTrigger value="import">
                <Download /> Импорт
              </TabsTrigger>
              <TabsTrigger value="settings">Настройки</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <Stats />
      {tab === 'messages' && <MessagesTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'settings' && <SettingsTab />}
    </Page>
  )
}

function AutostartCard() {
  const isOwner = useStatus().data?.is_owner ?? false
  if (!isOwner) return null
  return (
    <Card>
      <CardHeader title="Работа без перерывов" description="Архив сохраняет только то, что пришло, пока сервер TPAM работает." />
      <div className="px-5 pb-2">
        <AutostartRow />
      </div>
    </Card>
  )
}
