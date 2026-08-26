import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runChild } from './childJob'

export type CliModelKind = 'codex-cli' | 'grok-cli'

export interface CliModelOptions {
  kind?: string
  model?: string
}

export interface CliCommand {
  command: string
  args: string[]
  stdin?: string
  label: string
  transport: 'native' | 'wsl'
}

export function isCliModelKind(kind?: string): kind is CliModelKind {
  return kind === 'codex-cli' || kind === 'grok-cli'
}

export function modelMessagesPrompt(messages: { role: string; content: string }[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`)
    .join('\n\n')
    .concat('\n\nASSISTANT:\n')
}

function codexScript(env: NodeJS.ProcessEnv): string | null {
  if (!env.APPDATA) return null
  const path = join(env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  return existsSync(path) ? path : null
}

export function cliCommand(
  opts: CliModelOptions,
  prompt: string,
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): CliCommand {
  if (opts.kind === 'codex-cli') {
    const args = [
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--color',
      'never'
    ]
    if (opts.model) args.push('--model', opts.model)
    args.push('-')
    const script = platform === 'win32' ? codexScript(env) : null
    return script
      ? {
          command: 'node.exe',
          args: [script, ...args],
          stdin: prompt,
          label: 'Codex CLI',
          transport: 'native'
        }
      : { command: platform === 'win32' ? 'codex.exe' : 'codex', args, stdin: prompt, label: 'Codex CLI', transport: 'native' }
  }

  if (opts.kind !== 'grok-cli') throw new Error('Unknown CLI model provider.')
  const args = [
    '-p',
    prompt,
    '--output-format',
    'plain',
    '--no-subagents',
    '--disable-web-search',
    '--permission-mode',
    'dontAsk',
    '--tools',
    '',
    '--verbatim'
  ]
  if (opts.model) args.push('--model', opts.model)
  return platform === 'win32'
    ? {
        command: 'wsl.exe',
        args: ['-e', 'sh', '-lc', 'exec grok "$@"', 'speechedit', ...args],
        label: 'Grok CLI via WSL',
        transport: 'wsl'
      }
    : { command: 'grok', args, label: 'Grok CLI', transport: 'native' }
}

function cleanCliOutput(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim()
}

async function runBounded(spec: CliCommand, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await runChild(spec.command, spec.args, {
      signal: controller.signal,
      stdin: spec.stdin,
      combineStderr: false,
      missing: `${spec.label} is not installed or is not available to SpeechEdit.`,
      fail: (code, stderr) => new Error(`${spec.label} exited ${code}: ${stderr.slice(-500)}`)
    })
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`${spec.label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function completeCliModel(
  opts: CliModelOptions,
  messages: { role: string; content: string }[]
): Promise<string> {
  if (!isCliModelKind(opts.kind)) throw new Error('CLI model provider is not configured.')
  const spec = cliCommand(opts, modelMessagesPrompt(messages))
  const output = cleanCliOutput(await runBounded(spec, 180_000))
  if (!output) throw new Error(`${spec.label} returned an empty reply.`)
  return output
}

export async function inspectCliModel(
  opts: CliModelOptions
): Promise<{ id: string; label: string; transport: 'native' | 'wsl'; version: string }> {
  if (!isCliModelKind(opts.kind)) throw new Error('CLI model provider is not configured.')
  const spec = cliCommand(opts, '')
  const command =
    opts.kind === 'codex-cli'
      ? cliCommand({ kind: 'codex-cli' }, '')
      : process.platform === 'win32'
        ? { ...spec, args: ['-e', 'sh', '-lc', 'exec grok "$@"', 'speechedit', '--version'] }
        : { ...spec, args: ['--version'] }
  if (opts.kind === 'codex-cli') {
    const execIndex = command.args.indexOf('exec')
    command.args.splice(execIndex, command.args.length - execIndex, '--version')
    command.stdin = undefined
  }
  const version = cleanCliOutput(await runBounded(command, 15_000)).split(/\r?\n/).at(-1) || 'ready'
  return {
    id: opts.model || 'CLI default',
    label: spec.label,
    transport: spec.transport,
    version
  }
}
