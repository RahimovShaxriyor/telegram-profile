import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleX, Plus, Sparkles, X } from 'lucide-react'
import { Link } from 'react-router'
import { AiPreview } from '@/components/AiAssistantCard'
import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Avatar } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Label, NativeSelect, Textarea } from '@/components/ui/form'
import { Badge, Switch, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { api, ApiError } from '@/lib/api'
import { KIND_LABEL } from '@/lib/format'
import { notify } from '@/lib/notify'
import { keys, useDialogs } from '@/lib/queries'
import type { ChatKind, MatchMode, ReplyMode, Rule, RuleInput } from '@/lib/types'
import { cn } from '@/lib/utils'

export const EMPTY_RULE: RuleInput = {
  name: '',
  enabled: false,
  dry_run: true,
  private_only: true,
  chat_ids: [],
  match_mode: 'keywords',
  keywords: [],
  pattern: '',
  reply_mode: 'template',
  reply_text: '',
  ai_instructions: '',
  cooldown_minutes: 60,
  daily_limit: 20,
}

export function validateRule(rule: RuleInput): Partial<Record<keyof RuleInput, string>> {
  const errors: Partial<Record<keyof RuleInput, string>> = {}
  if (!rule.name.trim()) errors.name = 'Назовите правило, чтобы узнавать его в журнале'
  if (rule.reply_mode === 'template' && !rule.reply_text.trim()) errors.reply_text = 'Напишите текст автоответа'
  if (rule.reply_text.length > 1000) errors.reply_text = 'Не длиннее 1000 символов'
  if (rule.ai_instructions.length > 2000) errors.ai_instructions = 'Не длиннее 2000 символов'
  if (rule.match_mode === 'keywords' && rule.keywords.length === 0) errors.keywords = 'Добавьте хотя бы одно ключевое слово'
  if (rule.match_mode === 'regex') {
    if (!rule.pattern) errors.pattern = 'Укажите регулярное выражение'
    else {
      try {
        new RegExp(rule.pattern)
      } catch {
        errors.pattern = 'Некорректное регулярное выражение'
      }
    }
  }
  if (!rule.private_only && rule.chat_ids.length === 0) errors.chat_ids = 'Выберите хотя бы один чат'
  if (!(rule.cooldown_minutes >= 5)) errors.cooldown_minutes = 'Не меньше 5 минут'
  if (!(rule.daily_limit >= 1 && rule.daily_limit <= 50)) errors.daily_limit = 'От 1 до 50'
  return errors
}

function KeywordInput({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const [draft, setDraft] = useState('')
  function add() {
    const word = draft.trim()
    if (word && !value.includes(word)) onChange([...value, word])
    setDraft('')
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add()
    } else if (event.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }
  return (
    <Field label="Ключевые слова" hint="Сработает, если сообщение содержит любое из слов. Регистр не важен. Enter — добавить." error={error}>
      {(props) => (
        <div
          className={cn(
            'flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-surface px-2 py-1.5 shadow-xs focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring',
            error && 'border-danger',
          )}
        >
          {value.map((word) => (
            <Badge key={word} tone="primary" className="py-1 pr-1">
              {word}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-primary/15"
                onClick={() => onChange(value.filter((w) => w !== word))}
                aria-label={`Удалить «${word}»`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <input
            {...props}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={add}
            placeholder={value.length ? '' : 'например: созвон, встреча'}
            className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
          />
        </div>
      )}
    </Field>
  )
}

function ChatPicker({ value, onChange, error }: { value: number[]; onChange: (v: number[]) => void; error?: string }) {
  const dialogs = useDialogs('all', 500)
  const [q, setQ] = useState('')
  const options = useMemo(
    () =>
      (dialogs.data?.items ?? [])
        .filter((d) => d.kind !== 'channel')
        .filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase())),
    [dialogs.data, q],
  )
  return (
    <div className="grid gap-1.5">
      <Label>Чаты, в которых работает правило</Label>
      <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Найти чат" aria-label="Найти чат" />
      <div
        className={cn('max-h-48 overflow-y-auto rounded-lg border border-border p-1 scrollbar-thin', error && 'border-danger')}
        role="group"
        aria-label="Выбор чатов"
      >
        {dialogs.isPending && <p className="p-3 text-[13px] text-muted-foreground">Загрузка чатов…</p>}
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
              <Avatar id={d.id} name={d.title} size={24} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{d.title}</span>
              <span className="text-[11.5px] text-subtle-foreground">{KIND_LABEL[d.kind]}</span>
            </label>
          )
        })}
      </div>
      {error ? (
        <p className="text-[12.5px] text-danger">{error}</p>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">Выбрано: {value.length}. Каналы недоступны: в них не бывает входящих сообщений.</p>
      )}
    </div>
  )
}

