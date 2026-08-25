import { describe, expect, test } from 'bun:test'
import { applyCommand, programLength } from './commands'
import { suggestTask } from './contextActions'
import { createDemoProject } from './demo'
import { applySafeFirstEdit, describeFirstEdit, safeEditCandidates } from './firstEdit'
import { ffmpegImportBusy } from './mediaJobs'
import { hasUncollapsedRetakes } from './sceneAnalysis'
import { importMediaFromPath } from './fileActions'
import { projectFromTake } from './importMedia'
import { host } from '../host'
import { useEditor } from '../store'

async function waitUntil(pred: () => boolean, ms = 800): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await Bun.sleep(5)
  }
}

function stubHost(partial: Partial<typeof host>): () => void {
  const keys = Object.keys(partial) as (keyof typeof host)[]
  const prev = Object.fromEntries(keys.map((key) => [key, host[key]])) as Partial<typeof host>
  Object.assign(host, partial)
  return () => Object.assign(host, prev)
}

describe('safe first edit', () => {
  test('describeFirstEdit is undo-first and mentions leftover review', () => {
    expect(describeFirstEdit(1, 0)).toBe('Removed 1 pause. Undo to put them back.')
    expect(describeFirstEdit(3, 2)).toBe('Removed 3 pauses. 2 decisions need review. Undo to put them back.')
    expect(describeFirstEdit(2, 1, 1)).toBe(
      'Removed 2 pauses. Dropped 1 false take. 1 decision need review. Undo to put them back.'
    )
    expect(describeFirstEdit(2, 0, 1, 'filler')).toBe('Removed 2 fillers. Dropped 1 false take. Undo to put them back.')
  })

  test('attachTakeIntel analysis rebuilds safe pauses without waiting for words', () => {
    const ready = projectFromTake({
      asset: {
        id: 'src',
        path: '/tmp/a.mp4',
        name: 'a.mp4',
        kind: 'video',
        duration: 12,
        waveform: [],
        sourceOffset: 0
      },
      words: [],
      whispered: null,
      analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
    })
    expect(ready.suggestions.some((s) => s.type === 'silence')).toBe(false)
    const next = applyCommand(ready, {
      type: 'attachTakeIntel',
      assetId: 'src',
      analysis: { silence: [{ start: 2, end: 8 }], staticRegions: [], loudness: [] }
    })
    expect(next.analysis.silence).toEqual([{ start: 2, end: 8 }])
    expect(next.suggestions.some((s) => s.safe && s.type === 'silence')).toBe(true)
  })

  test('looks phase cuts safe edits without collapsing retakes', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { path: null, clean: false })
    const looks = applySafeFirstEdit('looks')
    expect(looks).not.toBeNull()
    expect(looks!.applied).toBeGreaterThan(0)
    expect(looks!.retakes).toBe(0)
    expect(safeEditCandidates(useEditor.getState().project)).toHaveLength(0)
    expect(hasUncollapsedRetakes(useEditor.getState().project)).toBe(true)

    const words = applySafeFirstEdit('words')
    expect(words?.retakes).toBeGreaterThan(0)
    expect(hasUncollapsedRetakes(useEditor.getState().project)).toBe(false)
    useEditor.getState().undo()
    expect(hasUncollapsedRetakes(useEditor.getState().project)).toBe(true)
    expect(safeEditCandidates(useEditor.getState().project)).toHaveLength(0)
  })

  test('applySafeFirstEdit cuts safe pauses, drops false takes, and undoes retakes first', () => {
    const demo = createDemoProject()
    const start = programLength(demo)
    const safe = safeEditCandidates(demo)
    expect(safe.length).toBeGreaterThan(0)
    expect(hasUncollapsedRetakes(demo)).toBe(true)
    expect(demo.suggestions.some((s) => !s.safe && !s.applied)).toBe(true)

    useEditor.getState().loadProject(demo, { path: null, clean: false })
    const result = applySafeFirstEdit()
    expect(result).not.toBeNull()
    expect(result!.applied).toBeGreaterThan(0)
    expect(result!.retakes).toBeGreaterThan(0)

    const edited = useEditor.getState().project
    expect(programLength(edited)).toBeLessThan(start - 10)
    expect(safeEditCandidates(edited)).toHaveLength(0)
    expect(hasUncollapsedRetakes(edited)).toBe(false)
    expect(edited.suggestions.filter((s) => s.type === 'repeat').every((s) => s.applied || s.blockedBy)).toBe(true)
    expect(suggestTask(edited).headline).toMatch(/First edit done|Edit applied/)
    expect(suggestTask(edited).collapseRetakes).toBe(false)
    expect(applySafeFirstEdit()).toBeNull()

    useEditor.getState().undo()
    expect(hasUncollapsedRetakes(useEditor.getState().project)).toBe(true)
    expect(safeEditCandidates(useEditor.getState().project)).toHaveLength(0)
    useEditor.getState().undo()
    expect(programLength(useEditor.getState().project)).toBeCloseTo(start, 5)
    expect(safeEditCandidates(useEditor.getState().project).length).toBe(safe.length)
  })

  test('keep tags still block auto first-edit', () => {
    const demo = createDemoProject()
    const tagged = applyCommand(demo, {
      type: 'addTag',
      start: 6.7,
      end: 15.9,
      kind: 'keep',
      label: 'Keep the pause'
    })
    const blocked = tagged.suggestions.find((s) => s.type === 'silence' && s.start < 10)
    expect(blocked?.blockedBy).toBeTruthy()
    expect(safeEditCandidates(tagged).some((s) => s.id === blocked?.id)).toBe(false)

    useEditor.getState().loadProject(tagged, { path: null, clean: false })
    applySafeFirstEdit()
    const after = useEditor.getState().project
    expect(after.suggestions.find((s) => s.id === blocked?.id)?.applied).toBe(false)
    const unguarded = applyCommand(applyCommand(demo, { type: 'applySafeSuggestions' }), { type: 'collapseRetakes' })
    expect(programLength(after)).toBeGreaterThan(programLength(unguarded))
  })

  test('Open media applies the first edit after intel lands', async () => {
    const restore = stubHost({
      probe: async () => ({
        duration: 12,
        hasVideo: true,
        hasAudio: true,
        width: 320,
        height: 240,
        fps: 30
      }),
      makeProxy: async () => {
        throw new Error('proxy should not run for short SD')
      },
      waveform: async () => [0.2],
      thumbnails: async () => [],
      analyze: async () => ({
        silence: [{ start: 2, end: 8 }],
        scenes: { times: [], staticRegions: [] },
        loudness: []
      }),
      transcribe: async () => [
        { text: 'hello', start: 0.2, end: 0.6 },
        { text: 'world', start: 9.5, end: 10.1 }
      ],
      beginJob: async () => undefined,
      endJob: async () => undefined
    })
    const toasts: string[] = []
    useEditor.getState().setAnalyzing(null)
    useEditor.getState().setExporting(false)
    try {
      await importMediaFromPath('/tmp/se-first-edit.mp4', (msg) => toasts.push(msg))
      const project = useEditor.getState().project
      expect(project.suggestions.some((s) => s.safe && s.applied && s.type === 'silence')).toBe(true)
      expect(project.suggestions.some((s) => s.safe && !s.applied && !s.blockedBy)).toBe(false)
      expect(programLength(project)).toBeLessThan(12 - 4)
      expect(toasts.some((msg) => /Removed \d+ pause/.test(msg))).toBe(true)
      expect(suggestTask(project).headline).toMatch(/First edit done|Edit applied/)
    } finally {
      restore()
      useEditor.getState().setAnalyzing(null)
    }
  })

  test('Open media applies safe pauses when looks land, before Whisper finishes', async () => {
    let releaseAsr!: () => void
    const asrGate = new Promise<void>((resolve) => {
      releaseAsr = resolve
    })
    const restore = stubHost({
      probe: async () => ({
        duration: 12,
        hasVideo: true,
        hasAudio: true,
        width: 320,
        height: 240,
        fps: 30
      }),
      makeProxy: async () => {
        throw new Error('proxy should not run for short SD')
      },
      waveform: async () => [0.2],
      thumbnails: async () => [],
      analyze: async () => ({
        silence: [{ start: 2, end: 8 }],
        scenes: { times: [], staticRegions: [] },
        loudness: []
      }),
      transcribe: async () => {
        await asrGate
        return [
          { text: 'hello', start: 0.2, end: 0.6 },
          { text: 'um', start: 0.9, end: 1.1 },
          { text: 'world', start: 9.5, end: 10.1 }
        ]
      },
      beginJob: async () => undefined,
      endJob: async () => undefined
    })
    const toasts: string[] = []
    useEditor.getState().newProject()
    useEditor.getState().setAnalyzing(null)
    useEditor.getState().setExporting(false)
    try {
      const done = importMediaFromPath('/tmp/se-first-edit-early.mp4', (msg) => toasts.push(msg))
      await waitUntil(
        () =>
          useEditor.getState().project.suggestions.some((s) => s.safe && s.applied && s.type === 'silence') &&
          useEditor.getState().project.transcript.words.length === 0
      )
      const mid = useEditor.getState().project
      expect(programLength(mid)).toBeLessThan(12 - 4)
      expect(mid.transcript.words.length).toBe(0)
      expect(ffmpegImportBusy(useEditor.getState().analyzing)).toBe(false)
      expect(toasts.some((msg) => /Removed \d+ pause/.test(msg))).toBe(true)
      expect(suggestTask(mid).headline).toMatch(/First edit done/)
      releaseAsr()
      await done
      const project = useEditor.getState().project
      expect(project.suggestions.some((s) => s.type === 'filler' && s.label === 'um' && s.applied)).toBe(true)
      expect(toasts.filter((msg) => /Removed \d+ (pause|filler)/.test(msg)).length).toBeGreaterThanOrEqual(1)
    } finally {
      releaseAsr()
      restore()
      useEditor.getState().setAnalyzing(null)
    }
  })

  test('undoing the looks first-edit is not re-applied when Whisper finishes', async () => {
    let releaseAsr!: () => void
    const asrGate = new Promise<void>((resolve) => {
      releaseAsr = resolve
    })
    const restore = stubHost({
      probe: async () => ({
        duration: 12,
        hasVideo: true,
        hasAudio: true,
        width: 320,
        height: 240,
        fps: 30
      }),
      makeProxy: async () => {
        throw new Error('proxy should not run for short SD')
      },
      waveform: async () => [0.2],
      thumbnails: async () => [],
      analyze: async () => ({
        silence: [{ start: 2, end: 8 }],
        scenes: { times: [], staticRegions: [] },
        loudness: []
      }),
      transcribe: async () => {
        await asrGate
        return [
          { text: 'hello', start: 0.2, end: 0.6 },
          { text: 'world', start: 9.5, end: 10.1 }
        ]
      },
      beginJob: async () => undefined,
      endJob: async () => undefined
    })
    useEditor.getState().newProject()
    useEditor.getState().setAnalyzing(null)
    useEditor.getState().setExporting(false)
    try {
      const done = importMediaFromPath('/tmp/se-first-edit-undo.mp4', () => undefined)
      await waitUntil(
        () =>
          useEditor.getState().project.suggestions.some((s) => s.safe && s.applied && s.type === 'silence') &&
          useEditor.getState().project.transcript.words.length === 0
      )
      useEditor.getState().undo()
      expect(programLength(useEditor.getState().project)).toBeCloseTo(12, 1)
      expect(
        useEditor.getState().project.suggestions.some((s) => s.safe && s.applied && s.start < 8 && s.end > 3)
      ).toBe(false)
      releaseAsr()
      await done
      expect(
        useEditor.getState().project.suggestions.some((s) => s.safe && s.applied && s.start < 8 && s.end > 3)
      ).toBe(false)
      expect(programLength(useEditor.getState().project)).toBeGreaterThan(9)
    } finally {
      releaseAsr()
      restore()
      useEditor.getState().setAnalyzing(null)
    }
  })

  test('still-frame silence is left for review, not auto-cut', async () => {
    const restore = stubHost({
      probe: async () => ({
        duration: 10,
        hasVideo: true,
        hasAudio: true,
        width: 320,
        height: 240,
        fps: 30
      }),
      makeProxy: async () => {
        throw new Error('proxy should not run for short SD')
      },
      waveform: async () => [0.2],
      thumbnails: async () => [],
      analyze: async () => ({
        silence: [{ start: 2, end: 8 }],
        scenes: { times: [], staticRegions: [{ start: 1.8, end: 8.2 }] },
        loudness: []
      }),
      transcribe: async () => [
        { text: 'hello', start: 0.2, end: 0.6 },
        { text: 'world', start: 8.6, end: 9.85 }
      ],
      beginJob: async () => undefined,
      endJob: async () => undefined
    })
    const toasts: string[] = []
    useEditor.getState().setAnalyzing(null)
    useEditor.getState().setExporting(false)
    try {
      await importMediaFromPath('/tmp/se-still-demo.mp4', (msg) => toasts.push(msg))
      const project = useEditor.getState().project
      const still = project.suggestions.find((s) => s.type === 'silence')
      expect(still?.safe).toBe(false)
      expect(still?.applied).toBe(false)
      expect(programLength(project)).toBeCloseTo(10, 1)
      expect(toasts.at(-1)).toMatch(/suggestions|words/)
    } finally {
      restore()
      useEditor.getState().setAnalyzing(null)
    }
  })
})
