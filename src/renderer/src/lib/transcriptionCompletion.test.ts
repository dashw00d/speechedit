import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { projectFromTake, fillImportedTake, importedWordsCommands, type InspectedTake } from './importMedia'
import { wordsFromAsr } from './asr'
import { wordsFromIslands } from './transcript'
import { importMediaFromPath } from './fileActions'
import { transcribeCurrentRecording } from './transcribeAction'
import { host } from '../host'
import { useEditor } from '../store'

const cues = [{ start: 0, end: 2, text: 'Welcome to this recording.' }, { start: 6, end: 8, text: 'Now a different chapter.' }]
const take: InspectedTake = {
  asset: { id: 'source', path: '/tmp/chapters.wav', name: 'chapters.wav', kind: 'audio', duration: 10, waveform: [], sourceOffset: 0 },
  words: wordsFromAsr(cues), whispered: cues,
  analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
}
const empty = () => projectFromTake({ ...take, words: [], whispered: null })

describe('transcription completion', () => {
  test('final result creates chapters even when the same words already arrived through progress', () => {
    const partial = importedWordsCommands(empty(), take).reduce(applyCommand, empty())
    expect(partial.transcript.words.length).toBeGreaterThan(0)
    expect(partial.scenes).toHaveLength(0)
    const final = fillImportedTake(partial, take)
    expect(final.scenes).toHaveLength(2)
    expect(final.scenes[0].title).toContain('Welcome')
    const repeated = fillImportedTake(final, take)
    expect(repeated.scenes).toEqual(final.scenes)
  })
  test('preserves manual chapters and fills only uncovered speech', () => {
    const project = { ...empty(), scenes: [{ id: 'manual', start: 0, end: 3, title: 'My opening', summary: '', kind: 'talk' as const }] }
    const final = fillImportedTake(project, take)
    expect(final.scenes[0]).toEqual(project.scenes[0])
    expect(final.scenes).toHaveLength(2)
    expect(final.scenes[1].start).toBe(6)
  })
  test('placeholder regions are not treated as spoken chapters', () => {
    const final = fillImportedTake(empty(), { ...take, words: wordsFromIslands([{ start: 0, end: 10 }]), whispered: null })
    expect(final.scenes).toHaveLength(0)
  })
  test('finishing a later take keeps earlier chapters and offsets its new chapters', () => {
    const first = projectFromTake(take)
    const second = { ...take, asset: { ...take.asset, id: 'second', sourceOffset: 10 } }
    const project = { ...first, sourceDuration: 20, assets: { ...first.assets, second: second.asset } }
    const final = fillImportedTake(project, second)
    expect(final.scenes.slice(0, 2)).toEqual(first.scenes)
    expect(final.scenes.slice(2).map(scene => scene.start)).toEqual([10, 16])
  })
  test('browser-style import automatically transcribes and creates chapters after empty media analysis', async () => {
    const saved = { ...host }
    let calls = 0
    Object.assign(host, {
      probe: async () => ({ duration: 10, hasAudio: true, hasVideo: false }),
      waveform: async () => [], thumbnails: async () => [], makeProxy: async () => '',
      analyze: async () => take.analysis,
      transcribe: async () => { calls++; return cues }
    })
    useEditor.getState().loadProject(empty())
    useEditor.getState().setAnalyzing(null)
    useEditor.getState().setExporting(false)
    try {
      await importMediaFromPath('/tmp/chapters.wav', () => undefined)
      expect(calls).toBe(1)
      expect(useEditor.getState().project.scenes.length).toBeGreaterThan(0)
      expect(useEditor.getState().analyzing).toBeNull()
    } finally { Object.assign(host, saved) }
  })
  test('manual Transcribe creates words and chapters in one undo, and discards results after a project change', async () => {
    const saved = host.transcribe
    const project = empty()
    useEditor.getState().loadProject(project)
    host.transcribe = async () => cues
    try {
      await transcribeCurrentRecording(() => undefined)
      expect(useEditor.getState().project.scenes).toHaveLength(2)
      useEditor.getState().undo()
      expect(useEditor.getState().project.transcript.words).toHaveLength(0)
      expect(useEditor.getState().project.scenes).toHaveLength(0)
      host.transcribe = async () => { useEditor.getState().newProject(); return cues }
      await transcribeCurrentRecording(() => undefined)
      expect(useEditor.getState().project.transcript.words).toHaveLength(0)
    } finally { host.transcribe = saved }
  })
})
