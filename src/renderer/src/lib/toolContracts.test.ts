import { describe, expect, test } from 'bun:test'
import { MCP_TOOLS, assistantToolsForIntent } from './mcpTools'

describe('model-facing tool contracts', () => {
  test('every tool has one explicit content domain, access mode, and timebase', () => {
    expect(new Set(MCP_TOOLS.map((tool) => tool.name)).size).toBe(MCP_TOOLS.length)
    for (const tool of MCP_TOOLS) {
      expect(tool.contract.domain).toBeTruthy()
      expect(['read', 'write']).toContain(tool.contract.access)
      expect(['none', 'source', 'program', 'mixed']).toContain(tool.contract.timebase)
      expect(typeof tool.contract.assistant).toBe('boolean')
      const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
      for (const required of schema.required ?? []) expect(schema.properties).toHaveProperty(required)
    }
  })

  test('generic command escape hatches and duplicate aliases stay out of Assistant', () => {
    const names = assistantToolsForIntent('make this better').map((tool) => tool.name)
    expect(names).not.toContain('apply_command')
    expect(names).not.toContain('edit_with_intent')
    expect(names).not.toContain('set_scenes')
    expect(names).not.toContain('cut_range')
    expect(names).not.toContain('ripple_delete')
    expect(names).not.toContain('apply_safe_suggestions')
  })

  test('scene organization cannot see visible-graphics tools', () => {
    const tools = assistantToolsForIntent('split my caption into mini scenes')
    const writeDomains = new Set(
      tools.filter((tool) => tool.contract.access === 'write').map((tool) => tool.contract.domain)
    )
    expect([...writeDomains]).toEqual(['scene_structure'])
    expect(tools.map((tool) => tool.name)).toContain('split_scene')
    expect(tools.map((tool) => tool.name)).not.toContain('add_title')
    expect(tools.map((tool) => tool.name)).not.toContain('add_caption')
    expect(tools.map((tool) => tool.name)).not.toContain('add_lower_thirds')
  })

  test('visible title requests cannot see scene-structure mutation tools', () => {
    const tools = assistantToolsForIntent('add a visible title card to every scene')
    const writeDomains = new Set(
      tools.filter((tool) => tool.contract.access === 'write').map((tool) => tool.contract.domain)
    )
    expect([...writeDomains]).toEqual(['visible_graphics'])
    expect(tools.map((tool) => tool.name)).toContain('add_title')
    expect(tools.map((tool) => tool.name)).not.toContain('split_scene')
    expect(tools.map((tool) => tool.name)).not.toContain('rename_scene')
  })

  test('tool descriptions make structural and visible content boundaries explicit', () => {
    const split = MCP_TOOLS.find((tool) => tool.name === 'split_scene')!
    const title = MCP_TOOLS.find((tool) => tool.name === 'add_title')!
    const caption = MCP_TOOLS.find((tool) => tool.name === 'add_caption')!
    expect(split.description).toContain('SCENE STRUCTURE ONLY')
    expect(split.description).toContain('Never creates on-screen')
    expect(title.description).toContain('visible ON-SCREEN')
    expect(caption.description).toContain('visible ON-SCREEN')
  })
})
