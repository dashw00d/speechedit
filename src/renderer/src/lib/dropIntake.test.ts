import { describe, expect, test } from 'bun:test'
import { classifyDrop, refineJsonKind } from './dropIntake'
import { canReopenRecent, forgetRecent, listRecents, recentWhen, rememberRecent } from './recents'
import { wordsFromPlainText, parseAnyTranscript } from './transcript'

describe('drop intake', () => {
  test('classifies media, transcripts, projects, and timelines by name', () => {
    expect(classifyDrop('talk.mp4', 'video/mp4')).toBe('media')
    expect(classifyDrop('voice.wav')).toBe('media')
    expect(classifyDrop('captions.srt')).toBe('transcript')
    expect(classifyDrop('notes.txt')).toBe('transcript')
    expect(classifyDrop('reel.speechedit.json')).toBe('project')
    expect(classifyDrop('cut.otio')).toBe('interchange')
    expect(classifyDrop('seq.fcpxml')).toBe('interchange')
    expect(classifyDrop('readme.md')).toBe('unknown')
  })

  test('JSON payload decides project vs Auto-Editor vs transcript', () => {
    expect(refineJsonKind({ kind: 'speechedit.project', project: {} })).toBe('project')
    expect(refineJsonKind({ chunks: [[0, 1, 1]] })).toBe('interchange')
    expect(refineJsonKind({ words: [{ text: 'Hi', start: 0, end: 1 }] })).toBe('transcript')
  })
})

describe('recent documents', () => {
  test('keeps newest first, skips blob URLs, forgets a path', () => {
    const first = rememberRecent('/data/a.speechedit.json', 'A', 1, [])
    const next = rememberRecent('/data/b.speechedit.json', 'B', 2, first)
    const again = rememberRecent('/data/a.speechedit.json', 'A', 3, next)
    expect(again.map((r) => r.path)).toEqual(['/data/a.speechedit.json', '/data/b.speechedit.json'])
    expect(canReopenRecent('download.json')).toBe(false)
    expect(rememberRecent('download.json', 'x', 1, again)).toEqual(again)
    expect(forgetRecent('/data/a.speechedit.json', again).map((r) => r.path)).toEqual([
      '/data/b.speechedit.json'
    ])
    expect(listRecents('not-json')).toEqual([])
    expect(recentWhen(0)).toBe('Saved reel')
    expect(recentWhen(1_000, 1_000)).toBe('Today')
    expect(recentWhen(1_000, 1_000 + 86_400_000)).toBe('Yesterday')
  })
})

describe('plain transcript drop', () => {
  test('txt without cues becomes timed words', () => {
    const words = parseAnyTranscript('notes.txt', 'Hello there world')
    expect(words.map((w) => w.text)).toEqual(['Hello', 'there', 'world'])
    expect(words[0].start).toBe(0)
    expect(words[2].end).toBeCloseTo(1.05)
    expect(wordsFromPlainText('  one   two  ').length).toBe(2)
  })
})
