import { describe, expect, test } from 'bun:test'
import { applyCommand, findMovableClip, isPrimaryLane, programLength } from './commands'
import { buildExportJob, duckGainAt } from './exportJob'
import { createDemoProject } from './demo'
import { resolveSegments, snapTime, sourceToProgramOf, wordSnapTimes } from './resolver'
import { parseSrt } from './transcript'
import type { Asset } from '../types'

describe('command bus', () => {
  test('safe edits ripple the program shorter', () => {
    const before = createDemoProject()
    const start = programLength(before)
    const after = applyCommand(before, { type: 'applySafeSuggestions' })
    expect(programLength(after)).toBeLessThan(start - 10)
    expect(after.transcript.words.some((w) => w.deleted)).toBe(true)
  })

  test('restore brings silence back', () => {
    const cut = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const restored = applyCommand(cut, { type: 'restoreRange', start: 6.7, end: 15.9 })
    expect(programLength(restored)).toBeGreaterThan(programLength(cut))
  })

  test('speed shortens program time of a source range', () => {
    const p = applyCommand(createDemoProject(), { type: 'setSpeed', start: 16.2, end: 22.4, speed: 4 })
    const segs = resolveSegments(p)
    const sped = segs.find((s) => s.inPoint <= 18 && s.outPoint >= 20)
    expect(sped?.speed).toBe(4)
    expect(segs.some((s) => s.speed === 1)).toBe(true)
    expect(programLength(p)).toBeLessThan(programLength(createDemoProject()))
  })

  test('word edit does not cut', () => {
    const p = createDemoProject()
    const word = p.transcript.words[0]
    const next = applyCommand(p, { type: 'setWordText', wordId: word.id, text: 'Hello' })
    expect(next.transcript.words[0].text).toBe('Hello')
    expect(next.transcript.words[0].deleted).toBe(false)
  })
})

describe('nle graphics', () => {
  test('b-roll lands on V2 at the playhead', () => {
    const next = applyCommand(createDemoProject(), {
      type: 'addBroll',
      start: 4,
      duration: 3,
      asset: {
        id: 'img1',
        path: 'https://example.com/still.png',
        name: 'still.png',
        kind: 'image',
        duration: 3,
        waveform: []
      }
    })
    const clip = next.tracks.find((t) => t.type === 'overlay')?.clips.find((c) => c.assetId === 'img1')
    expect(clip?.start).toBe(4)
    expect(next.assets.img1.kind).toBe('image')
  })

  test('fade writes onto a primary segment', () => {
    const p = createDemoProject()
    const id = resolveSegments(p)[0].id
    const next = applyCommand(p, { type: 'setFade', targetId: id, edge: 'in', duration: 0.5 })
    expect(resolveSegments(next)[0].fadeIn).toBe(0.5)
  })
})

describe('transcript interchange', () => {
  test('parses srt into words', () => {
    const words = parseSrt(`1
00:00:01,000 --> 00:00:02,000
Hello there

2
00:00:03,000 --> 00:00:04,000
world
`)
    expect(words.map((w) => w.text)).toEqual(['Hello', 'there', 'world'])
    expect(words[0].start).toBe(1)
  })
})

import { withCutMargin } from './analysis'
import {
  applyInterchange,
  projectToAutoEditor,
  projectToFcpxml,
  projectToMlt,
  projectToOtio,
  projectToSrt
} from './interchange'

describe('program interchange', () => {
  test('writes srt, otio, and fcpxml from the demo reel', () => {
    const p = createDemoProject()
    const srt = projectToSrt(p)
    expect(srt).toContain('-->')
    expect(srt).toContain('Cut')
    const otio = JSON.parse(projectToOtio(p))
    expect(otio.OTIO_SCHEMA).toBe('Timeline.1')
    expect(otio.tracks.children.length).toBeGreaterThan(1)
    const xml = projectToFcpxml(p)
    expect(xml).toContain('<fcpxml')
    expect(xml).toContain('asset-clip')
  })

  test('round-trips OTIO, Auto-Editor, and FCPXML cuts', () => {
    const edited = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    const length = programLength(edited)
    const fromOtio = applyInterchange(createDemoProject(), 'reel.otio', projectToOtio(edited))
    expect(programLength(fromOtio)).toBeCloseTo(length, 1)
    const fromAe = applyInterchange(createDemoProject(), 'reel.json', projectToAutoEditor(edited))
    expect(programLength(fromAe)).toBeCloseTo(length, 1)
    const fromXml = applyInterchange(createDemoProject(), 'reel.fcpxml', projectToFcpxml(edited))
    expect(programLength(fromXml)).toBeCloseTo(length, 1)
    const mlt = projectToMlt(edited)
    expect(mlt).toContain('<playlist id="video">')
    expect(mlt).toContain('<entry producer="src"')
  })
})