function RuleTester({ rule }: { rule: RuleInput }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<ChatKind>('user')
  const [result, setResult] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  async function check() {
    setBusy(true)
    try {
      setResult((await api.checkRule(rule, text, kind)).matches)
    } catch (error) {
      setResult(null)
      notify.error(error, 'Проверка не удалась')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-surface-2 p-3">
      <div className="text-[13px] font-medium">Проверить условие</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setResult(null)
          }}
          placeholder="Пример входящего сообщения"
          aria-label="Пример входящего сообщения"
        />
        <NativeSelect
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as ChatKind)
            setResult(null)
          }}
          className="sm:w-40"
          aria-label="Тип чата"
        >
          <option value="user">Личный чат</option>
          <option value="group">Группа</option>
          <option value="supergroup">Супергруппа</option>
        </NativeSelect>
        <Button type="button" variant="outline" onClick={check} loading={busy} disabled={!text}>
          Проверить
        </Button>
      </div>
      {result !== null && (
        <p className={cn('flex items-center gap-1.5 text-[13px]', result ? 'text-success' : 'text-muted-foreground')} role="status">
          {result ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
          {result ? 'Правило сработает на такое сообщение' : 'Правило не сработает'}
        </p>
      )}
      <p className="text-[12px] text-subtle-foreground">Проверка ничего не отправляет. Для групп учитывается список выбранных чатов.</p>
    </div>
  )
}

interface RuleEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: Rule | null
  onSaved: () => void
}

export function RuleEditor({ open, onOpenChange, rule, onSaved }: RuleEditorProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={rule ? 'Изменить правило' : 'Новое правило'}
      description="Правило отвечает на входящие сообщения. Ограничители безопасности действуют всегда."
      className="max-w-2xl"
    >
      {open && <RuleForm key={rule?.id ?? 'new'} rule={rule} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
    </Dialog>
  )
}

