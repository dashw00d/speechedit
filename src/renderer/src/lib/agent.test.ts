import { describe, expect, test } from 'bun:test'
import { programLength } from './commands'
import { createDemoProject } from './demo'
import { buildAgentContext, compactSnapshot } from './agentContext'
import { commandToTool, findProductFumble, planToolCalls, runAgent } from './agent'
import { COMMAND_BUS, MCP_TOOLS, runTool } from './mcpTools'
import { planIntent } from './intent'

describe('agent context pack', () => {
  test('snapshot is the same reel without waveforms', () => {
    const demo = createDemoProject()
    const snap = compactSnapshot(demo)
    expect(snap.id).toBe(demo.id)
    expect(snap.transcript.words).toHaveLength(demo.transcript.words.length)
    expect(snap.tags.some((t) => t.kind === 'demo')).toBe(true)
    expect(snap.assets[0]).not.toHaveProperty('waveform')
    expect((snap.assets[0] as { path?: string }).path).toBeDefined()
  })

  test('context includes speakers, I/O mapping, playhead, and selection', () => {
    const demo = createDemoProject()
    const um = demo.transcript.words.find((w) => w.text === 'um')!
    const ctx = buildAgentContext(demo, {
      selectedWordIds: [um.id],
      selectedClipId: null,
      selectedSuggestionId: demo.suggestions[0]?.id ?? null,
      programTime: 2
    })
    expect(ctx.speakers[0].name).toBe('Ryan')
    expect(ctx.words[0].speakerName).toBe('Ryan')
    expect(ctx.selection.words[0].text).toBe('um')
    expect(ctx.playhead.source).toBeGreaterThan(0)
    expect(ctx.cuts.length).toBe(demo.cuts.length)
    expect(ctx.tags.some((t) => t.label.includes('walkthrough'))).toBe(true)
  })
})

describe('agent tool loop', () => {
  test('fumble-the-product-name plans a deleteRange through the bus', async () => {
    const demo = createDemoProject()
    expect(findProductFumble(demo)?.text).toBe('Shotcut')
    const plan = planToolCalls(demo, 'remove the part where I fumble the product name')
    expect(plan.calls[0]?.name).toBe('delete_range')
    const turn = await runAgent(demo, 'remove the part where I fumble the product name')
    expect(turn.calls[0]?.name).toBe('delete_range')
    expect(turn.project.transcript.words.some((w) => w.text === 'Shotcut' && w.deleted)).toBe(true)
    expect(turn.project).not.toBe(demo)
  })

  test('auto-cut skip tagged demo uses apply_safe_edits and keeps the guard', async () => {
    const demo = createDemoProject()
    const plan = planIntent(demo, 'auto-cut this like Auto-Editor but skip the silent demo I tagged')
    expect(plan.commands.map((c) => c.type)).toEqual(['applySafeSuggestions'])
    const turn = await runAgent(demo, 'auto-cut this like Auto-Editor but skip the silent demo I tagged')
    expect(turn.calls.some((c) => c.name === 'apply_safe_edits')).toBe(true)
    expect(turn.project.tags.some((t) => t.kind === 'demo')).toBe(true)
    expect(turn.project.cuts.some((c) => c.start <= 24.4 && c.end >= 27.8)).toBe(false)
    expect(programLength(turn.project)).toBeLessThan(programLength(demo))
  })

  test('commandToTool maps the bus onto MCP names', () => {
    expect(commandToTool({ type: 'toggleWords', wordIds: ['w1'] }).name).toBe('toggle_words')
    expect(commandToTool({ type: 'applySafeSuggestions' }).name).toBe('apply_safe_edits')
    expect(commandToTool({ type: 'addCaption', start: 1, duration: 2, text: 'Hi' }).name).toBe('add_caption')
    expect(commandToTool({ type: 'keepTake', sceneId: 'sc1' }).name).toBe('keep_take')
    expect(commandToTool({ type: 'rebuildIntelligence' }).name).toBe('rebuild_intelligence')
    expect(commandToTool({ type: 'generateCaptions', maxWords: 5 }).name).toBe('generate_captions')
    expect(commandToTool({ type: 'addLowerThirds' }).name).toBe('add_lower_thirds')
  })
})

describe('MCP read/write tools', () => {
  test('get_snapshot, get_cuts, get_selection, get_mapping', async () => {
    const demo = createDemoProject()
    const um = demo.transcript.words.find((w) => w.text === 'um')!
    const snap = await runTool(demo, 'get_snapshot', {})
    expect((snap.data as { transcript: { words: unknown[] } }).transcript.words.length).toBe(
      demo.transcript.words.length
    )
    const cuts = await runTool(demo, 'get_cuts', {})
    expect(Array.isArray(cuts.data)).toBe(true)
    const sel = await runTool(
      demo,
      'get_selection',
      {},
      undefined,
      { selectedWordIds: [um.id], selectedClipId: null, selectedSuggestionId: null, programTime: 2 }
    )
    expect((sel.data as { words: { text: string }[] }).words[0].text).toBe('um')
    const map = await runTool(demo, 'get_mapping', { source: 16.2 })
    expect((map.data as { program: number }).program).toBeGreaterThanOrEqual(0)
  })

  test('write tools mutate only through applyCommand', async () => {
    const demo = createDemoProject()
    const cut = await runTool(demo, 'delete_range', { start: 40.2, end: 40.7 })
    expect(cut.project.transcript.words.some((w) => w.text === 'Shotcut' && w.deleted)).toBe(true)
    const words = demo.transcript.words.filter((w) => w.text === 'um')
    const toggled = await runTool(demo, 'toggle_words', { wordIds: words.map((w) => w.id) })
    expect(toggled.project.transcript.words.some((w) => w.text === 'um' && w.deleted)).toBe(true)
    const caption = await runTool(demo, 'add_caption', { start: 1, text: 'Title', duration: 2 })
    expect(caption.project.tracks.some((t) => t.clips.some((c) => c.text === 'Title'))).toBe(true)
    const split = await runTool(demo, 'split_at', { time: 18 })
    expect((split.project.splits ?? []).some((t) => Math.abs(t - 18) < 0.05)).toBe(true)
    const marked = await runTool(demo, 'set_marks', { markIn: 1, markOut: 3 })
    expect(marked.project.markIn).toBe(1)
    const listed = await runTool(demo, 'list_commands', {})
    const listedData = listed.data as { commands: string[]; scope: string }
    expect(listedData.commands).toEqual(COMMAND_BUS)
    expect(listedData.scope).toContain('subset')
    expect(COMMAND_BUS).toContain('deleteRange')
    expect(COMMAND_BUS).not.toContain('setTrackFlag')
    expect(MCP_TOOLS.some((t) => t.name === 'get_snapshot')).toBe(true)
    expect(MCP_TOOLS.some((t) => t.name === 'toggle_words')).toBe(true)
  })

  test('edit_with_intent uses runAgent so find-scenes infers instead of no-op', async () => {
    const demo = createDemoProject()
    const turn = await runTool(demo, 'edit_with_intent', {
      intent: 'Find scenes and mark retakes. Do not cut yet.'
    })
    expect((turn.data as { name: string }[]).some((c) => c.name === 'infer_scenes')).toBe(true)
    expect(turn.project.scenes.some((s) => s.kind === 'retake')).toBe(true)
    const auto = await runTool(demo, 'edit_with_intent', { intent: 'auto-cut the reel' })
    expect((auto.data as { name: string }[]).map((c) => c.name)).toEqual(['apply_safe_edits'])
    expect(auto.project.cuts.some((c) => c.source === 'repeat')).toBe(false)
  })
})
