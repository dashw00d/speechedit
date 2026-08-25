import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { findInTranscript, findWordGroups, replacePlan } from './transcriptFind'

describe('transcript find', () => {
  test('groups repeated words so find can step through them', () => {
    const project = createDemoProject()
    const groups = findWordGroups(project.transcript.words, 'the')
    expect(groups.length).toBeGreaterThan(1)
    expect(groups.every((group) => group.length === 1)).toBe(true)
    const hit = findInTranscript(project, project.transcript.words, 'the')
    expect(hit?.kind).toBe('words')
    if (hit?.kind === 'words') expect(hit.matchGroups).toBe(groups.length)
  })

  test('matches transcript phrases first', () => {
    const project = createDemoProject()
    const hit = findInTranscript(project, project.transcript.words, 'filler')
    expect(hit?.kind).toBe('words')
    if (hit?.kind === 'words') expect(hit.ids.length).toBeGreaterThan(0)
  })

  test('finds scenes by title when no word match', () => {
    const project = createDemoProject()
    const hit = findInTranscript(project, project.transcript.words, 'false take')
    expect(hit?.kind).toBe('scene')
    if (hit?.kind === 'scene') expect(hit.scene.id).toBe('sc_false')
  })

  test('replace plan keeps timing words blank after the first hit', () => {
    const project = createDemoProject()
    const groups = findWordGroups(project.transcript.words, 'you know')
    expect(groups.length).toBeGreaterThan(0)
    const pairs = replacePlan(project.transcript.words, 'you know', 'yeah', groups.slice(0, 1))
    expect(pairs[0]?.text).toBe('yeah')
    expect(pairs.slice(1).every((pair) => pair.text === '')).toBe(true)
  })

  test('finds pending suggestions by label', () => {
    const project = createDemoProject()
    const hit = findInTranscript(project, project.transcript.words, 'normalize')
    expect(hit?.kind).toBe('suggestion')
    if (hit?.kind === 'suggestion') expect(hit.suggestion.id).toBe('sug_norm')
  })
})
