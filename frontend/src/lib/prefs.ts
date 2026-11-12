import { useSyncExternalStore } from 'react'

/** Per-browser UI preferences (not secrets, not shared with the backend). */
export interface Prefs {
  successToasts: boolean
  newMessageToasts: boolean
  enterToSend: boolean
}

const KEY = 'tpam.prefs'
const DEFAULTS: Prefs = { successToasts: true, newMessageToasts: true, enterToSend: true }
const listeners = new Set<() => void>()
let cache: Prefs | null = null

export function getPrefs(): Prefs {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache as Prefs
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  cache = { ...getPrefs(), [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* ignore: preference lasts until reload */
  }
  listeners.forEach((listener) => listener())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getPrefs,
    getPrefs,
  )
}
