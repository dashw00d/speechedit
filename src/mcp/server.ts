#!/usr/bin/env bun
/// <reference types="node" />
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createDemoProject } from '../renderer/src/lib/demo'
import { parseProjectDocument, serializeDocument } from '../renderer/src/lib/projectDocument'
import { settingsFromEnv, type AppSettings } from '../renderer/src/lib/settings'
import type { Project } from '../renderer/src/types'
import { createMcpHandler, type JsonRpcRequest, type JsonRpcResponse } from './protocol'
import { completeCliModel, isCliModelKind } from '../main/modelCli'
import { completeOpenAI, type ChatMessage } from '../renderer/src/lib/providers'
import type { ModelEndpoint } from '../renderer/src/lib/settings'

function speechEditDir(): string {
  if (process.env.SPEECHEDIT_HOME) return process.env.SPEECHEDIT_HOME
  if (process.env.WSL_DISTRO_NAME && process.env.USER) {
    const windows = join('/mnt/c/Users', process.env.USER, '.speechedit')
    if (existsSync(windows)) return windows
  }
  return join(homedir(), '.speechedit')
}

const defaultDir = speechEditDir()
const defaultProject = join(defaultDir, 'current.speechedit.json')

function projectPath(): string {
  const fromArg = process.argv.find((arg) => arg.startsWith('--project='))?.slice(10)
  return process.env.SPEECHEDIT_PROJECT || fromArg || defaultProject
}

function loadProject(): Project {
  const path = projectPath()
  if (existsSync(path)) {
    try {
      return parseProjectDocument(JSON.parse(readFileSync(path, 'utf8'))).project
    } catch {
      /* use the demo only when the document is unreadable */
    }
  }
  return createDemoProject()
}

function saveProject(project: Project): void {
  const path = projectPath()
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(serializeDocument(project), null, 2))
  renameSync(temp, path)
}

function loadSettings(): AppSettings {
  const file = join(defaultDir, 'settings.json')
  const env = settingsFromEnv()
  if (!existsSync(file)) return env
  try {
    const disk = JSON.parse(readFileSync(file, 'utf8')) as AppSettings
    return {
      transcript: { ...env.transcript, ...disk.transcript, apiKey: env.transcript.apiKey || disk.transcript.apiKey },
      intelligence: {
        ...env.intelligence,
        ...disk.intelligence,
        apiKey: env.intelligence.apiKey || disk.intelligence.apiKey
      }
    }
  } catch {
    return env
  }
}

const bridgeDir = join(defaultDir, 'mcp-bridge')

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function callLiveTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ message: string; data?: unknown; isError?: boolean } | null> {
  const heartbeat = join(bridgeDir, 'heartbeat.json')
  if (!existsSync(heartbeat)) return null
  try {
    const beat = JSON.parse(readFileSync(heartbeat, 'utf8')) as { at?: number }
    if (!beat.at || Date.now() - beat.at > 4_000) return null
  } catch {
    return null
  }

  mkdirSync(bridgeDir, { recursive: true })
  const id = randomUUID()
  const request = join(bridgeDir, `${id}.request.json`)
  const response = join(bridgeDir, `${id}.response.json`)
  writeFileSync(request, JSON.stringify({ id, name, args }))
  const deadline = Date.now() + 190_000
  while (Date.now() < deadline) {
    if (existsSync(response)) {
      const result = JSON.parse(readFileSync(response, 'utf8')) as { message: string; data?: unknown; isError?: boolean }
      rmSync(response, { force: true })
      return result
    }
    await delay(100)
  }
  rmSync(request, { force: true })
  rmSync(join(bridgeDir, `${id}.processing.json`), { force: true })
  throw new Error('SpeechEdit did not finish the live MCP request within 190 seconds.')
}

async function completeModel(endpoint: ModelEndpoint, messages: ChatMessage[]): Promise<string> {
  return isCliModelKind(endpoint.kind)
    ? completeCliModel(endpoint, messages)
    : completeOpenAI(endpoint, messages)
}

const handle = createMcpHandler({
  loadProject,
  saveProject,
  loadSettings,
  projectPath,
  callLiveTool,
  complete: completeModel
})
const inFlight = new Set<Promise<void>>()

function send(message: JsonRpcResponse): void {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

function parseAndHandle(body: string): void {
  let request: JsonRpcRequest
  try {
    request = JSON.parse(body) as JsonRpcRequest
  } catch (err) {
    send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error', data: err instanceof Error ? err.message : String(err) }
    })
    return
  }
  const task = handle(request).then((response) => {
    if (response) send(response)
  })
  inFlight.add(task)
  void task.finally(() => inFlight.delete(task))
}

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd >= 0) {
      const header = buffer.slice(0, headerEnd).toString('utf8')
      const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1])
      if (!Number.isFinite(length)) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }
      const start = headerEnd + 4
      if (buffer.length < start + length) break
      const body = buffer.slice(start, start + length).toString('utf8')
      buffer = buffer.slice(start + length)
      parseAndHandle(body)
      continue
    }
    const text = buffer.toString('utf8')
    const newline = text.indexOf('\n')
    if (newline < 0 || !text.trimStart().startsWith('{')) break
    const line = text.slice(0, newline).trim()
    buffer = Buffer.from(text.slice(newline + 1))
    if (line) parseAndHandle(line)
  }
})

process.stdin.on('end', () => {
  void Promise.allSettled([...inFlight]).then(() => process.exit(0))
})
