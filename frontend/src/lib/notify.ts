import { toast } from 'sonner'
import { errorMessage } from './api'
import { getPrefs } from './prefs'

export const notify = {
  success(message: string, description?: string) {
    if (getPrefs().successToasts) toast.success(message, { description })
  },
  error(error: unknown, title?: string) {
    const message = errorMessage(error)
    if (title) toast.error(title, { description: message })
    else toast.error(message)
  },
  info(message: string, description?: string) {
    toast(message, { description })
  },
}
