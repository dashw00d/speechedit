#!/usr/bin/env bun
/// <reference types="node" />
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createDemoProject } from '../renderer/src/lib/demo'
import { MCP_TOOLS, runTool } from '../renderer/src/lib/mcpTools'
import { parseProjectDocument, serializeDocument } from '../renderer/src/lib/projectDocument'
import { settingsFromEnv, type AppSettings } from '../renderer/src/lib/settings'
import type { Project } from '../renderer/src/types'

const defaultDir = join(homedir(), '.speechedit')
const defaultProject = join(defaultDir, 'current.speechedit.json')

function projectPath(): string {
  const fromArg = process.argv.find((a) => a.startsWith('--project='))?.slice(10)
  return process.env.SPEECHEDIT_PROJECT || fromArg || defaultProject
}

function loadProject(): Project {
  const path = projectPath()
  if (existsSync(path)) {
    try {
      return parseProjectDocument(JSON.parse(readFileSync(path, 'utf8'))).project
    } catch {
      /* fall through */
    }
  }
  return createDemoProject()
}

function saveProject(project: Project): void {
  const path = projectPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(serializeDocument(project), null, 2))
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

function send(message: unknown): void {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

function reply(id: unknown, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id: unknown, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code: -32000, message } })
}

async function handle(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }): Promise<void> {
  const id = msg.id
  switch (msg.method) {
    case 'initialize':
      reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'speechedit', version: '0.1.0' }
      })
      return
    case 'notifications/initialized':
    case 'initialized':
      return
    case 'ping':
      reply(id, {})
      return
    case 'tools/list':
      reply(id, { tools: MCP_TOOLS })
      return
    case 'resources/list':
      reply(id, {
        resources: [
          { uri: 'speechedit://context', name: 'Editorial context', mimeType: 'text/plain' },
          { uri: 'speechedit://project', name: 'Project JSON', mimeType: 'application/json' }
        ]
      })
      return
    case 'resources/read': {
      const uri = String(msg.params?.uri ?? '')
      const project = loadProject()
      if (uri === 'speechedit://project') {
        reply(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(project) }] })
        return
      }
      const { renderAgentBrief } = await import('../renderer/src/lib/agentContext')
      reply(id, { contents: [{ uri, mimeType: 'text/plain', text: renderAgentBrief(project) }] })
      return
    }
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      try {
        const settings = loadSettings()
        const result = await runTool(loadProject(), name, args, settings.intelligence)
        saveProject(result.project)
        reply(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ message: result.message, data: result.data ?? null }, null, 2)
            }
          ]
        })
      } catch (err) {
        fail(id, err instanceof Error ? err.message : String(err))
      }
      return
    }
    default:
      if (id !== undefined) fail(id, `Unknown method ${msg.method}`)
  }
}

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd >= 0) {
      const header = buffer.slice(0, headerEnd).toString('utf8')
      const len = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1])
      if (!Number.isFinite(len)) {
        buffer = buffer.slice(headerEnd + 4)
        continue
      }
      const start = headerEnd + 4
      if (buffer.length < start + len) break
      const body = buffer.slice(start, start + len).toString('utf8')
      buffer = buffer.slice(start + len)
      void handle(JSON.parse(body))
      continue
    }
    const text = buffer.toString('utf8')
    const nl = text.indexOf('\n')
    if (nl < 0 || !text.trimStart().startsWith('{')) break
    const line = text.slice(0, nl).trim()
    buffer = Buffer.from(text.slice(nl + 1))
    if (line) void handle(JSON.parse(line))
  }
})

process.stdin.on('end', () => process.exit(0))
