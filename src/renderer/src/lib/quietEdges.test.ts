import { prepareRecordingEdges } from './recordingEdges'
import { normalizeProject } from './normalize'
import { expect, test } from 'bun:test'
import { edgeWindows, quietIntervals, quietRangeEdges } from './quietEdges'
import { recordingEdgeMuteCommands } from './recordingEdgeActions'
import { applyCommand } from './commands'
import { projectFromTake } from './importMedia'
import { useEditor } from '../store'
import { projectToExportJob } from './exportJob'
import { sampleProgram } from './programLook'

test('late/early word timestamps expand into surrounding measured pauses, never shrink selected speech', () => {
  const range = { start: 2, end: 4 }
  const windows = edgeWindows(range, [{ start: 0, end: 1.1 }, range, { start: 4.9, end: 5.5 }], { start: 0, end: 6 })
  const levels = Array.from({ length: 600 }, (_, i) => i >= 120 && i < 150 || i >= 450 && i < 480 ? 0.001 : 0.2)
  const result = quietRangeEdges(range, windows, quietIntervals(levels, 0))
  expect(result.start).toBeCloseTo(1.47)
  expect(result.end).toBeCloseTo(4.53)
})

test('bounds, neighbouring words, overlaps, and cuts prevent swallowing other material', () => {
  const range = { start: 2, end: 4 }
  expect(edgeWindows(range, [{ start: 1, end: 1.8 }, range, { start: 4.2, end: 5 }], { start: 0, end: 6 }))
    .toEqual([{ start: 1.8, end: 2 }, { start: 4, end: 4.2 }])
  expect(edgeWindows(range, [{ start: 1.9, end: 2.1 }, { start: 3.9, end: 4.1 }], { start: 0, end: 6 }))
    .toEqual([{ start: 2, end: 2 }, { start: 4, end: 4 }])
  expect(edgeWindows(range, [], { start: 1.7, end: 4.4 }, [{ start: 1.75, end: 1.9 }, { start: 4.1, end: 4.3 }]))
    .toEqual([{ start: 1.9, end: 2 }, { start: 4, end: 4.1 }])
  expect(quietRangeEdges(range, edgeWindows(range, [], { start: 0, end: 6 }), [{ start: 0, end: 1 }, { start: 5, end: 6 }])).toEqual(range)
})

test('brief zero crossings, missing samples, and uncalibrated quiet data do not count as pauses', () => {
  expect(quietIntervals([.2, 0, 0, .2], 0)).toEqual([])
  expect(quietIntervals([.2, ...Array(10).fill(NaN), .2], 0)).toEqual([])
  expect(quietIntervals(Array(100).fill(0), 0)).toEqual([])
  expect(quietIntervals([.2, ...Array(10).fill(.001), .2], 10)).toEqual([{ start: 10.01, end: 10.11 }])
})

test('cleaning an existing take mutes only the extra original edges, keeps timing, and undoes together', () => {
  let p = projectFromTake({ asset: { id: 'source', path: '/source.wav', name: 'Source', kind: 'audio', duration: 6, waveform: [] }, words: [], whispered: null, analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] } })
  p = applyCommand(p, { type: 'replaceRangeAudio', start: 2, end: 4, asset: { id: 'take', path: '/take.mp3', name: 'Take', kind: 'audio', duration: 2, waveform: [], isRecording: true } })
  p = normalizeProject(p)
  const clip = p.tracks.find(t => t.id === 'voice_replacements')!.clips[0]
  const commands = recordingEdgeMuteCommands(p, clip.id, { start: 1.47, end: 4.53 })
  useEditor.getState().loadProject(p, { persist: false })
  useEditor.getState().beginHistoryGroup()
  for (const command of commands) useEditor.getState().dispatch(command)
  useEditor.getState().endHistoryGroup()
  const next = useEditor.getState().project, job = projectToExportJob(next)
  expect(next.tracks.find(t => t.id === 'voice_replacements')!.clips[0]).toEqual(clip)
  expect(job.duration).toBe(6)
  expect(recordingEdgeMuteCommands(next, clip.id, { start: 1.47, end: 4.53 })).toEqual([])
  expect(sampleProgram(job, 1.46).voice.gain).toBe(1)
  expect(sampleProgram(job, 1.6).voice.gain).toBe(0)
  expect(sampleProgram(job, 4.2).voice.gain).toBe(0)
  expect(sampleProgram(job, 4.54).voice.gain).toBe(1)
  useEditor.getState().undo()
  expect(useEditor.getState().project).toEqual(p)
  expect(() => recordingEdgeMuteCommands({ ...p, tracks: p.tracks.map(t => t.id === 'a1' ? { ...t, locked: true } : t) }, clip.id, { start: 1, end: 5 })).toThrow('Unlock')
})


test('an edge at a source join does not borrow a pause from the adjacent recording', async () => {
  const result = await prepareRecordingEdges({ range: { start: 3, end: 6 }, words: [], bounds: { start: 0, end: 6 }, barriers: [],
    silence: [{ start: 2.5, end: 2.9 }], sources: [
      { path: '/first.wav', sourceOffset: 0, duration: 3 },
      { path: '/second.wav', sourceOffset: 3, duration: 3 }
    ] }, new AbortController().signal)
  expect(result.range).toEqual({ start: 3, end: 6 })
})
