import type { SpeechHost } from '../renderer/src/host'

declare global {
  interface Window {
    speech?: SpeechHost
  }
}

export {}
