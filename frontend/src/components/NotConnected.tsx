import { LoaderCircle, PlugZap, WifiOff } from 'lucide-react'
import { Link } from 'react-router'
import { useStatus } from '@/lib/queries'
import { EmptyState, ErrorState } from './common'
import { Page } from './layout/AppShell'
import { Button } from './ui/button'

export function useConnected(): boolean {
  const { data } = useStatus()
  return data?.connection.state === 'connected'
}

/** Shown by Telegram-backed pages until an account is connected (real mode). */
export function NotConnected() {
  const status = useStatus()
  if (status.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground" aria-busy>
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    )
  }
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} className="h-full" />
  const state = status.data.connection.state
  return (
    <Page>
      <EmptyState
        icon={state === 'disconnected' ? WifiOff : PlugZap}
        title={state === 'disconnected' ? 'Нет соединения с Telegram' : 'Telegram не подключён'}
        description={
          state === 'disconnected'
            ? status.data.connection.error ?? 'Проверьте интернет и переподключитесь в разделе «Аккаунт».'
            : state === 'connecting'
              ? 'Подключаемся к Telegram…'
              : 'Чтобы видеть чаты и отправлять сообщения, подключите аккаунт. Это займёт пару минут.'
        }
        action={
          <Button asChild>
            <Link to="/account">{state === 'disconnected' ? 'Открыть «Аккаунт»' : 'Подключить Telegram'}</Link>
          </Button>
        }
        className="py-24"
      />
    </Page>
  )
}