describe('production edit tools', () => {
  test('cut margin pads silence so speech edges stay', () => {
    const padded = withCutMargin([{ start: 6.58, end: 16.02 }], 0.12)
    expect(padded[0].start).toBeCloseTo(6.7, 2)
    expect(padded[0].end).toBeCloseTo(15.9, 2)
    const next = applyCommand(createDemoProject(), { type: 'setCutMargin', margin: 0.3 })
    const silence = next.suggestions.find((s) => s.type === 'silence')
    expect(next.cutMargin).toBeCloseTo(0.3, 2)
    expect(silence?.start).toBeCloseTo(6.88, 2)
  })

  test('safe edits also arm loudness normalize', () => {
    const next = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    expect(next.audioMaster.normalize).toBe(true)
    expect(next.suggestions.find((s) => s.id === 'sug_norm')?.applied).toBe(true)
  })

  test('dissolve overlaps adjacent primary segments', () => {
    const split = applyCommand(createDemoProject(), { type: 'splitAt', time: 18 })
    const before = programLength(split)
    const segs = resolveSegments(split)
    expect(segs.length).toBeGreaterThan(1)
    const park = segs[0].start + segs[0].duration - 0.05
    const next = applyCommand(split, { type: 'dissolveAtPlayhead', time: park, duration: 0.4 })
    const joined = resolveSegments(next)
    expect(joined[0].overlapNext).toBeGreaterThan(0.3)
    expect(programLength(next)).toBeLessThan(before - 0.2)
  })

  test('master EQ and compressor ride the command bus', () => {
    const next = applyCommand(createDemoProject(), {
      type: 'setAudioMaster',
      patch: { eqLow: 3, eqHigh: -2, compress: true }
    })
    expect(next.audioMaster.eqLow).toBe(3)
    expect(next.audioMaster.eqHigh).toBe(-2)
    expect(next.audioMaster.compress).toBe(true)
  })

  test('painting guards merges strokes and alt-erase splits them', () => {
    const a = applyCommand(createDemoProject(), { type: 'addTag', start: 1, end: 3, kind: 'keep' })
    const b = applyCommand(a, { type: 'addTag', start: 2.7, end: 5, kind: 'keep' })
    const keeps = b.tags.filter((t) => t.kind === 'keep')
    expect(keeps).toHaveLength(1)
    expect(keeps[0].start).toBeCloseTo(1, 2)
    expect(keeps[0].end).toBeCloseTo(5, 2)
    const erased = applyCommand(b, { type: 'eraseTag', start: 2, end: 4, kind: 'keep' })
    const pieces = erased.tags.filter((t) => t.kind === 'keep').sort((x, y) => x.start - y.start)
    expect(pieces).toHaveLength(2)
    expect(pieces[0].end).toBeCloseTo(2, 1)
    expect(pieces[1].start).toBeCloseTo(4, 1)
  })

  test('keep/demo tags punch holes in auto-edit and can be reverted one-by-one', () => {
    const demo = createDemoProject()
    const tagged = applyCommand(demo, {
      type: 'addTag',
      start: 6.7,
      end: 15.9,
      kind: 'keep',
      label: 'Keep the pause'
    })
    const firstSilence = tagged.suggestions.find((s) => s.type === 'silence' && s.start < 10)
    expect(firstSilence?.blockedBy).toBeTruthy()
    const afterSafe = applyCommand(tagged, { type: 'applySafeSuggestions' })
    expect(programLength(afterSafe)).toBeGreaterThan(programLength(applyCommand(demo, { type: 'applySafeSuggestions' })))
    const cut = applyCommand(demo, { type: 'applySafeSuggestions' })
    const silence = cut.suggestions.find((s) => s.type === 'silence' && s.applied)
    expect(silence).toBeTruthy()
    const reverted = applyCommand(cut, { type: 'revertSuggestion', suggestionId: silence!.id })
    expect(reverted.suggestions.find((s) => s.id === silence!.id)?.applied).toBe(false)
    expect(programLength(reverted)).toBeGreaterThan(programLength(cut))
    const fillersStillCut = reverted.suggestions.filter((s) => s.type === 'filler' && s.applied)
    expect(fillersStillCut.length).toBeGreaterThan(0)
  })

  test('detects the demo retake and can put that cut back alone', () => {
    const demo = createDemoProject()
    const retake = demo.suggestions.find((s) => s.type === 'repeat')
    expect(retake).toBeTruthy()
    expect(retake!.start).toBeCloseTo(30.2, 1)
    const cut = applyCommand(demo, { type: 'applySuggestion', suggestionId: retake!.id })
    expect(programLength(cut)).toBeLessThan(programLength(demo) - 1)
    expect(cut.cuts.some((c) => c.source === 'repeat')).toBe(true)
    const back = applyCommand(cut, { type: 'revertSuggestion', suggestionId: retake!.id })
    expect(back.suggestions.find((s) => s.id === retake!.id)?.applied).toBe(false)
    expect(programLength(back)).toBeCloseTo(programLength(demo), 1)
  })

  test('speakers assign and rebuild keeps applied cuts', () => {
    const demo = createDemoProject()
    const withSpk = applyCommand(demo, { type: 'addSpeaker', name: 'Guest' })
    const guest = withSpk.transcript.speakers.find((s) => s.name === 'Guest')
    expect(guest).toBeTruthy()
    const assigned = applyCommand(withSpk, {
      type: 'setSpeaker',
      wordIds: [demo.transcript.words[0].id],
      speakerId: guest!.id
    })
    expect(assigned.transcript.words[0].speaker).toBe(guest!.id)
    const cut = applyCommand(demo, { type: 'applySafeSuggestions' })
    const rebuilt = applyCommand(cut, { type: 'rebuildSuggestions' })
    expect(rebuilt.suggestions.some((s) => s.applied)).toBe(true)
    expect(programLength(rebuilt)).toBeCloseTo(programLength(cut), 2)
  })

  test('sentence and false-start cuts remove the right words', () => {
    const demo = createDemoProject()
    const next = applyCommand(demo, { type: 'cutSentence', wordId: demo.transcript.words[0].id })
    expect(next.transcript.words.filter((w) => w.start < 6.5).every((w) => w.deleted)).toBe(true)
    const later = demo.transcript.words.find((w) => w.text === "That's")
    expect(later).toBeTruthy()
    const prev = applyCommand(demo, { type: 'cutPreviousSentence', wordId: later!.id })
    expect(prev.transcript.words.some((w) => w.text === 'speech' && w.deleted && w.start < 32)).toBe(true)
    expect(prev.transcript.words.find((w) => w.text === "That's")?.deleted).toBe(false)
  })

  test('tighten cuts air but leaves guarded demo footage', () => {
    const demo = createDemoProject()
    const next = applyCommand(demo, { type: 'tightenRange', start: 0, end: 42 })
    expect(programLength(next)).toBeLessThan(programLength(demo) - 8)
    expect(next.cuts.some((c) => c.start <= 24.4 && c.end >= 27.8)).toBe(false)
  })

  test('b-roll writes duck windows onto the export job', () => {
    const demo = createDemoProject()
    const withPath = {
      ...demo,
      assets: Object.fromEntries(
        Object.entries(demo.assets).map(([id, asset]) => [id, { ...asset, path: '/tmp/demo.wav' }])
      )
    }
    const next = applyCommand(withPath, {
      type: 'addBroll',
      start: 4,
      duration: 3,
      asset: {
        id: 'img1',
        path: 'https://example.com/still.png',
        name: 'still.png',
        kind: 'image',
        duration: 3,
        waveform: []
      }
    })
    const job = buildExportJob(next, '/tmp/out.mp4')
    expect(job?.duck).toBeGreaterThan(0)
    expect(job?.duckWindows.some((w) => w.start === 4 && w.end === 7)).toBe(true)
    expect(duckGainAt(next, 5)).toBeLessThan(1)
    expect(duckGainAt(next, 1)).toBe(1)
  })

  test('music bed lands on A2 and ripples with voice cuts', () => {
    const withBed = applyCommand(createDemoProject(), {
      type: 'addAudio',
      start: 12,
      duration: 8,
      asset: {
        id: 'mus1',
        path: '/tmp/bed.wav',
        name: 'bed.wav',
        kind: 'audio',
        duration: 8,
        waveform: []
      }
    })
    const bed = withBed.tracks
      .filter((t) => t.type === 'audio' && t.id !== 'a1')
      .flatMap((t) => t.clips)
      .find((c) => c.assetId === 'mus1')
    expect(bed?.start).toBe(12)
    expect(withBed.assets.mus1.kind).toBe('audio')
    const cut = applyCommand(withBed, { type: 'applySafeSuggestions' })
    const moved = cut.tracks.flatMap((t) => t.clips).find((c) => c.assetId === 'mus1')
    expect(moved?.start).toBeLessThan(12)
    const withPath = {
      ...cut,
      assets: Object.fromEntries(
        Object.entries(cut.assets).map(([id, asset]) => [
          id,
          { ...asset, path: asset.path || '/tmp/demo.wav' }
        ])
      )
    }
    const job = buildExportJob(withPath, '/tmp/out.mp4')
    expect(job?.beds.some((b) => b.path === '/tmp/bed.wav')).toBe(true)
  })

  test('redaction and extra overlay track land on the bus', () => {
    const withBlur = applyCommand(createDemoProject(), {
      type: 'addRedaction',
      start: 2,
      duration: 3
    })
    const blur = withBlur.tracks.flatMap((t) => t.clips).find((c) => c.effect === 'blur')
    expect(blur?.start).toBe(2)
    const extra = applyCommand(withBlur, { type: 'addTrack', trackType: 'overlay' })
    expect(extra.tracks.filter((t) => t.type === 'overlay')).toHaveLength(2)
  })
})

