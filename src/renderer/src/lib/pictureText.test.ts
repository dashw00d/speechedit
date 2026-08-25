import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject } from './demo'
import { addSceneLowerThirdsFromContext } from './lowerThird'
import {
  chapterNameCards,
  commitPictureText,
  describeChapterNameAdvance,
  pictureTextDraft,
  pictureTextPlaceholder,
  startPictureTextEdit
} from './pictureText'
import { useEditor, usePlayback } from '../store'

describe('picture text', () => {
  test('placeholder Title and Name start empty so the first keystroke is the line', () => {
    expect(pictureTextDraft('Title')).toBe('')
    expect(pictureTextDraft('Name')).toBe('')
    expect(pictureTextDraft('Sprint 14')).toBe('Sprint 14')
    expect(pictureTextDraft('Thesis\nCut speech like text — the pitch.')).toBe('Thesis')
    expect(pictureTextPlaceholder({ text: 'Title', style: { position: 'center', fontSize: 64 } })).toBe(
      'Type the subject'
    )
    expect(pictureTextPlaceholder({ text: 'Name', style: { position: 'lower' } })).toBe('Type the name')
  })

  test('commitPictureText writes the subject and names the picture', () => {
    const titled = applyCommand(createDemoProject(), {
      type: 'addTitle',
      start: 0,
      duration: 3,
      text: 'Title',
      preset: 'title'
    })
    const clip = titled.tracks.flatMap((track) => track.clips).find((row) => row.text === 'Title')
    expect(clip).toBeTruthy()
    useEditor.getState().loadProject(titled, { clean: true })
    useEditor.getState().selectClip(clip!.id)
    const { toast } = commitPictureText(clip!.id, '  Sprint 14  ')
    expect(toast).toMatch(/^Title on the picture/)
    const next = useEditor
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((row) => row.id === clip!.id)
    expect(next?.text).toBe('Sprint 14')
  })

  test('startPictureTextEdit parks on the card', () => {
    const titled = applyCommand(createDemoProject(), {
      type: 'addTitle',
      start: 0,
      duration: 3,
      text: 'Title',
      preset: 'title'
    })
    const clip = titled.tracks.flatMap((track) => track.clips).find((row) => row.text === 'Title')
    useEditor.getState().loadProject(titled, { clean: true })
    usePlayback.getState().seekProgram(20)
    const { started } = startPictureTextEdit(clip!.id)
    expect(started).toBe(true)
    expect(usePlayback.getState().programTime).toBeCloseTo(0.2)
    expect(usePlayback.getState().playing).toBe(false)
  })

  test('Enter on a chapter name opens the next heading, even if the text stayed', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    addSceneLowerThirdsFromContext()
    const cards = chapterNameCards(useEditor.getState().project)
    expect(cards.length).toBeGreaterThan(2)
    expect(cards[0]?.text).toMatch(/^Thesis/)
    const { toast, nextClipId } = commitPictureText(cards[0]!.id, cards[0]!.text ?? '')
    expect(nextClipId).toBe(cards[1]!.id)
    expect(toast).toBe(describeChapterNameAdvance(cards[1]!.text ?? '', false))
    expect(toast).toMatch(/Walk the editor/)
    expect(useEditor.getState().selectedClipId).toBe(cards[1]!.id)
  })

  test('the last chapter name keeps the card so Fill stays', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    addSceneLowerThirdsFromContext()
    const cards = chapterNameCards(useEditor.getState().project)
    const last = cards[cards.length - 1]!
    const { toast, nextClipId } = commitPictureText(last.id, 'Close the reel')
    expect(nextClipId).toBeNull()
    expect(toast).toMatch(/Apply style/)
    expect(useEditor.getState().selectedClipId).toBe(last.id)
    const written = useEditor
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === last.id)
    expect(written?.text).toMatch(/^Close the reel/)
  })
})
