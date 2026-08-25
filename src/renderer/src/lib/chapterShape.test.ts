import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { describeChapterMerge, mergeChapterFromContext, splitChapterFromContext } from './chapterShape'
import { useEditor, usePlayback } from '../store'
import { sourceToProgramOf } from './resolver'

describe('chapter split and merge', () => {
  test('split at the playhead makes a continuation and asks for a name', () => {
    const demo = createDemoProject()
    const scene = demo.scenes[0]
    useEditor.getState().loadProject(demo, { clean: true })
    usePlayback.getState().seekProgram(sourceToProgramOf(demo, (scene.start + scene.end) / 2))
    const result = splitChapterFromContext(scene.id)
    expect(result.split).toBe(true)
    expect(result.toast).toMatch(/Type the new heading/)
    const project = useEditor.getState().project
    expect(project.scenes.length).toBe(demo.scenes.length + 1)
    expect(project.scenes.some((row) => row.title.endsWith('(cont.)'))).toBe(true)
    expect(useEditor.getState().selectedSceneId).not.toBe(scene.id)
  })

  test('split uses a selected word when the playhead is on the edge', () => {
    const demo = createDemoProject()
    const scene = demo.scenes[0]
    const mid = demo.transcript.words.find((w) => w.start > scene.start + 0.5 && w.end < scene.end - 0.5)
    expect(mid).toBeTruthy()
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectWords([mid!.id])
    usePlayback.getState().seekProgram(sourceToProgramOf(demo, scene.start))
    const result = splitChapterFromContext(scene.id)
    expect(result.split).toBe(true)
    const created = useEditor.getState().project.scenes.find((row) => row.title.endsWith('(cont.)'))
    expect(created?.start).toBeCloseTo(mid!.start, 2)
  })

  test('split at the edge asks to park inside', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    usePlayback.getState().seekProgram(sourceToProgramOf(demo, demo.scenes[0].start))
    const result = splitChapterFromContext(demo.scenes[0].id)
    expect(result.split).toBe(false)
    expect(result.toast).toMatch(/Park on the line/)
    expect(useEditor.getState().project.scenes.length).toBe(demo.scenes.length)
  })

  test('split finds the chapter under the playhead without a selected heading', () => {
    const demo = createDemoProject()
    const scene = demo.scenes[0]
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene(null)
    usePlayback.getState().seekProgram(sourceToProgramOf(demo, (scene.start + scene.end) / 2))
    const result = splitChapterFromContext()
    expect(result.split).toBe(true)
    expect(useEditor.getState().project.scenes.length).toBe(demo.scenes.length + 1)
  })

  test('a heading highlight does not steal a playhead split inside the chapter', () => {
    const demo = createDemoProject()
    const scene = demo.scenes[0]
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene(scene.id)
    usePlayback.getState().seekProgram(sourceToProgramOf(demo, (scene.start + scene.end) / 2))
    const result = splitChapterFromContext()
    expect(result.split).toBe(true)
    expect(useEditor.getState().project.scenes.length).toBe(demo.scenes.length + 1)
  })

  test('split finds the chapter under a selected word', () => {
    const demo = createDemoProject()
    const scene = demo.scenes[0]
    const mid = demo.transcript.words.find((w) => w.start > scene.start + 0.5 && w.end < scene.end - 0.5)
    expect(mid).toBeTruthy()
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene(null)
    useEditor.getState().selectWords([mid!.id])
    usePlayback.getState().seekProgram(0)
    const result = splitChapterFromContext()
    expect(result.split).toBe(true)
    const created = useEditor.getState().project.scenes.find((row) => row.title.endsWith('(cont.)'))
    expect(created?.start).toBeCloseTo(mid!.start, 2)
  })

  test('merge joins neighbors, hears the card, and names Copy chapters', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const first = demo.scenes[0]
    const next = demo.scenes[1]
    const result = mergeChapterFromContext(1, first.id)
    expect(result.merged).toBe(true)
    expect(result.toast).toBe(describeChapterMerge(first.title, next.title))
    expect(result.toast).toMatch(/Hear it, or Copy chapters/)
    const project = useEditor.getState().project
    expect(project.scenes.length).toBe(demo.scenes.length - 1)
    expect(project.scenes.find((row) => row.id === first.id)?.end).toBeCloseTo(next.end, 5)
    const play = usePlayback.getState()
    expect(play.playing).toBe(true)
    expect(play.loopFrom).toBeCloseTo(sourceToProgramOf(project, first.start), 2)
    expect(play.playUntil).toBeCloseTo(sourceToProgramOf(project, next.end), 2)
  })

  test('merge finds the chapter under a selected word without a heading', () => {
    const demo = createDemoProject()
    const walk = demo.scenes.find((row) => row.title === 'Walk the editor')!
    const word = demo.transcript.words.find((row) => row.start > walk.start + 0.3 && row.end < walk.end - 0.3)
    expect(word).toBeTruthy()
    useEditor.getState().loadProject(demo, { clean: true })
    useEditor.getState().selectScene(null)
    useEditor.getState().selectWords([word!.id])
    usePlayback.getState().seekProgram(0)
    const result = mergeChapterFromContext(-1)
    expect(result.merged).toBe(true)
    expect(result.toast).toMatch(/Hear it, or Copy chapters/)
    expect(useEditor.getState().project.scenes.length).toBe(demo.scenes.length - 1)
  })
})
