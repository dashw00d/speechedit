import { describe, expect, test } from 'bun:test'
import { runAgent } from './agent'
import { applyCommand, programLength } from './commands'
import { createDemoProject } from './demo'
import { cuesFromTranscriptJson } from './diarize'
import {
  applyInterchange,
  projectToChapters,
  projectToFcpxml,
  projectToKdenlive,
  projectToMlt,
  projectToOtio,
  projectToPremiere,
  projectToSrt,
  projectToTranscriptMd,
  projectToVtt
} from './interchange'
import { planIntent } from './intent'
import { runTool } from './mcpTools'

describe('caption production QoL', () => {
  test('generateCaptions rides the command bus and keeps ~5 words', () => {
    const next = applyCommand(createDemoProject(), {
      type: 'generateCaptions',
      maxWords: 5,
      emphasize: true
    })
    const caps = next.tracks.find((t) => t.type === 'caption')?.clips ?? []
    expect(caps.length).toBeGreaterThan(3)
    expect(caps.some((c) => c.text && !c.auto)).toBe(true)
    expect(caps.filter((c) => c.auto).every((c) => (c.text ?? '').split(/\s+/).length <= 8)).toBe(true)
    expect(next.tracks.find((t) => t.type === 'caption')?.hidden).toBe(false)
  })

  test('lower thirds land on V2 from scenes', () => {
    const next = applyCommand(createDemoProject(), { type: 'addLowerThirds' })
    const thirds = next.tracks.find((t) => t.type === 'overlay')?.clips.filter((c) => c.text?.includes('\n'))
    expect((thirds ?? []).length).toBeGreaterThan(2)
    expect(thirds?.some((c) => c.text?.includes('Thesis'))).toBe(true)
  })

  test('title presets and style-all stay on the bus', () => {
    const titled = applyCommand(createDemoProject(), {
      type: 'addTitle',
      start: 8,
      duration: 2,
      text: 'Chapter',
      preset: 'chapter'
    })
    const card = titled.tracks.flatMap((t) => t.clips).find((c) => c.text === 'Chapter')
    expect(card?.style?.position).toBe('upper')
    const styled = applyCommand(titled, {
      type: 'setCaptionStyleAll',
      style: { fill: '#ff00aa', fontSize: 30 }
    })
    const texts = styled.tracks.flatMap((t) => t.clips).filter((c) => c.text)
    expect(texts.every((c) => c.style?.fill === '#ff00aa')).toBe(true)
  })

  test('importCaptions replaces V3 from SRT', () => {
    const next = applyCommand(createDemoProject(), {
      type: 'importCaptions',
      filename: 'line.srt',
      text: `1
00:00:01,000 --> 00:00:03,000
Hello PORT 8080
`
    })
    const caps = next.tracks.find((t) => t.type === 'caption')?.clips ?? []
    expect(caps).toHaveLength(1)
    expect(caps[0].text).toContain('Hello')
    expect(caps[0].start).toBe(1)
  })

  test('intent and MCP generate captions', async () => {
    const plan = planIntent(createDemoProject(), 'caption remaining words')
    expect(plan.commands[0]?.type).toBe('generateCaptions')
    const tool = await runTool(createDemoProject(), 'generate_captions', { maxWords: 5 })
    expect(tool.project.tracks.find((t) => t.type === 'caption')?.clips.length).toBeGreaterThan(2)
    const turn = await runAgent(createDemoProject(), 'caption remaining words')
    expect(turn.calls[0]?.name).toBe('generate_captions')
  })
})

