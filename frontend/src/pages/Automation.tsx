import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Bot, Clock, FlaskConical, Gauge, Pencil, Plus, ShieldCheck, Sparkles, Trash2, Workflow } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ActivityRow } from '@/components/ActivityRow'
import { EmptyState, ErrorState, PageHeader, StatusDot } from '@/components/common'
import { Page } from '@/components/layout/AppShell'
import { NotConnected, useConnected } from '@/components/NotConnected'
import { AiAssistantCard } from '@/components/AiAssistantCard'
import { RuleEditor } from '@/components/RuleEditor'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Badge, Card, CardHeader, Skeleton, Switch, Tooltip } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { notify } from '@/lib/notify'
import { keys } from '@/lib/queries'
import type { AutomationState, Rule } from '@/lib/types'
import { cn } from '@/lib/utils'

function describeRule(rule: Rule): string {
  const when =
    rule.match_mode === 'any'
      ? 'на любое сообщение'
      : rule.match_mode === 'keywords'
        ? `если есть «${rule.keywords.slice(0, 3).join('», «')}»${rule.keywords.length > 3 ? ` и ещё ${rule.keywords.length - 3}` : ''}`
        : 'по регулярному выражению'
  const where = rule.private_only
    ? rule.chat_ids.length
      ? `в ${rule.chat_ids.length} выбранных личных чатах`
      : 'в личных чатах'
    : `в ${rule.chat_ids.length} выбранных чатах`
  return `Отвечает ${where} ${when}`
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular">
          {value} / {max}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
        <div className={cn('h-full rounded-full transition-[width]', pct > 80 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function KillSwitch({ state }: { state: AutomationState }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  async function toggle(enabled: boolean) {
    setBusy(true)
    try {
      await api.setAutomation(enabled)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.automation }),
        queryClient.invalidateQueries({ queryKey: keys.status }),
        queryClient.invalidateQueries({ queryKey: keys.overview }),
      ])
      notify.success(enabled ? 'Автоматизация включена' : 'Автоматизация выключена')
    } catch (error) {
      notify.error(error)
    } finally {
      setBusy(false)
    }
  }

  const guards = [
    { icon: Clock, text: `Пауза между ответами в одном чате — минимум ${state.limits.min_cooldown_minutes} мин` },
    { icon: Gauge, text: `Не больше ${state.limits.global_per_hour} ответов в час и ${state.limits.global_per_day} в сутки` },
    { icon: Bot, text: 'Никогда не отвечает ботам и на свои сообщения' },
    { icon: Ban, text: 'Пропускает старые сообщения после перерыва в работе' },
  ]

  return (
    <Card className={cn('overflow-hidden', state.enabled && 'ring-1 ring-success/30')}>
      <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center">
        <div className="flex flex-1 items-start gap-4">
          <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-2xl', state.enabled ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground')}>
            <Workflow className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold">Автоматизация {state.enabled ? 'включена' : 'выключена'}</h2>
              <StatusDot tone={state.enabled ? 'success' : 'neutral'} pulse={state.enabled} />
            </div>
            <p className="mt-0.5 max-w-lg text-[13px] text-muted-foreground">
              {state.enabled
                ? 'Активные правила отвечают на подходящие входящие сообщения. Выключите — и все правила остановятся сразу.'
                : 'Главный выключатель. Пока он выключен, ни одно правило не сработает.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 md:pl-4">
          <span className="text-[13px] text-muted-foreground">{state.enabled ? 'Вкл.' : 'Выкл.'}</span>
          <Switch checked={state.enabled} onCheckedChange={toggle} disabled={busy} aria-label="Автоматизация" className="scale-125" />
        </div>
      </div>
      <div className="grid gap-5 border-t border-border bg-surface-2 p-5 md:grid-cols-[1fr_1.3fr]">
        <div className="space-y-3">
          <Meter value={state.sent_last_hour} max={state.limits.global_per_hour} label="Автоответов за час" />
          <Meter value={state.sent_last_day} max={state.limits.global_per_day} label="Автоответов за сутки" />
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {guards.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2 text-[12.5px] leading-snug text-muted-foreground">
              <Icon className="mt-px size-3.5 shrink-0 text-success" /> {text}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function RuleRow({ rule, onEdit }: { rule: Rule; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const [toggling, setToggling] = useState(false)

  async function toggle(enabled: boolean) {
    setToggling(true)
    try {
      await api.toggleRule(rule.id, enabled)
      await queryClient.invalidateQueries({ queryKey: keys.rules })
    } catch (error) {
      notify.error(error)
    } finally {
      setToggling(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium">{rule.name}</span>
          {rule.dry_run ? (
            <Tooltip content="Ничего не отправляет, только пишет в журнал, что ответило бы">
              <Badge tone="primary" tabIndex={0}>
                <FlaskConical /> Тестовый режим
              </Badge>
            </Tooltip>
          ) : (
            <Badge tone="success">Отправляет ответы</Badge>
          )}
          {rule.reply_mode === 'ai' && (
            <Badge tone="primary">
              <Sparkles /> ИИ
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{describeRule(rule)}</p>
        <p className="mt-1 line-clamp-1 text-[12.5px] text-subtle-foreground">
          {rule.reply_mode === 'ai'
            ? rule.ai_instructions || 'Ответ составляет ИИ по базе знаний'
            : `«${rule.reply_text}»`}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Switch checked={rule.enabled} onCheckedChange={toggle} disabled={toggling} aria-label={`Правило «${rule.name}» активно`} />
        <Button variant="ghost" size="icon-sm" className="ml-2" onClick={onEdit} aria-label={`Изменить правило «${rule.name}»`}>
          <Pencil />
        </Button>
        <ConfirmDialog
          title="Удалить правило?"
          description={`Правило «${rule.name}» будет удалено. Записи в журнале останутся.`}
          confirmLabel="Удалить"
          destructive
          onConfirm={async () => {
            try {
              await api.deleteRule(rule.id)
              await queryClient.invalidateQueries({ queryKey: keys.rules })
              notify.success('Правило удалено')
            } catch (error) {
              notify.error(error)
              throw error
            }
          }}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={`Удалить правило «${rule.name}»`}>
              <Trash2 />
            </Button>
          }
        />
      </div>
    </li>
  )
}

export default function Automation() {
  const connected = useConnected()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Rule | null>(null)
  const [editorOpen, setEditorOpen] = useState(() => params.get('new') === '1')
  const state = useQuery({ queryKey: keys.automation, queryFn: api.automation, enabled: connected })
  const rules = useQuery({ queryKey: keys.rules, queryFn: api.rules, enabled: connected })
  const recent = useQuery({
    queryKey: keys.activity({ source: 'automation', limit: 8 }),
    queryFn: () => api.activity({ source: 'automation', limit: 8, offset: 0 }),
    enabled: connected,
  })

  useEffect(() => {
    if (params.get('new') === '1') {
      setParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('new')
        return next
      }, { replace: true })
    }
  }, [params, setParams])

  if (!connected) return <NotConnected />

  function openEditor(rule: Rule | null) {
    setEditing(rule)
    setEditorOpen(true)
  }

  return (
    <Page>
      <PageHeader
        title="Автоматизация"
        description="Автоответы по правилам, которые вы задаёте сами. По умолчанию всё выключено, новые правила работают в тестовом режиме."
        actions={
          <Button onClick={() => openEditor(null)}>
            <Plus /> Новое правило
          </Button>
        }
      />

      {state.data ? <KillSwitch state={state.data} /> : state.isError ? <ErrorState error={state.error} onRetry={() => state.refetch()} /> : <Skeleton className="h-52 rounded-xl" />}

      <AiAssistantCard />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Правила" description="Срабатывает первое подходящее правило — не больше одного ответа на сообщение." />
          {rules.isPending ? (
            <div className="space-y-3 px-5 pb-5">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : rules.isError ? (
            <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
          ) : rules.data.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title="Правил пока нет"
              description="Например, автоответ «Я в отпуске до понедельника» для личных чатов."
              action={
                <Button variant="outline" onClick={() => openEditor(null)}>
                  <Plus /> Создать первое правило
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {rules.data.map((rule) => (
                <RuleRow key={rule.id} rule={rule} onEdit={() => openEditor(rule)} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="История срабатываний"
            action={
              <Button asChild variant="ghost" size="sm">
                <Link to="/activity?source=automation">Все</Link>
              </Button>
            }
          />
          {recent.data?.items.length ? (
            <ul className="divide-y divide-border px-2 pb-2">
              {recent.data.items.map((record) => (
                <ActivityRow key={record.id} record={record} compact />
              ))}
            </ul>
          ) : recent.isPending ? (
            <div className="space-y-2 px-5 pb-5">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (
            <EmptyState icon={ShieldCheck} title="Срабатываний не было" description="Здесь появятся отправленные, тестовые и пропущенные автоответы." className="py-8" />
          )}
        </Card>
      </div>

      <RuleEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        rule={editing}
        onSaved={() => {
          setEditorOpen(false)
          void queryClient.invalidateQueries({ queryKey: keys.rules })
        }}
      />
    </Page>
  )
}
