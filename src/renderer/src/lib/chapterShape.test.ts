import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { mergeChapterFromContext, splitChapterFromContext } from './chapterShape'
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
    expect(result.toast).toMatch(/Park inside/)
    expect(useEditor.getState().project.scenes.length).toBe(demo.scenes.length)
  })

  test('merge joins neighbors and points at YouTube chapters', () => {
    const demo = createDemoProject()
    useEditor.getState().loadProject(demo, { clean: true })
    const first = demo.scenes[0]
    const next = demo.scenes[1]
    const result = mergeChapterFromContext(1, first.id)
    expect(result.merged).toBe(true)
    expect(result.toast).toMatch(/Chapters copies/)
    const project = useEditor.getState().project
    expect(project.scenes.length).toBe(demo.scenes.length - 1)
    expect(project.scenes.find((row) => row.id === first.id)?.end).toBeCloseTo(next.end, 5)
  })
})
