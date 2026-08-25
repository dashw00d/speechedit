import { describe, expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { findInTranscript } from './transcriptFind'

describe('transcript find', () => {
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

  test('finds pending suggestions by label', () => {
    const project = createDemoProject()
    const hit = findInTranscript(project, project.transcript.words, 'normalize')
    expect(hit?.kind).toBe('suggestion')
    if (hit?.kind === 'suggestion') expect(hit.suggestion.id).toBe('sug_norm')
  })
})
