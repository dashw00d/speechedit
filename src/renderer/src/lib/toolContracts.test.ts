import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { MCP_TOOLS, assistantToolsForIntent, runTool } from './mcpTools'

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

  test('media, picture, and audio requests receive separate write surfaces', () => {
    const writeDomains = (intent: string) => [...new Set(
      assistantToolsForIntent(intent)
        .filter((tool) => tool.contract.access === 'write')
        .map((tool) => tool.contract.domain)
    )]
    expect(writeDomains('add B-roll using the imported still')).toEqual(['media_layers'])
    expect(writeDomains('add a zoom and crop the picture')).toEqual(['picture_effects'])
    expect(writeDomains('make the voice quieter')).toEqual(['audio_mix'])
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

  test('every Assistant-exposed write tool has a real handler', async () => {
    for (const tool of MCP_TOOLS.filter((candidate) => candidate.contract.assistant && candidate.contract.access === 'write')) {
      const result = await runTool(createDemoProject(), tool.name, {})
      expect(result.message.startsWith('Unknown tool')).toBe(false)
    }
  })

  test('media, picture, graphic, and audio tools mutate only their intended surfaces', async () => {
    const demo = createDemoProject()
    const image = {
      id: 'asset_still',
      path: '/tmp/still.png',
      name: 'still.png',
      kind: 'image' as const,
      duration: 10,
      waveform: []
    }
    const withImage = { ...demo, assets: { ...demo.assets, [image.id]: image } }
    const broll = await runTool(withImage, 'add_broll_clip', { assetId: image.id, start: 2, duration: 3 })
    expect(broll.project.scenes).toEqual(demo.scenes)
    expect(broll.project.tracks.flatMap((track) => track.clips).some((clip) => clip.assetId === image.id)).toBe(true)

    const title = await runTool(demo, 'add_title', { start: 0, duration: 2, text: 'Visible hook' })
    const titleClip = title.project.tracks.flatMap((track) => track.clips).find((clip) => clip.text === 'Visible hook')!
    const renamed = await runTool(title.project, 'set_graphic_text', { clipId: titleClip.id, text: 'Better hook' })
    expect(renamed.project.transcript).toEqual(demo.transcript)
    expect(renamed.project.tracks.flatMap((track) => track.clips).some((clip) => clip.text === 'Better hook')).toBe(true)

    const picture = await runTool(demo, 'set_project_picture_transform', { transform: { scale: 1.5, opacity: 0.8 } })
    expect(picture.project.picture.scale).toBe(1.5)
    expect(picture.project.scenes).toEqual(demo.scenes)

    const audio = await runTool(demo, 'set_audio_master', { patch: { normalize: true, volume: 0.8 } })
    expect(audio.project.audioMaster.normalize).toBe(true)
    expect(audio.project.audioMaster.volume).toBe(0.8)
    expect(audio.project.transcript).toEqual(demo.transcript)
  })
})
