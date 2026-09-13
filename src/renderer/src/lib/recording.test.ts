import { expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { captureProcessor, pcmWave } from './recording'
import { applyCommand } from './commands'
import { projectFromTake } from './importMedia'
import { recordingSlot } from './replaceAudio'
import { programLengthOf, resolveMediaSegments } from './resolver'
import { useEditor } from '../store'
import { projectToExportJob } from './exportJob'
import { sampleProgram } from './programLook'
import { validateExportJob, voiceAudioFilters } from './exportGraph'
import { spawnSync } from 'node:child_process'
import { primaryTakes } from './takes'
import { prepareSharedProject, sharedProject } from '../../../shared/collaboration'

function microphone() {
  let Processor: any
  const messages: any[] = []
  const scope = { AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (value: any) => messages.push(value) } }, currentFrame: 0, sampleRate: 48000, registerProcessor: (_name: string, processor: any) => { Processor = processor } }
  runInNewContext(captureProcessor, scope)
  const processor = new Processor({ processorOptions: { startFrame: 200, frames: 300 } })
  const advance = (value: number) => { processor.process([[new Float32Array(128).fill(value)]], [[new Float32Array(128)]]); scope.currentFrame += 128 }
  return { processor, advance, messages }
}
test('microphone capture excludes the countdown and stops at the exact sample boundary', () => {
  const mic = microphone()
  mic.advance(0.9); mic.advance(0.25); mic.advance(0.5); mic.advance(0.75); mic.advance(1)
  const result = mic.messages.find(message => message.samples)
  expect(result.written).toBe(300); expect(result.samples.length).toBe(300)
  expect(Array.from(result.samples.slice(0, 56))).toEqual(Array(56).fill(0.25))
  expect(result.samples[56]).toBe(0.5); expect(result.samples[299]).toBe(0.75)
  expect(mic.messages.filter(message => message.samples)).toHaveLength(1)
})
test('early stop pads only the remaining slot with silence; WAV retains exact PCM duration', async () => {
  const mic = microphone(); mic.advance(1); mic.advance(0.25)
  mic.processor.port.onmessage({ data: 'finish' })
  const result = mic.messages.find(message => message.samples)
  expect(result.written).toBe(56); expect(Array.from(result.samples.slice(56))).toEqual(Array(244).fill(0))
  const wav = new DataView(await pcmWave(result.samples, 48000).arrayBuffer())
  expect(wav.getUint32(24, true)).toBe(48000); expect(wav.getUint32(40, true)).toBe(600)
})
const fixture = () => projectFromTake({ asset: { id: 'video', path: '/original.mp4', name: 'Video', kind: 'video', duration: 10, waveform: [], sourceOffset: 0 }, words: [{ id: 'w', text: 'Hello', start: 0.02, end: 2, deleted: false, speaker: 's' }], whispered: null, analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] } })
const asset = (id: string, duration: number) => ({ id, path: `/${id}.mp3`, name: id, kind: 'audio' as const, duration, waveform: [], isRecording: true })
test('replacement mutes exactly the chosen voice range, preserves music/video and undoes once', () => {
  const p = applyCommand(fixture(), { type: 'addAudio', start: 0, duration: 10, asset: asset('music', 10) })
  useEditor.getState().loadProject(p, { persist: false })
  useEditor.getState().dispatch({ type: 'replaceRangeAudio', start: 0.02, end: 2, asset: asset('take', 1.98) })
  const next = useEditor.getState().project, segments = resolveMediaSegments(next)
  expect(segments).toEqual(resolveMediaSegments(p))
  const job = projectToExportJob(next)
  expect(validateExportJob(job)).toBeNull()
  expect(sampleProgram(job, 0.019).voice.gain).toBeGreaterThan(0)
  expect(sampleProgram(job, 0.02).voice.gain).toBe(0)
  expect(sampleProgram(job, 2).voice.gain).toBeGreaterThan(0)
  expect(sampleProgram(job, 1).beds.find(b => b.bed.path === '/music.mp3')?.gain).toBeGreaterThan(0)
  const rendered = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.25:sample_rate=48000:duration=3', '-af', voiceAudioFilters(job).join(','), '-f', 'f32le', 'pipe:1'])
  expect(rendered.status).toBe(0)
  expect(rendered.stdout.readFloatLE(959 * 4)).toBeCloseTo(0.25)
  expect(rendered.stdout.readFloatLE(960 * 4)).toBe(0)
  expect(rendered.stdout.readFloatLE(95999 * 4)).toBe(0)
  expect(rendered.stdout.readFloatLE(96000 * 4)).toBeCloseTo(0.25)
  expect(next.assets.video).toEqual(p.assets.video)
  expect(next.tracks.find(t => t.name === 'A2 Music')).toEqual(p.tracks.find(t => t.name === 'A2 Music'))
  expect(next.tracks.find(t => t.id === 'voice_replacements')?.clips[0]).toMatchObject({ start: 0.02, duration: 1.98, volume: 1 })
  expect(programLengthOf(next)).toBe(programLengthOf(p)); expect(next.cuts).toEqual(p.cuts)
  useEditor.getState().undo(); expect(useEditor.getState().project).toEqual(p)
})
test('another take replaces overlapping replacement audio without layering voices', () => {
  const p = applyCommand(fixture(), { type: 'replaceRangeAudio', start: 1, end: 4, asset: asset('one', 3) })
  const next = applyCommand(p, { type: 'replaceRangeAudio', start: 2, end: 3, asset: asset('two', 1) })
  expect(next.tracks.find(t => t.id === 'voice_replacements')?.clips.map(c => [c.start, c.duration, c.inPoint])).toEqual([[1, 1, 0], [2, 1, 0], [3, 1, 2]])
})
test('a superseded recording never becomes source media after another collaborator replaces the entire slot', () => {
  const original = fixture()
  const first = applyCommand(original, { type: 'replaceRangeAudio', start: 1, end: 4, asset: asset('owner', 3) })
  const second = applyCommand(first, { type: 'replaceRangeAudio', start: 1, end: 4, asset: asset('collaborator', 3) })
  for (const project of [second, { ...sharedProject(prepareSharedProject(second)), assets: second.assets }]) {
    expect(primaryTakes(project).map(a => a.id)).toEqual(['video'])
    expect(projectToExportJob(project).segments.map(s => s.input)).toEqual(projectToExportJob(original).segments.map(s => s.input))
    expect(project.tracks.find(t => t.id === 'voice_replacements')?.clips.map(c => [c.assetId, c.start, c.duration])).toEqual([['collaborator', 1, 3]])
    expect(sampleProgram(projectToExportJob(project), 3.99).voice.gain).toBe(0)
    expect(sampleProgram(projectToExportJob(project), 4).voice.gain).toBeGreaterThan(0)
  }
})
test('re-recording preserves ordinary audio and trims moved takes while respecting track locks', () => {
  const p = applyCommand(fixture(), { type: 'replaceRangeAudio', start: 1, end: 4, asset: asset('one', 3) })
  const voice = p.tracks.find(t => t.id === 'voice_replacements')!
  const oldTake = voice.clips[0]
  const music = { ...oldTake, id: 'music', replaceVoice: false, effect: 'none' as const }
  const moved = { ...voice, id: 'moved', clips: [{ ...oldTake, trackId: 'moved' }] }
  const project = { ...p, tracks: [...p.tracks.map(t => t === voice ? { ...t, clips: [music] } : t), moved] }
  const command = { type: 'replaceRangeAudio' as const, start: 2, end: 3, asset: asset('two', 1) }
  const next = applyCommand(project, command)
  expect(next.tracks.find(t => t.id === 'voice_replacements')?.clips.find(c => c.id === 'music')).toEqual(music)
  expect(next.tracks.find(t => t.id === 'moved')?.clips.map(c => [c.start, c.duration, c.inPoint])).toEqual([[1, 1, 0], [3, 1, 2]])
  expect(() => applyCommand({ ...project, tracks: project.tracks.map(t => t.id === 'moved' ? { ...t, locked: true } : t) }, command)).toThrow('Unlock')
})
test('recording slot uses edited playback time and refuses a stale duration', () => {
  const p = applyCommand(fixture(), { type: 'setSpeed', start: 2, end: 4, speed: 2 })
  expect(recordingSlot(p, 2, 4).duration).toBe(1)
  expect(() => applyCommand(p, { type: 'replaceRangeAudio', start: 2, end: 4, asset: asset('stale', 2) })).toThrow('timing changed')
  const next = applyCommand(p, { type: 'replaceRangeAudio', start: 2, end: 4, asset: asset('fits', 1) })
  expect(programLengthOf(next)).toBe(programLengthOf(p)); expect(resolveMediaSegments(next).find(s => s.inPoint === 2)?.speed).toBe(2)
})
