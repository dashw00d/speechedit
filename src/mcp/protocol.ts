import { MCP_TOOLS, runTool } from '../renderer/src/lib/mcpTools'
import { renderAgentBrief } from '../renderer/src/lib/agentContext'
import type { AppSettings } from '../renderer/src/lib/settings'
import type { Project } from '../renderer/src/types'
import type { IntelligenceComplete } from '../renderer/src/lib/intelligence'

export const MCP_PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_VERSIONS = new Set([MCP_PROTOCOL_VERSION, '2025-03-26', '2024-11-05'])

export interface McpDependencies {
  loadProject: () => Project
  saveProject: (project: Project) => void
  loadSettings: () => AppSettings
  projectPath: () => string
  callLiveTool?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ message: string; data?: unknown; isError?: boolean } | null>
  complete?: IntelligenceComplete
}

export interface JsonRpcRequest {
  jsonrpc?: string
  id?: unknown
  method?: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const RESOURCES = [
  { uri: 'speechedit://context', name: 'editorial_context', title: 'Editorial context', description: 'Compact transcript, cuts, scenes, protected ranges, suggestions, selection, and timing.', mimeType: 'text/plain' },
  { uri: 'speechedit://project', name: 'project', title: 'Project JSON', description: 'The normalized current SpeechEdit project.', mimeType: 'application/json' },
  { uri: 'speechedit://status', name: 'status', title: 'Project status', description: 'Current project path, counts, and configured intelligence provider without secrets.', mimeType: 'application/json' },
  { uri: 'speechedit://tools', name: 'tool_catalog', title: 'Editing tool catalog', description: 'All SpeechEdit MCP tools and their input schemas.', mimeType: 'application/json' }
]

const PROMPTS = [
  { name: 'edit_reel', title: 'Edit this reel', description: 'Plan and execute a reversible transcript-first edit using SpeechEdit tools.', arguments: [{ name: 'intent', description: 'What should change in the reel?', required: true }] },
  { name: 'review_reel', title: 'Review this reel', description: 'Inspect the current cut and recommend the most valuable next edits without changing it.', arguments: [{ name: 'focus', description: 'Optional review focus, such as pacing or retakes.', required: false }] },
  { name: 'find_retakes', title: 'Find scenes and retakes', description: 'Group the transcript into scenes and identify repeated or superseded takes.', arguments: [] }
]

function toolCatalog() {
  return MCP_TOOLS.map((tool) => {
    const readOnly = tool.contract.access === 'read'
    return {
      ...tool,
      title: tool.name.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
      outputSchema: { type: 'object', properties: { message: { type: 'string' }, data: {} }, required: ['message'] },
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly && /^(delete_|cut_|ripple_|remove_)/.test(tool.name),
        idempotentHint: readOnly,
        openWorldHint: false
      }
    }
  })
}

function safeSettings(settings: AppSettings) {
  return {
    transcript: { ...settings.transcript, apiKey: settings.transcript.apiKey ? '[configured]' : '' },
    intelligence: { ...settings.intelligence, apiKey: settings.intelligence.apiKey ? '[configured]' : '' }
  }
}