import { buildAgentContext } from './agentContext'
import { parseIntelligence } from './intelligence'
import { planIntent } from './intent'
import { runTool } from './mcpTools'

describe('intelligence and MCP', () => {
  test('intent cuts a quoted phrase and applies safe edits', () => {
    const demo = createDemoProject()
    const cut = planIntent(demo, 'cut "you know"')
    expect(cut.commands[0]?.type).toBe('toggleWords')
    const next = applyCommand(demo, cut.commands[0])
    expect(next.transcript.words.some((w) => w.text === 'you' && w.deleted)).toBe(true)
    const safe = planIntent(demo, 'auto-edit the reel')
    expect(safe.commands[0]?.type).toBe('applySafeSuggestions')
  })

  test('model JSON becomes scenes and guarded-aware suggestions', () => {
    const draft = parseIntelligence({
      notes: 'Keep the silent demo.',
      scenes: [{ start: 23.7, end: 30.2, title: 'Demo', kind: 'demo', summary: 'UI' }],
      cuts: [{ start: 40.2, end: 40.7, label: 'Shotcut', safe: false }],
      commands: [{ type: 'deleteRange', start: 40.2, end: 40.7, source: 'model' }, { type: 'explode' }]
    })
    expect(draft.scenes[0].title).toBe('Demo')
    expect(draft.suggestions[0].type).toBe('model')
    expect(draft.commands).toHaveLength(1)
    const merged = applyCommand(createDemoProject(), {
      type: 'mergeIntelligence',
      scenes: draft.scenes,
      suggestions: draft.suggestions
    })
    expect(merged.scenes.some((s) => s.title === 'Demo')).toBe(true)
    expect(merged.suggestions.some((s) => s.type === 'model' && s.label === 'Shotcut')).toBe(true)
  })

  test('MCP cut_words and revert_at use the command bus', async () => {
    const demo = createDemoProject()
    const cut = await runTool(demo, 'cut_words', { phrase: 'you know' })
    expect(cut.project.transcript.words.some((w) => w.text === 'know' && w.deleted)).toBe(true)
    const ctx = await runTool(cut.project, 'get_context', {})
    expect(ctx.message).toContain('Transcript')
    expect(buildAgentContext(demo).scenes.length).toBeGreaterThan(0)
    const safe = applyCommand(demo, { type: 'applySafeSuggestions' })
    const um = safe.suggestions.find((s) => s.type === 'filler' && s.applied)
    expect(um).toBeTruthy()
    const back = applyCommand(safe, { type: 'revertAt', start: um!.start, end: um!.end })
    expect(back.suggestions.find((s) => s.id === um!.id)?.applied).toBe(false)
  })
})