function RuleForm({ rule, onCancel, onSaved }: { rule: Rule | null; onCancel: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RuleInput>(() => {
    if (!rule) return EMPTY_RULE
    const { id: _id, created_at: _c, updated_at: _u, ...input } = rule
    return input
  })
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const errors = validateRule(form)
  const shown = touched ? errors : {}

  const set = <K extends keyof RuleInput>(key: K, value: RuleInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setServerError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (Object.keys(errors).length) return
    setSaving(true)
    try {
      if (rule) await api.updateRule(rule.id, form)
      else await api.createRule(form)
      notify.success(rule ? 'Правило сохранено' : 'Правило создано', form.dry_run ? 'Работает в тестовом режиме: ничего не отправляет.' : undefined)
      onSaved()
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : 'Не удалось сохранить правило')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="Название" error={shown.name}>
        {(props) => (
          <Input {...props} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="Например: Нет на месте" />
        )}
      </Field>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-[13px] font-medium">Где работает</legend>
        <Tabs value={form.private_only ? 'private' : 'chats'} onValueChange={(v) => set('private_only', v === 'private')}>
          <TabsList>
            <TabsTrigger value="private">Все личные чаты</TabsTrigger>
            <TabsTrigger value="chats">Выбранные чаты</TabsTrigger>
          </TabsList>
        </Tabs>
        {form.private_only ? (
          <p className="text-[12.5px] text-muted-foreground">
            Только личная переписка с людьми. Группы и боты не затрагиваются.
          </p>
        ) : (
          <ChatPicker value={form.chat_ids} onChange={(v) => set('chat_ids', v)} error={shown.chat_ids} />
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-[13px] font-medium">Когда срабатывает</legend>
        <Tabs value={form.match_mode} onValueChange={(v) => set('match_mode', v as MatchMode)}>
          <TabsList>
            <TabsTrigger value="keywords">По ключевым словам</TabsTrigger>
            <TabsTrigger value="any">На любое сообщение</TabsTrigger>
            <TabsTrigger value="regex">Регулярное выражение</TabsTrigger>
          </TabsList>
        </Tabs>
        {form.match_mode === 'keywords' && (
          <KeywordInput value={form.keywords} onChange={(v) => set('keywords', v)} error={shown.keywords} />
        )}
        {form.match_mode === 'regex' && (
          <Field label="Регулярное выражение" hint="Для опытных пользователей. Пример: (?i)заказ\s*№?\d+" error={shown.pattern}>
            {(props) => (
              <Input {...props} value={form.pattern} onChange={(e) => set('pattern', e.target.value)} className="font-mono" maxLength={200} spellCheck={false} />
            )}
          </Field>
        )}
        {form.match_mode === 'any' && (
          <p className="text-[12.5px] text-muted-foreground">Подходит для автоответа «Я в отпуске». Пауза между ответами защищает собеседника от повторов.</p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-[13px] font-medium">Как отвечать</legend>
        <Tabs value={form.reply_mode} onValueChange={(v) => set('reply_mode', v as ReplyMode)}>
          <TabsList>
            <TabsTrigger value="template">Готовый текст</TabsTrigger>
            <TabsTrigger value="ai">
              <Sparkles /> Ответ составит ИИ
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {form.reply_mode === 'template' ? (
          <Field label="Текст автоответа" error={shown.reply_text} hint={`${form.reply_text.length} / 1000`}>
            {(props) => (
              <Textarea {...props} value={form.reply_text} onChange={(e) => set('reply_text', e.target.value)} placeholder="Спасибо за сообщение! Отвечу, как только освобожусь." />
            )}
          </Field>
        ) : (
          <AiReplySection instructions={form.ai_instructions} onChange={(v) => set('ai_instructions', v)} error={shown.ai_instructions} />
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Пауза в одном чате, мин" hint="Не чаще одного ответа за это время (минимум 5)" error={shown.cooldown_minutes}>
          {(props) => (
            <Input {...props} type="number" min={5} max={10080} value={form.cooldown_minutes} onChange={(e) => set('cooldown_minutes', Number(e.target.value))} />
          )}
        </Field>
        <Field label="Лимит ответов в сутки" hint="Для этого правила, не больше 50" error={shown.daily_limit}>
          {(props) => (
            <Input {...props} type="number" min={1} max={50} value={form.daily_limit} onChange={(e) => set('daily_limit', Number(e.target.value))} />
          )}
        </Field>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-[13.5px] font-medium">Тестовый режим (dry-run)</span>
            <span className="block text-[12.5px] text-muted-foreground">Правило только записывает в журнал, что ответило бы. Ничего не отправляется.</span>
          </span>
          <Switch checked={form.dry_run} onCheckedChange={(v) => set('dry_run', v)} aria-label="Тестовый режим" />
        </label>
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-[13.5px] font-medium">Правило активно</span>
            <span className="block text-[12.5px] text-muted-foreground">Работает, только когда включена вся автоматизация.</span>
          </span>
          <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} aria-label="Правило активно" />
        </label>
      </div>

      <RuleTester rule={form} />

      {serverError && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-soft-foreground" role="alert">
          {serverError}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" loading={saving}>
          {!saving && !rule && <Plus />}
          {rule ? 'Сохранить' : 'Создать правило'}
        </Button>
      </div>
    </form>
  )
}

function AiReplySection({ instructions, onChange, error }: { instructions: string; onChange: (v: string) => void; error?: string }) {
  const ai = useQuery({ queryKey: keys.ai, queryFn: api.ai })
  const configured = ai.data?.configured ?? false
  return (
    <div className="space-y-3">
      {ai.data && !configured && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning-soft-foreground">
          ИИ ещё не подключён: добавьте ключ в карточке «ИИ-ассистент» на странице{' '}
          <Link to="/automation" className="font-medium underline">
            Автоматизация
          </Link>
          . Правило можно сохранить уже сейчас.
        </p>
      )}
      <Field
        label="Указания для ИИ в этом правиле (необязательно)"
        hint="Например: «Отвечай только про доставку и оплату, про остальное — что я перезвоню». Описание и база знаний из настроек ассистента учитываются всегда."
        error={error}
      >
        {(props) => (
          <Textarea {...props} value={instructions} onChange={(e) => onChange(e.target.value)} maxLength={2000} className="min-h-16" />
        )}
      </Field>
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="mb-2 text-[13px] font-medium">Пример ответа</div>
        <AiPreview instructions={instructions} disabled={!configured} />
      </div>
    </div>
  )
}
