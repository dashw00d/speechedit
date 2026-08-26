import { describe, expect, test } from 'bun:test'
import { cliCommand, isCliModelKind, modelMessagesPrompt } from '../../../main/modelCli'

describe('account CLI model providers', () => {
  test('Codex uses supported headless exec and prompt stdin, not the obsolete -p spelling', () => {
    const spec = cliCommand({ kind: 'codex-cli', model: 'gpt-5.4' }, 'hello', 'linux', {})
    expect(spec.command).toBe('codex')
    expect(spec.args[0]).toBe('exec')
    expect(spec.args).toContain('read-only')
    expect(spec.args).toContain('--ephemeral')
    expect(spec.args).toContain('--ignore-user-config')
    expect(spec.args).not.toContain('-p')
    expect(spec.stdin).toBe('hello')
  })

  test('Grok uses -p single-turn and Windows falls back through WSL', () => {
    const spec = cliCommand({ kind: 'grok-cli' }, 'hello', 'win32', {})
    expect(spec.command).toBe('wsl.exe')
    expect(spec.args.slice(0, 5)).toEqual(['-e', 'sh', '-lc', 'exec grok "$@"', 'speechedit'])
    expect(spec.args[5]).toBe('-p')
    expect(spec.args[6]).toBe('hello')
    expect(spec.args).toContain('--no-subagents')
    expect(spec.args).toContain('--disable-web-search')
  })

  test('messages preserve roles and both providers are recognized', () => {
    expect(modelMessagesPrompt([
      { role: 'system', content: 'Only JSON' },
      { role: 'user', content: 'Say ok' }
    ])).toContain('SYSTEM:\nOnly JSON\n\nUSER:\nSay ok')
    expect(isCliModelKind('codex-cli')).toBe(true)
    expect(isCliModelKind('grok-cli')).toBe(true)
    expect(isCliModelKind('openai-compatible')).toBe(false)
  })
})