const bedAsset = (id = 'mus1'): Asset => ({
  id,
  path: '/tmp/bed.wav',
  name: 'bed.wav',
  kind: 'audio',
  duration: 8,
  waveform: []
})

describe('timeline snap and Q/W', () => {
  test('snapTime locks to words, I/O marks, and clip edges', () => {
    const demo = createDemoProject()
    const today = demo.transcript.words.find((w) => w.text === 'today')
    expect(today).toBeTruthy()
    const wordProg = sourceToProgramOf(demo, today!.start)
    expect(snapTime(demo, wordProg + 0.04)).toBeCloseTo(wordProg, 2)

    const snaps = wordSnapTimes(demo)
    expect(snaps.some((t) => Math.abs(t - wordProg) < 1e-6)).toBe(true)

    const marked = applyCommand(demo, { type: 'setMarks', markIn: 12, markOut: 14 })
    expect(snapTime(marked, 12.07)).toBeCloseTo(12, 2)
    expect(snapTime(marked, 13.94)).toBeCloseTo(14, 2)

    const zoom = demo.tracks.find((t) => t.type === 'overlay')?.clips[0]
    expect(zoom).toBeTruthy()
    const zoomOut = zoom!.start + zoom!.duration
    expect(snapTime(demo, zoomOut - 0.05)).toBeCloseTo(zoomOut, 2)
    expect(snapTime(demo, 10, [], 0.08)).toBeCloseTo(10, 2)
  })

  test('Q and W ripple-trim the active primary segment to the playhead', () => {
    const demo = createDemoProject()
    const before = programLength(demo)
    const first = resolveSegments(demo)[0]
    expect(first).toBeTruthy()

    const q = applyCommand(demo, { type: 'rippleTrimToPlayhead', edge: 'in', time: 2 })
    expect(programLength(q)).toBeCloseTo(before - 2, 1)
    expect(resolveSegments(q)[0].inPoint).toBeGreaterThan(first.inPoint + 1.5)

    const w = applyCommand(demo, { type: 'rippleTrimToPlayhead', edge: 'out', time: 2 })
    const pictureOut = resolveSegments(w).reduce((max, seg) => Math.max(max, seg.start + seg.duration), 0)
    expect(pictureOut).toBeCloseTo(2, 1)
    expect(resolveSegments(w)[0].outPoint).toBeCloseTo(2, 1)

    const withBed = applyCommand(demo, {
      type: 'addAudio',
      start: 12,
      duration: 8,
      asset: bedAsset('musq')
    })
    const afterQ = applyCommand(withBed, { type: 'rippleTrimToPlayhead', edge: 'in', time: 2 })
    const bed = afterQ.tracks.flatMap((t) => t.clips).find((c) => c.assetId === 'musq')
    expect(bed?.start).toBeCloseTo(10, 1)
  })

  test('music beds move, trim, and razor without touching derived V1/A1', () => {
    const withBed = applyCommand(createDemoProject(), {
      type: 'addAudio',
      start: 12,
      duration: 8,
      asset: bedAsset()
    })
    const bedTrack = withBed.tracks.find((t) => t.type === 'audio' && t.id !== 'a1')
    expect(bedTrack && !isPrimaryLane(bedTrack)).toBe(true)
    const bed = bedTrack?.clips.find((c) => c.assetId === 'mus1')
    expect(bed).toBeTruthy()
    expect(findMovableClip(withBed, bed!.id)?.id).toBe(bed!.id)
    expect(findMovableClip(withBed, resolveSegments(withBed)[0].id)).toBeUndefined()

    const moved = applyCommand(withBed, { type: 'moveClip', clipId: bed!.id, start: 4 })
    expect(moved.tracks.flatMap((t) => t.clips).find((c) => c.assetId === 'mus1')?.start).toBe(4)

    const trimmed = applyCommand(moved, { type: 'trimClip', clipId: bed!.id, edge: 'in', time: 6 })
    const afterTrim = trimmed.tracks.flatMap((t) => t.clips).find((c) => c.assetId === 'mus1')
    expect(afterTrim?.start).toBeCloseTo(6, 2)
    expect(afterTrim?.duration).toBeCloseTo(6, 2)

    const razored = applyCommand(withBed, { type: 'splitAt', time: 14 })
    const pieces = razored.tracks
      .find((t) => t.id === bedTrack!.id)
      ?.clips.filter((c) => c.assetId === 'mus1')
    expect(pieces).toHaveLength(2)
    expect(withBed.tracks.find((t) => t.id === 'v1')?.clips).toHaveLength(0)
    expect(withBed.tracks.find((t) => t.id === 'a1')?.clips).toHaveLength(0)
  })
})
