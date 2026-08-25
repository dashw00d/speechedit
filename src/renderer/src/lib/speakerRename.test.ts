import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { projectToTranscriptMd } from './captions'
import { createDemoProject } from './demo'
import {
  assignSpeakerFromContext,
  describeSpeakerAssign,
  describeSpeakerRename,
  nextSpeaker,
  removeSpeakerFromContext,
  speakerContextActions,
  speakerIdFromSelection,
  startSpeakerRename,
  toastForSpeakerRename
} from './speakerRename'
import { useEditor, usePlayback } from '../store'

describe('speaker rename', () => {
  test('a new name points at Copy notes, or the next voice', () => {
    expect(toastForSpeakerRename('Speaker 1', 'Alex')).toMatch(/Copy notes/)
    expect(toastForSpeakerRename('Ryan', 'Alex', 'Guest')).toBe(describeSpeakerRename('Guest'))
    expect(toastForSpeakerRename('Ryan', 'Ryan')).toBeNull()
    expect(toastForSpeakerRename('Ryan', 'Ryan', 'Guest')).toBe(describeSpeakerRename('Guest', false))
    expect(toastForSpeakerRename('Ryan', '  ')).toBeNull()
  })

  test('nextSpeaker walks voices in list order', () => {
    const demo = createDemoProject()
    const withGuest = applyCommand(demo, { type: 'addSpeaker', name: 'Guest' })
    const guest = withGuest.transcript.speakers.find((row) => row.name === 'Guest')!
    expect(nextSpeaker(withGuest, 'ryan')?.id).toBe(guest.id)
    expect(nextSpeaker(withGuest, guest.id)).toBeUndefined()
  })

  test('renaming a speaker updates the markdown transcript', () => {
    const next = applyCommand(createDemoProject(), {
      type: 'renameSpeaker',
      speakerId: 'ryan',
      name: 'Alex'
    })
    expect(projectToTranscriptMd(next)).toMatch(/^## Alex$/m)
  })

  test('selection of one speaker, or a single-speaker reel, is enough to rename', () => {
    const demo = createDemoProject()
    expect(speakerIdFromSelection([], demo.transcript.words, demo.transcript.speakers)).toBe('ryan')
    expect(speakerIdFromSelection([demo.transcript.words[0]!.id], demo.transcript.words, demo.transcript.speakers)).toBe(
      'ryan'
    )
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords([demo.transcript.words[0]!.id])
    expect(startSpeakerRename().started).toBe(true)
    expect(startSpeakerRename('missing').started).toBe(false)
  })

  test('removing a speaker moves their words to the remaining voice', () => {
    const demo = createDemoProject()
    const withGuest = applyCommand(demo, { type: 'addSpeaker', name: 'Guest' })
    const guest = withGuest.transcript.speakers.find((row) => row.name === 'Guest')!
    const assigned = applyCommand(withGuest, {
      type: 'setSpeaker',
      wordIds: [demo.transcript.words[0]!.id],
      speakerId: guest.id
    })
    const next = applyCommand(assigned, { type: 'removeSpeaker', speakerId: guest.id })
    expect(next.transcript.speakers.map((row) => row.name)).toEqual(['Ryan'])
    expect(next.transcript.words[0]!.speaker).toBe('ryan')
    const blocked = applyCommand(demo, { type: 'removeSpeaker', speakerId: 'ryan' })
    expect(blocked.transcript.speakers).toHaveLength(1)
    expect(blocked.transcript.speakers[0]!.id).toBe('ryan')
  })

  test('remove from context explains where the words went', () => {
    const demo = createDemoProject()
    const withGuest = applyCommand(demo, { type: 'addSpeaker', name: 'Guest' })
    const guest = withGuest.transcript.speakers.find((row) => row.name === 'Guest')!
    useEditor.getState().loadProject(withGuest, { clean: true })
    expect(removeSpeakerFromContext(guest.id)).toEqual({
      toast: 'Removed Guest.',
      removed: true
    })
    expect(useEditor.getState().project.transcript.speakers).toHaveLength(1)
    useEditor.getState().loadProject(demo, { clean: true })
    expect(removeSpeakerFromContext('ryan').toast).toMatch(/at least one/)
  })

  test('right-click actions rename or remove, and the last voice stays', () => {
    expect(speakerContextActions([{ id: 'ryan', name: 'Ryan' }], 'ryan').map((row) => row.id)).toEqual([
      'rename',
      'remove'
    ])
    expect(speakerContextActions([{ id: 'ryan', name: 'Ryan' }], 'ryan').find((row) => row.id === 'remove')?.disabled).toBe(
      true
    )
    const removeGuest = speakerContextActions(
      [
        { id: 'ryan', name: 'Ryan' },
        { id: 'guest', name: 'Guest' }
      ],
      'guest'
    ).find((row) => row.id === 'remove')
    expect(removeGuest?.hint).toBe('Their words go to Ryan.')
    expect(removeGuest?.disabled).toBeUndefined()
  })
})

describe('assign speaker', () => {
  test('gives the selected words to that voice and hears them', () => {
    const demo = createDemoProject()
    const withGuest = applyCommand(demo, { type: 'addSpeaker', name: 'Guest' })
    const guest = withGuest.transcript.speakers.find((row) => row.name === 'Guest')!
    const ids = [demo.transcript.words[0]!.id]
    useEditor.getState().loadProject(withGuest, { clean: true })
    useEditor.getState().selectWords(ids)
    const result = assignSpeakerFromContext(guest.id)
    expect(result.assigned).toBe(true)
    expect(result.toast).toBe(describeSpeakerAssign('Guest', 1))
    expect(useEditor.getState().project.transcript.words[0]!.speaker).toBe(guest.id)
    expect(usePlayback.getState().playing).toBe(true)
  })

  test('a no-op assign stays quiet', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords([demo.transcript.words[0]!.id])
    const result = assignSpeakerFromContext('ryan')
    expect(result.assigned).toBe(false)
    expect(result.toast).toBe('')
  })

  test('without words asks to select first', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    useEditor.getState().selectWords([])
    const result = assignSpeakerFromContext('ryan')
    expect(result.assigned).toBe(false)
    expect(result.toast).toMatch(/Select the words/)
  })
})
