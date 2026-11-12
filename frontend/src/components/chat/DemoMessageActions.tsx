import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/form'
import { Tooltip } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { notify } from '@/lib/notify'
import type { Message } from '@/lib/types'

const KEYS = ['messages', 'dialogs', 'archive']

/** Demo only: lets you play the other person who edits or deletes a message, to see the archive at work. */
export function DemoMessageActions({ message }: { message: Message }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(message.text)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      await Promise.all(KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
      notify.success(success)
      setEditing(false)
    } catch (error) {
      notify.error(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-1 flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      <Tooltip content="Демо: собеседник изменил сообщение">
        <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setEditing(true)} aria-label="Демо: собеседник изменил сообщение">
          <Pencil className="size-3.5" />
        </Button>
      </Tooltip>
      <Tooltip content="Демо: собеседник удалил сообщение у всех">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          disabled={busy}
          onClick={() => run(() => api.demoDelete(message.chat_id, message.id), 'Собеседник удалил сообщение — копия осталась в архиве')}
          aria-label="Демо: собеседник удалил сообщение"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </Tooltip>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title="Собеседник изменил сообщение (демо)"
        description="Архив сохранит прежний текст в истории изменений."
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Отмена
            </Button>
            <Button loading={busy} disabled={!text.trim()} onClick={() => run(() => api.demoEdit(message.chat_id, message.id, text), 'Сообщение изменено')}>
              Изменить
            </Button>
          </>
        }
      >
        <Field label="Новый текст">{(props) => <Textarea {...props} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      </Dialog>
    </div>
  )
}
