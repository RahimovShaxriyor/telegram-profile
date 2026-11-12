import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/common'
import { Page } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return (
    <Page>
      <EmptyState
        icon={Compass}
        title="Страница не найдена"
        description="Такого раздела нет. Вернитесь на главную или выберите раздел в меню."
        action={
          <Button asChild>
            <Link to="/">На главную</Link>
          </Button>
        }
        className="py-24"
      />
    </Page>
  )
}