describe('diarization hook', () => {
  test('parses WhisperX / Speaches speaker fields', () => {
    const cues = cuesFromTranscriptJson({
      segments: [
        {
          speaker: 'SPEAKER_00',
          start: 0,
          end: 1,
          words: [{ word: 'Hello', start: 0, end: 0.4, speaker: 'SPEAKER_00' }]
        },
        {
          speaker: 'SPEAKER_01',
          start: 1,
          end: 2,
          words: [{ word: 'there', start: 1, end: 1.3 }]
        }
      ]
    })
    expect(cues.map((c) => c.speaker)).toEqual(['SPEAKER_00', 'SPEAKER_01'])
  })

  test('applyDiarization creates speakers and remaps words', () => {
    const demo = createDemoProject()
    const next = applyCommand(demo, {
      type: 'applyDiarization',
      assignments: [
        { start: 0, end: 10, speaker: 'SPEAKER_00' },
        { start: 30, end: 42, speaker: 'SPEAKER_01' }
      ]
    })
    expect(next.transcript.speakers.some((s) => s.name === 'Speaker 0')).toBe(true)
    expect(next.transcript.speakers.some((s) => s.name === 'Speaker 1')).toBe(true)
    expect(next.transcript.words[0].speaker).toBe('spk_00')
    expect(next.transcript.words.find((w) => w.start > 32)?.speaker).toBe('spk_01')
  })
})

describe('interchange completeness', () => {
  test('SRT prefers the caption track and VTT is WebVTT', () => {
    const p = createDemoProject()
    expect(projectToSrt(p)).toContain('Cut speech like text.')
    expect(projectToVtt(p).startsWith('WEBVTT')).toBe(true)
    expect(projectToTranscriptMd(p)).toContain('## Ryan')
    expect(projectToChapters(p)).toMatch(/^0:00 Thesis$/m)
    expect(projectToChapters(p)).not.toMatch(/False take/)
  })

  test('OTIO carries scene markers and caption metadata', () => {
    const otio = JSON.parse(projectToOtio(createDemoProject()))
    expect(otio.markers.length).toBeGreaterThan(2)
    expect(otio.metadata.speechedit.captions.length).toBeGreaterThan(0)
    expect(otio.tracks.children.some((t: { kind?: string }) => t.kind === 'Subtitle')).toBe(true)
  })

  test('round-trips Premiere XML, Kdenlive, and FCPXML titles', () => {
    const edited = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const captioned = applyCommand(edited, { type: 'generateCaptions', maxWords: 5, emphasize: false })
    const length = programLength(captioned)

    const premiere = projectToPremiere(captioned)
    expect(premiere).toContain('<xmeml')
    expect(premiere).toContain('<clipitem')
    const fromPremiere = applyInterchange(createDemoProject(), 'reel.xml', premiere)
    expect(programLength(fromPremiere)).toBeCloseTo(length, 1)
    expect(fromPremiere.tracks.find((t) => t.type === 'caption')?.clips.length).toBeGreaterThan(0)

    const kden = projectToKdenlive(captioned)
    expect(kden).toContain('kdenlive:docproperties')
    expect(kden).toContain('<playlist id="titles">')
    const fromKden = applyInterchange(createDemoProject(), 'reel.kdenlive', kden)
    expect(programLength(fromKden)).toBeCloseTo(length, 1)

    const xml = projectToFcpxml(captioned)
    expect(xml).toContain('lane="1"')
    const fromXml = applyInterchange(createDemoProject(), 'reel.fcpxml', xml)
    expect(programLength(fromXml)).toBeCloseTo(length, 1)
    expect(fromXml.tracks.find((t) => t.type === 'caption')?.clips.some((c) => c.text)).toBe(true)
  })

  test('OTIO and MLT still round-trip cuts', () => {
    const edited = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const length = programLength(edited)
    const fromOtio = applyInterchange(createDemoProject(), 'reel.otio', projectToOtio(edited))
    expect(programLength(fromOtio)).toBeCloseTo(length, 1)
    const mlt = projectToMlt(edited)
    expect(mlt).toContain('<playlist id="audio">')
    const fromMlt = applyInterchange(createDemoProject(), 'reel.mlt', mlt)
    expect(programLength(fromMlt)).toBeCloseTo(length, 1)
  })

  test('SRT import via interchange writes captions, not cuts', () => {
    const next = applyInterchange(
      createDemoProject(),
      'subs.srt',
      `1
00:00:02,000 --> 00:00:04,000
Imported line
`
    )
    expect(programLength(next)).toBeCloseTo(programLength(createDemoProject()), 2)
    expect(next.tracks.find((t) => t.type === 'caption')?.clips[0]?.text).toBe('Imported line')
  })
})