function ok(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function error(id: unknown, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function promptMessages(name: string, args: Record<string, unknown>, project: Project) {
  const context = renderAgentBrief(project)
  if (name === 'edit_reel') {
    const intent = String(args.intent ?? '').trim()
    if (!intent) throw new Error('edit_reel requires an intent.')
    return [{ role: 'user', content: { type: 'text', text: `Use SpeechEdit tools to make this edit through normal reversible commands. Honor keep/demo guards.\n\nIntent: ${intent}\n\n${context}` } }]
  }
  if (name === 'review_reel') {
    const focus = String(args.focus ?? '').trim()
    return [{ role: 'user', content: { type: 'text', text: `Review this reel without changing it. Recommend the three highest-value next edits${focus ? `, focusing on ${focus}` : ''}.\n\n${context}` } }]
  }
  if (name === 'find_retakes') {
    return [{ role: 'user', content: { type: 'text', text: `Use run_intelligence to group scenes and identify retakes. Do not apply cuts.\n\n${context}` } }]
  }
  throw new Error(`Unknown prompt ${name}.`)
}

export function createMcpHandler(deps: McpDependencies) {
  let toolTail: Promise<unknown> = Promise.resolve()
  const serializeTool = <T>(run: () => Promise<T>): Promise<T> => {
    const next = toolTail.then(run, run)
    toolTail = next.then(() => undefined, () => undefined)
    return next
  }

  return async function handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id
    const method = request.method ?? ''
    if (request.jsonrpc && request.jsonrpc !== '2.0') return error(id ?? null, -32600, 'Invalid JSON-RPC version.')
    if (!method) return error(id ?? null, -32600, 'Missing method.')
    try {
      switch (method) {
        case 'initialize': {
          const requested = String(request.params?.protocolVersion ?? '')
          const protocolVersion = SUPPORTED_VERSIONS.has(requested) ? requested : MCP_PROTOCOL_VERSION
          return ok(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false }, completions: {} },
            serverInfo: { name: 'speechedit', title: 'SpeechEdit', version: '0.1.0' },
            instructions: 'Read speechedit://context before editing. Every tool declares a content domain and timebase. Keep scene_structure, transcript_content, visible_graphics, timeline_edit, and audio_mix separate; never substitute a tool from another content domain. Resolve exact ids, phrases, and natural sentence boundaries with read tools before writing. All writes are reversible SpeechEdit commands. Honor keep and demo tags unless the user explicitly overrides them.'
          })
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
        case 'initialized':
          return null
        case 'ping':
          return ok(id, {})
        case 'tools/list':
          return ok(id, { tools: toolCatalog() })
        case 'resources/list':
          return ok(id, { resources: RESOURCES })
        case 'resources/templates/list':
          return ok(id, { resourceTemplates: [] })
        case 'resources/read': {
          const uri = String(request.params?.uri ?? '')
          const resource = RESOURCES.find((item) => item.uri === uri)
          if (!resource) return error(id, -32602, `Unknown resource URI: ${uri}`)
          const project = deps.loadProject()
          let text = ''
          if (uri === 'speechedit://context') text = renderAgentBrief(project)
          else if (uri === 'speechedit://project') text = JSON.stringify(project, null, 2)
          else if (uri === 'speechedit://tools') text = JSON.stringify(toolCatalog(), null, 2)
          else {
            text = JSON.stringify({
              path: deps.projectPath(),
              project: { id: project.id, name: project.name, sourceDuration: project.sourceDuration, words: project.transcript.words.length, cuts: project.cuts.length, scenes: (project.scenes ?? []).length, suggestions: project.suggestions.length },
              settings: safeSettings(deps.loadSettings())
            }, null, 2)
          }
          return ok(id, { contents: [{ uri, name: resource.name, title: resource.title, mimeType: resource.mimeType, text }] })
        }
        case 'prompts/list':
          return ok(id, { prompts: PROMPTS })
        case 'prompts/get': {
          const name = String(request.params?.name ?? '')
          const prompt = PROMPTS.find((item) => item.name === name)
          if (!prompt) return error(id, -32602, `Unknown prompt: ${name}`)
          const args = (request.params?.arguments ?? {}) as Record<string, unknown>
          return ok(id, { description: prompt.description, messages: promptMessages(name, args, deps.loadProject()) })
        }
        case 'completion/complete': {
          const argument = (request.params?.argument ?? {}) as { name?: string; value?: string }
          const values = argument.name === 'intent'
            ? ['Tighten the pacing', 'Find scenes and retakes', 'Remove filler words', 'Review without cutting']
            : argument.name === 'focus' ? ['pacing', 'retakes', 'clarity', 'silent activity'] : []
          const prefix = String(argument.value ?? '').toLowerCase()
          const filtered = values.filter((value) => value.toLowerCase().startsWith(prefix))
          return ok(id, { completion: { values: filtered, total: filtered.length, hasMore: false } })
        }
        case 'tools/call':
          return await serializeTool(async () => {
            const name = String(request.params?.name ?? '')
            const args = (request.params?.arguments ?? {}) as Record<string, unknown>
            if (!MCP_TOOLS.some((tool) => tool.name === name)) return ok(id, { content: [{ type: 'text', text: `Unknown SpeechEdit tool: ${name}` }], isError: true })
            try {
              const live = await deps.callLiveTool?.(name, args)
              if (live) {
                const structuredContent = { message: live.message, data: live.data ?? null }
                return ok(id, {
                  content: [{ type: 'text', text: live.isError ? live.message : JSON.stringify(structuredContent, null, 2) }],
                  ...(live.isError ? { isError: true } : { structuredContent })
                })
              }
              const project = deps.loadProject()
              const result = await runTool(
                project,
                name,
                args,
                deps.loadSettings().intelligence,
                undefined,
                deps.complete
              )
              if (result.project !== project) deps.saveProject(result.project)
              const structuredContent = { message: result.message, data: result.data ?? null }
              return ok(id, { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent })
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              return ok(id, { content: [{ type: 'text', text: message }], isError: true })
            }
          })
        default:
          return id === undefined ? null : error(id, -32601, `Method not found: ${method}`)
      }
    } catch (err) {
      return error(id ?? null, -32603, err instanceof Error ? err.message : String(err))
    }
  }
}
