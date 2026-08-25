export type LoseWorkChoice = 'save' | 'discard' | 'cancel'

export interface LoseWorkRequest {
  message: string
}

type Listener = (request: LoseWorkRequest | null) => void

let listener: Listener | null = null
let resolver: ((choice: LoseWorkChoice) => void) | null = null

export function onLoseWorkRequest(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

export function requestLoseWork(message: string): Promise<LoseWorkChoice> {
  if (!listener) {
    if (typeof window === 'undefined') return Promise.resolve('discard')
    return Promise.resolve(window.confirm(message) ? 'discard' : 'cancel')
  }
  if (resolver) resolver('cancel')
  return new Promise((resolve) => {
    resolver = resolve
    listener?.({ message })
  })
}

export function resolveLoseWork(choice: LoseWorkChoice): void {
  const done = resolver
  resolver = null
  listener?.(null)
  done?.(choice)
}
