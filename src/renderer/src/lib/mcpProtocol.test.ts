import { describe, expect, test } from 'bun:test'
import { createMcpHandler, MCP_PROTOCOL_VERSION } from '../../../mcp/protocol'
import { createDemoProject } from './demo'
import { DEFAULT_SETTINGS } from './settings'

function fixture() {
  let project = createDemoProject()
  let saves = 0
  const handle = createMcpHandler({
    loadProject: () => project,
    saveProject: (next) => { project = next; saves += 1 },
    loadSettings: () => ({
      ...DEFAULT_SETTINGS,
      intelligence: { kind: 'openai-compatible', baseUrl: 'http://localhost/v1', model: 'test', apiKey: 'secret' }
    }),
    projectPath: () => '/tmp/current.speechedit.json'
  })
  return { handle, project: () => project, saves: () => saves }
}

describe('SpeechEdit MCP protocol', () => {
  test('negotiates the current protocol and advertises tools, resources, prompts, and completions', async () => {
    const { handle } = fixture()
    const response = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION } })
    const result = response?.result as { protocolVersion: string; capabilities: Record<string, unknown>; instructions: string }
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(Object.keys(result.capabilities).sort()).toEqual(['completions', 'prompts', 'resources', 'tools'])
    expect(result.instructions).toContain('reversible')
  })

  test('resources are exact, status redacts keys, and unknown URIs fail', async () => {
    const { handle } = fixture()
    const status = await handle({ id: 2, method: 'resources/read', params: { uri: 'speechedit://status' } })
    const text = ((status?.result as { contents: { text: string }[] }).contents[0]?.text) ?? ''
    expect(text).toContain('[configured]')
    expect(text).not.toContain('"secret"')
    expect(text).toContain('/tmp/current.speechedit.json')

    const missing = await handle({ id: 3, method: 'resources/read', params: { uri: 'speechedit://nope' } })
    expect(missing?.error?.code).toBe(-32602)
  })

  test('read tools do not rewrite the project; serialized writes retain both changes', async () => {
    const state = fixture()
    const read = await state.handle({ id: 4, method: 'tools/call', params: { name: 'get_context', arguments: {} } })
    expect((read?.result as { structuredContent: { message: string } }).structuredContent.message).toContain('Reel:')
    expect(state.saves()).toBe(0)

    await Promise.all([
      state.handle({ id: 5, method: 'tools/call', params: { name: 'delete_range', arguments: { start: 1, end: 2 } } }),
      state.handle({ id: 6, method: 'tools/call', params: { name: 'delete_range', arguments: { start: 40.2, end: 40.7 } } })
    ])
    expect(state.saves()).toBe(2)
    expect(state.project().cuts.some((cut) => cut.start <= 1 && cut.end >= 2)).toBe(true)
    expect(state.project().cuts.some((cut) => cut.start <= 40.2 && cut.end >= 40.7)).toBe(true)
  })

  test('prompts include live context and argument completion is useful', async () => {
    const { handle } = fixture()
    const prompt = await handle({ id: 7, method: 'prompts/get', params: { name: 'edit_reel', arguments: { intent: 'Cut the false start' } } })
    const text = (((prompt?.result as { messages: { content: { text: string } }[] }).messages[0]?.content.text) ?? '')
    expect(text).toContain('Cut the false start')
    expect(text).toContain('Transcript')

    const completion = await handle({ id: 8, method: 'completion/complete', params: { argument: { name: 'focus', value: 'ret' } } })
    expect((completion?.result as { completion: { values: string[] } }).completion.values).toEqual(['retakes'])
  })

  test('unknown tools return a tool error result instead of breaking JSON-RPC', async () => {
    const { handle } = fixture()
    const response = await handle({ id: 9, method: 'tools/call', params: { name: 'explode_project', arguments: {} } })
    expect((response?.result as { isError: boolean }).isError).toBe(true)
    expect(response?.error).toBeUndefined()
  })

  test('a running desktop bridge handles tools against live state instead of the disk snapshot', async () => {
    let saved = false
    const handle = createMcpHandler({
      loadProject: () => createDemoProject(),
      saveProject: () => { saved = true },
      loadSettings: () => DEFAULT_SETTINGS,
      projectPath: () => '/tmp/stale.json',
      callLiveTool: async (name) => ({ message: `Live ${name}`, data: { live: true } })
    })
    const response = await handle({ id: 10, method: 'tools/call', params: { name: 'delete_range', arguments: { start: 1, end: 2 } } })
    const result = response?.result as { structuredContent: { message: string; data: { live: boolean } } }
    expect(result.structuredContent.message).toBe('Live delete_range')
    expect(result.structuredContent.data.live).toBe(true)
    expect(saved).toBe(false)
  })
})
