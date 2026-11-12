import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, CircleSlash, ExternalLink, KeyRound, Lock, Sparkles, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErrorState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form'
import { Badge, Card, CardHeader, Skeleton } from '@/components/ui/primitives'
import { api, ApiError } from '@/lib/api'
import { notify } from '@/lib/notify'
import { keys } from '@/lib/queries'
import type { AiResult, AiSettings, AiStatus, ChatKind } from '@/lib/types'

const KNOWLEDGE_LIMIT = 50_000

function KeySection({ status }: { status: AiStatus }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(!status.configured)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      queryClient.setQueryData(keys.ai, await api.setAiKey(value.trim()))
      setValue('')
      setEditing(false)
      notify.success('Ключ проверен и сохранён')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить ключ')
    } finally {
      setBusy(false)
    }
  }

  if (!editing && status.configured) {
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4 sm:flex-row sm:items-center">
        <Lock className="size-4 shrink-0 text-success" />
        <p className="flex-1 text-[13px] text-muted-foreground">
          Ваш ключ Anthropic сохранён в вашей учётной записи в зашифрованном виде и используется только для ваших автоответов.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <KeyRound /> Заменить
          </Button>
          {status.key_source === 'account' && (
            <ConfirmDialog
              title="Удалить ключ ИИ?"
              description="Правила с ответами от ИИ перестанут отправлять ответы, пока вы не добавите ключ снова."
              confirmLabel="Удалить"
              destructive
              onConfirm={async () => {
                try {
                  queryClient.setQueryData(keys.ai, await api.deleteAiKey())
                  notify.success('Ключ удалён')
                } catch (err) {
                  notify.error(err)
                  throw err
                }
              }}
              trigger={
                <Button variant="ghost" size="sm" aria-label="Удалить ключ">
                  <Trash2 />
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl bg-surface-2 p-4" noValidate>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted-foreground">
        <li>
          Откройте{' '}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            console.anthropic.com <ExternalLink className="size-3" />
          </a>
          , пополните баланс и создайте ключ (Create Key).
        </li>
        <li>Вставьте ключ ниже — приложение проверит его и сохранит в вашей учётной записи в зашифрованном виде.</li>
      </ol>
      <Field label="Ключ Anthropic API" error={error}>
        {(props) => (
          <Input
            {...props}
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={value.trim().length < 20}>
          Проверить и сохранить
        </Button>
        {status.configured && (
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  )
}

function SettingsForm({ status }: { status: AiStatus }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AiSettings>(status.settings)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(status.settings)
  const set = <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      queryClient.setQueryData(keys.ai, await api.saveAiSettings(form))
      notify.success('Настройки ассистента сохранены')
    } catch (err) {
      notify.error(err, 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field
        label="Кто отвечает и как"
        hint="Имя, чем вы занимаетесь, тон общения. Например: «Я Шахриёр, продаю книги. Пиши дружелюбно, на «вы»»."
      >
        {(props) => (
          <Textarea
            {...props}
            value={form.persona}
            onChange={(e) => set('persona', e.target.value)}
            maxLength={4000}
            className="min-h-20"
            placeholder="Я … Отвечай вежливо и коротко."
          />
        )}
      </Field>
      <Field
        label="База знаний"
        hint={`Факты, на которые ассистент может опираться: цены, график, адрес, частые вопросы. Ничего за пределами этого текста он не выдумывает. ${form.knowledge.length.toLocaleString('ru-RU')} / ${KNOWLEDGE_LIMIT.toLocaleString('ru-RU')}`}
      >
        {(props) => (
          <Textarea
            {...props}
            value={form.knowledge}
            onChange={(e) => set('knowledge', e.target.value)}
            maxLength={KNOWLEDGE_LIMIT}
            className="min-h-36 font-[inherit]"
            placeholder={'Доставка по городу — 15 000 сум, 1–2 дня.\nРаботаем с 9:00 до 19:00, без выходных.\nОплата: наличные, Click, Payme.'}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Максимальная длина ответа" hint="Символов">
          {(props) => (
            <NativeSelect {...props} value={form.max_reply_chars} onChange={(e) => set('max_reply_chars', Number(e.target.value))}>
              {[200, 400, 600, 1000, 2000].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Учитывать историю чата" hint="Сколько последних сообщений видит ассистент">
          {(props) => (
            <NativeSelect {...props} value={form.history_messages} onChange={(e) => set('history_messages', Number(e.target.value))}>
              {[0, 6, 12, 20, 40].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Не учитывать' : `${n} сообщений`}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <Button type="submit" loading={saving} disabled={!dirty}>
        Сохранить
      </Button>
    </form>
  )
}

export function AiPreview({ instructions = '', disabled }: { instructions?: string; disabled?: boolean }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<ChatKind>('user')
  const [result, setResult] = useState<AiResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setResult(null)
    try {
      setResult(await api.aiPreview(text, instructions, kind))
    } catch (err) {
      notify.error(err, 'Ассистент не ответил')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() && !busy && !disabled) {
              e.preventDefault()
              void run()
            }
          }}
          placeholder="Напишите сообщение, как будто вам пишет клиент или друг"
          aria-label="Пример входящего сообщения для ИИ"
        />
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as ChatKind)} className="sm:w-44" aria-label="Тип чата">
          <option value="user">Личный чат</option>
          <option value="supergroup">Группа</option>
        </NativeSelect>
        <Button type="button" variant="outline" onClick={run} loading={busy} disabled={!text.trim() || disabled}>
          {!busy && <Sparkles />} Получить ответ
        </Button>
      </div>
      {result && (
        <div className="space-y-2 rounded-xl border border-border bg-chat-backdrop p-3 animate-enter" role="status">
          {result.should_reply ? (
            <div className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-bubble-out px-3 py-2 text-[14px] whitespace-pre-wrap">
              {result.reply}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <CircleSlash className="size-4" /> Ассистент не стал бы отвечать на это сообщение.
            </p>
          )}
          <p className="text-[12px] text-subtle-foreground">
            {result.reason} · токенов: {result.input_tokens} + {result.output_tokens}
          </p>
        </div>
      )}
      <p className="text-[12px] text-subtle-foreground">Проверка ничего не отправляет, но это платный запрос к ИИ.</p>
    </div>
  )
}

export function AiAssistantCard() {
  const status = useQuery({ queryKey: keys.ai, queryFn: api.ai })

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Bot className="size-4 text-primary" /> ИИ-ассистент
          </span>
        }
        description="Понимает смысл сообщения и сам составляет ответ по вашей базе знаний. Сомнительные сообщения пропускает."
        action={
          status.data && (
            <Badge tone={status.data.configured ? 'success' : 'warning'}>{status.data.configured ? 'Подключён' : 'Нужен ключ'}</Badge>
          )
        }
      />
      <div className="space-y-6 px-5 pb-5">
        {status.isPending ? (
          <Skeleton className="h-40" />
        ) : status.isError ? (
          <ErrorState error={status.error} onRetry={() => status.refetch()} />
        ) : (
          <>
            <KeySection status={status.data} />
            <SettingsForm key={JSON.stringify(status.data.settings)} status={status.data} />
            <section className="space-y-2 border-t border-border pt-5">
              <h3 className="text-[13.5px] font-medium">Проверить ассистента</h3>
              <AiPreview disabled={!status.data.configured} />
            </section>
            <p className="text-[12px] leading-relaxed text-subtle-foreground">
              Модель {status.data.model} (Anthropic). Каждый ответ — платный запрос по тарифам Anthropic; переписка из чата
              отправляется в Anthropic для составления ответа. Лимиты и паузы автоматизации действуют и для ИИ.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
