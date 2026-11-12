import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity as ActivityIcon, ChevronLeft, ChevronRight, SearchX, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ActivityRow } from '@/components/ActivityRow'
import { EmptyState, ErrorState, PageHeader } from '@/components/common'
import { SearchInput } from '@/components/chat/ChatWorkspace'
import { Page } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/form'
import { Card, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { notify } from '@/lib/notify'
import { keys } from '@/lib/queries'
import type { AuditSource, AuditStatus } from '@/lib/types'

const PAGE_SIZE = 50
const SOURCES: { value: AuditSource | ''; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'manual', label: 'Вручную' },
  { value: 'automation', label: 'Автоматизация' },
  { value: 'system', label: 'Система' },
]

export default function Activity() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const source = (SOURCES.find((s) => s.value === params.get('source'))?.value ?? '') as AuditSource | ''
  const [status, setStatus] = useState<AuditStatus | ''>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const q = useDeferredValue(search.trim())

  const filters = { source, status, q, limit: PAGE_SIZE, offset: page * PAGE_SIZE }
  const activity = useQuery({
    queryKey: keys.activity(filters),
    queryFn: () => api.activity(filters),
    placeholderData: keepPreviousData,
  })

  const total = activity.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = Boolean(source || status || q)

  function setSource(value: string) {
    setPage(0)
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('source', value)
      else next.delete('source')
      return next
    })
  }

  return (
    <Page>
      <PageHeader
        title="Журнал действий"
        description="Всё, что приложение сделало от вашего имени: отправленные сообщения, публикации, автоответы, ошибки и пропущенные действия."
        actions={
          <ConfirmDialog
            title="Очистить журнал?"
            description="Все записи будут удалены без возможности восстановления. Это не влияет на сообщения в Telegram."
            confirmLabel="Очистить"
            destructive
            onConfirm={async () => {
              try {
                const { removed } = await api.clearActivity()
                await queryClient.invalidateQueries({ queryKey: ['activity'] })
                setPage(0)
                notify.success('Журнал очищен', `Удалено записей: ${formatNumber(removed)}`)
              } catch (error) {
                notify.error(error)
                throw error
              }
            }}
            trigger={
              <Button variant="outline" disabled={!total}>
                <Trash2 /> Очистить
              </Button>
            }
          />
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <Tabs value={source} onValueChange={setSource}>
            <TabsList>
              {SOURCES.map((s) => (
                <TabsTrigger key={s.label} value={s.value}>
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <NativeSelect
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AuditStatus | '')
              setPage(0)
            }}
            className="h-8 lg:w-48"
            aria-label="Статус"
          >
            <option value="">Любой статус</option>
            <option value="success">Выполнено</option>
            <option value="failed">Ошибки</option>
            <option value="skipped">Пропущено</option>
            <option value="dry_run">Тестовый режим</option>
          </NativeSelect>
          <div className="lg:ml-auto lg:w-72">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value)
                setPage(0)
              }}
              placeholder="Поиск по журналу"
              label="Поиск по журналу"
            />
          </div>
        </div>

        {activity.isPending ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : activity.isError ? (
          <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
        ) : activity.data.items.length === 0 ? (
          filtered ? (
            <EmptyState icon={SearchX} title="Ничего не найдено" description="Попробуйте изменить фильтры." />
          ) : (
            <EmptyState icon={ActivityIcon} title="Журнал пуст" description="Здесь появятся действия приложения." />
          )
        ) : (
          <ul className={activity.isPlaceholderData ? 'divide-y divide-border px-2 opacity-60 transition-opacity' : 'divide-y divide-border px-2'}>
            {activity.data.items.map((record) => (
              <ActivityRow key={record.id} record={record} />
            ))}
          </ul>
        )}

        {total > PAGE_SIZE && (
          <nav className="flex items-center justify-between gap-3 border-t border-border px-4 py-3" aria-label="Страницы журнала">
            <span className="text-[12.5px] text-muted-foreground tabular">
              {formatNumber(page * PAGE_SIZE + 1)}–{formatNumber(Math.min(total, (page + 1) * PAGE_SIZE))} из {formatNumber(total)}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                <ChevronLeft /> Назад
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages}>
                Вперёд <ChevronRight />
              </Button>
            </div>
          </nav>
        )}
      </Card>
    </Page>
  )
}
