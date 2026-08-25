import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { projectToChapters } from './captions'
import { createDemoProject } from './demo'
import { nextTalkChapter, startSceneRename, toastForSceneRename } from './sceneRename'
import { useEditor } from '../store'

describe('chapter rename', () => {
  test('a new title points at YouTube chapters', () => {
    expect(toastForSceneRename('Thesis', 'Cut speech like text')).toMatch(/YouTube timestamps/)
    expect(toastForSceneRename('Thesis', 'Thesis')).toBeNull()
    expect(toastForSceneRename('Thesis', '  ')).toBeNull()
  })

  test('Enter on a heading names the next chapter even if the title stayed', () => {
    const demo = createDemoProject()
    const next = nextTalkChapter(demo, 'sc_intro')
    expect(next?.title).toBe('Walk the editor')
    expect(toastForSceneRename('Thesis', 'Thesis', next?.title)).toBe('“Walk the editor” is next — type it.')
    expect(toastForSceneRename('Thesis', 'The pitch', next?.title)).toBe(
      'Chapter renamed. “Walk the editor” is next — type it.'
    )
    expect(nextTalkChapter(demo, 'sc_end')).toBeUndefined()
  })

  test('renaming a heading updates the YouTube chapter list', () => {
    const next = applyCommand(createDemoProject(), {
      type: 'renameScene',
      sceneId: 'sc_intro',
      title: 'Cut speech like text'
    })
    expect(projectToChapters(next)).toMatch(/^0:00 Cut speech like text$/m)
  })

  test('startSceneRename selects the chapter', () => {
    useEditor.getState().loadProject(createDemoProject(), { clean: true })
    expect(startSceneRename('sc_intro').started).toBe(true)
    expect(useEditor.getState().selectedSceneId).toBe('sc_intro')
    expect(startSceneRename(null).started).toBe(true)
  })
})
