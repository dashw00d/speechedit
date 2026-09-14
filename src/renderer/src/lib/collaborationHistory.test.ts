import { beforeEach, expect, test } from 'bun:test'
import { useEditor } from '../store'
import { projectFromTake } from './importMedia'
import { wordsFromAsr } from './asr'
import { applyCommand } from './commands'

const editor = () => useEditor.getState()
beforeEach(() => {
  editor().loadProject(projectFromTake({
    asset: { id: 'source', name: 'Source.wav', path: '/local/source.wav', browserMediaKey: 'local-key', kind: 'audio', duration: 3, waveform: [] },
    words: wordsFromAsr([{ start: 0, end: 1, text: 'Hello there.' }, { start: 2, end: 3, text: 'Next chapter.' }]),
    whispered: null, analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
  }), { clean: true, persist: false })
})
const edit = (index: number, text: string) => editor().dispatch({ type: 'setWordText', wordId: editor().project.transcript.words[index].id, text })
const peerEdit = (index: number, text: string) => editor().applySharedProject(applyCommand(editor().project, { type: 'setWordText', wordId: editor().project.transcript.words[index].id, text }), true)
const word = (index: number) => editor().project.transcript.words[index].text

test('Undo and Redo reverse only local edits after repeated peer saves', () => {
  edit(0, 'Mine'); edit(1, 'Also mine')
  peerEdit(2, 'Peer'); peerEdit(3, 'Also peer')
  expect(editor().past).toHaveLength(2)
  editor().undo()
  expect(word(0)).toBe('Mine'); expect(word(1)).toBe('there.')
  expect(word(2)).toBe('Peer'); expect(word(3)).toBe('Also peer')
  editor().undo()
  expect(word(0)).toBe('Hello'); expect(word(2)).toBe('Peer')
  editor().redo(); editor().redo()
  expect(word(1)).toBe('Also mine'); expect(word(3)).toBe('Also peer')
  expect(editor().project.assets.source.browserMediaKey).toBe('local-key')
  expect(editor().dirty).toBe(true)
})

test('a peer save preserves an existing Redo branch', () => {
  edit(0, 'Mine'); editor().undo(); peerEdit(2, 'Peer')
  expect(editor().future).toHaveLength(1)
  editor().redo()
  expect(word(0)).toBe('Mine'); expect(word(2)).toBe('Peer')
})

test('Undo cannot resurrect an object deleted by a peer or overwrite a superseding peer edit', () => {
  edit(0, 'Mine'); peerEdit(0, 'Peer supersedes')
  editor().undo(); expect(word(0)).toBe('Peer supersedes')
  editor().redo(); expect(word(0)).toBe('Peer supersedes')
  editor().dispatch({ type: 'addTitle', start: 0, duration: 1, text: 'Local title' })
  const current = editor().project
  editor().applySharedProject({ ...current, tracks: current.tracks.map(t => ({ ...t, clips: t.clips.filter(c => c.text !== 'Local title') })) }, true)
  editor().undo(); editor().redo()
  expect(editor().project.tracks.flatMap(t => t.clips).some(c => c.text === 'Local title')).toBe(false)
})

test('a peer save during a grouped local edit is retained when the group is undone', () => {
  editor().beginHistoryGroup(); edit(0, 'Mine'); peerEdit(2, 'Peer'); edit(1, 'Also mine'); editor().endHistoryGroup()
  editor().undo()
  expect(word(0)).toBe('Hello'); expect(word(1)).toBe('there.'); expect(word(2)).toBe('Peer')
})
