import { describe, expect, test } from 'bun:test'
import { DEFAULT_TRANSCRIPT_KIND } from '../../../shared/asr'
import {
  DEFAULT_SETTINGS,
  isLegacyFactoryTranscript,
  loadSettings,
  saveSettings,
  settingsFromEnv
} from './settings'
import { WEB_DEMO_INTELLIGENCE } from './settings'

const KEY = 'speechedit:settings'

function withMemoryStorage<T>(fn: () => T): T {
  const store = new Map<string, string>()
  const fake = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    }
  }
  const prev = (globalThis as { localStorage?: typeof fake }).localStorage
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake })
  try {
    return fn()
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: prev })
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
}

describe('transcript defaults', () => {
  test('factory default is local whisper.cpp, not PATH whisper-cli', () => {
    expect(DEFAULT_SETTINGS.transcript.kind).toBe(DEFAULT_TRANSCRIPT_KIND)
    expect(DEFAULT_SETTINGS.transcript.kind).toBe('whisper-cpp')
    expect(DEFAULT_SETTINGS.transcript.model).toBe('')
    expect(isLegacyFactoryTranscript({ kind: 'whisper-cli', model: 'whisper-1' })).toBe(true)
    expect(isLegacyFactoryTranscript({ kind: 'whisper-cli', model: 'base' })).toBe(false)
    expect(isLegacyFactoryTranscript({ kind: 'openai-compatible', model: 'whisper-1' })).toBe(false)
  })

  test('loadSettings with no storage returns whisper.cpp', () => {
    withMemoryStorage(() => {
      expect(loadSettings().transcript.kind).toBe('whisper-cpp')
    })
  })

  test('legacy factory whisper-cli + whisper-1 migrates to whisper.cpp', () => {
    withMemoryStorage(() => {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          transcript: {
            kind: 'whisper-cli',
            baseUrl: 'http://127.0.0.1:8000/v1',
            model: 'whisper-1',
            apiKey: ''
          },
          intelligence: { kind: 'off', baseUrl: '', model: '', apiKey: '' }
        })
      )
      const loaded = loadSettings()
      expect(loaded.transcript.kind).toBe('whisper-cpp')
      expect(loaded.transcript.model).toBe('')
      expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').transcript.kind).toBe('whisper-cpp')
    })
  })

  test('an explicit Whisper CLI + base choice is kept', () => {
    withMemoryStorage(() => {
      const kept = saveSettings({
        ...DEFAULT_SETTINGS,
        transcript: { kind: 'whisper-cli', baseUrl: '', model: 'base', apiKey: '' }
      })
      expect(kept.transcript.kind).toBe('whisper-cli')
      expect(loadSettings().transcript.kind).toBe('whisper-cli')
      expect(loadSettings().transcript.model).toBe('base')
    })
  })

  test('settingsFromEnv without overrides uses whisper.cpp', () => {
    const prevKind = process.env.SPEECHEDIT_TRANSCRIBE_KIND
    const prevUrl = process.env.SPEECHEDIT_TRANSCRIBE_BASE_URL
    delete process.env.SPEECHEDIT_TRANSCRIBE_KIND
    delete process.env.SPEECHEDIT_TRANSCRIBE_BASE_URL
    try {
      expect(settingsFromEnv().transcript.kind).toBe('whisper-cpp')
    } finally {
      if (prevKind === undefined) delete process.env.SPEECHEDIT_TRANSCRIBE_KIND
      else process.env.SPEECHEDIT_TRANSCRIBE_KIND = prevKind
      if (prevUrl === undefined) delete process.env.SPEECHEDIT_TRANSCRIBE_BASE_URL
      else process.env.SPEECHEDIT_TRANSCRIBE_BASE_URL = prevUrl
    }
  })

  test('CLI intelligence providers survive settings normalization', () => {
    withMemoryStorage(() => {
      const codex = saveSettings({
        ...DEFAULT_SETTINGS,
        intelligence: { kind: 'codex-cli', baseUrl: '', model: '', apiKey: '' }
      })
      expect(codex.intelligence.kind).toBe('codex-cli')
      expect(loadSettings().intelligence.kind).toBe('codex-cli')

      const grok = saveSettings({
        ...DEFAULT_SETTINGS,
        intelligence: { kind: 'grok-cli', baseUrl: '', model: 'grok-4', apiKey: '' }
      })
      expect(grok.intelligence.kind).toBe('grok-cli')
      expect(loadSettings().intelligence.model).toBe('grok-4')
    })
  })

  test('web demo ignores saved provider, model, and key overrides', () => {
    withMemoryStorage(() => {
      const previous = (globalThis as { window?: unknown }).window
      Object.defineProperty(globalThis, 'window', { configurable: true, value: { speech: undefined } })
      try {
        localStorage.setItem(KEY, JSON.stringify({
          transcript: DEFAULT_SETTINGS.transcript,
          intelligence: {
            kind: 'openai-compatible',
            baseUrl: 'https://attacker.invalid/v1',
            model: 'paid/model',
            apiKey: 'browser-secret'
          }
        }))
        expect(loadSettings().intelligence).toEqual(WEB_DEMO_INTELLIGENCE)
        expect(saveSettings({
          ...DEFAULT_SETTINGS,
          intelligence: {
            kind: 'openai-compatible',
            baseUrl: 'https://attacker.invalid/v1',
            model: 'paid/model',
            apiKey: 'browser-secret'
          }
        }).intelligence).toEqual(WEB_DEMO_INTELLIGENCE)
      } finally {
        if (previous === undefined) delete (globalThis as { window?: unknown }).window
        else Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
      }
    })
  })
})
