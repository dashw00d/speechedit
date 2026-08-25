import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { projectToTranscriptMd } from './captions'
import { createDemoProject } from './demo'
import { speakerIdFromSelection, startSpeakerRename, toastForSpeakerRename } from './speakerRename'
import { useEditor } from '../store'

describe('speaker rename', () => {
  test('a new name points at the transcript export', () => {
    expect(toastForSpeakerRename('Speaker 1', 'Alex')).toMatch(/Copy notes/)
    expect(toastForSpeakerRename('Ryan', 'Ryan')).toBeNull()
    expect(toastForSpeakerRename('Ryan', '  ')).toBeNull()
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
})
