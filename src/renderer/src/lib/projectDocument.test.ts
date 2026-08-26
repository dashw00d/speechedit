import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { createDemoProject, createEmptyProject } from './demo'
import {
  DOCUMENT_KIND,
  fileName,
  joinMediaPath,
  localMediaRefs,
  makeRecovery,
  missingMedia,
  openDocumentFromRaw,
  parseProjectDocument,
  parseRecovery,
  relativizeMediaPath,
  serializeDocument,
  siblingRelinkGuesses,
  shouldOfferRecovery,
  slimProjectForCache,
  suggestedDocumentName,
  withRelativizedAssets,
  withResolvedAssets
} from './projectDocument'

describe('project document portability', () => {
  test('relativizes media that lives under the project folder', () => {
    expect(relativizeMediaPath('/data/reel', '/data/reel/take.mp4')).toBe('take.mp4')
    expect(relativizeMediaPath('/data/reel', '/data/reel/media/a.wav')).toBe('media/a.wav')
    expect(relativizeMediaPath('/data/reel', '/mnt/other/take.mp4')).toBe('/mnt/other/take.mp4')
    expect(joinMediaPath('/data/reel', 'take.mp4')).toBe('/data/reel/take.mp4')
    expect(joinMediaPath('C:\\edits\\reel', 'media/a.wav')).toBe('C:\\edits\\reel\\media\\a.wav')
  })

  test('envelope round-trips relative paths and still parses legacy bare projects', () => {
    const demo = createEmptyProject('Talk')
    const project = {
      ...demo,
      assets: {
        src: {
          id: 'src',
          path: '/data/reel/take.mp4',
          name: 'take.mp4',
          kind: 'video' as const,
          duration: 12,
          waveform: [0.2],
          thumbnails: ['data:image/jpeg;base64,xxx'],
          proxyPath: '/data/reel/take.proxy.mp4'
        }
      }
    }
    const doc = serializeDocument(project, '/data/reel/talk.speechedit.json')
    expect(doc.kind).toBe(DOCUMENT_KIND)
    expect(doc.project.assets.src.path).toBe('take.mp4')
    expect(doc.project.assets.src.proxyPath).toBe('take.proxy.mp4')
    expect(doc.project.assets.src.waveform).toEqual([])
    expect(doc.project.assets.src.thumbnails).toBeUndefined()
    const opened = openDocumentFromRaw(doc, '/data/reel/talk.speechedit.json')
    expect(opened.project.assets.src.path).toBe('/data/reel/take.mp4')
    expect(opened.project.assets.src.proxyPath).toBe('/data/reel/take.proxy.mp4')

    const legacy = parseProjectDocument(createDemoProject())
    expect(legacy.version).toBe(0)
    expect(legacy.project.tracks.length).toBeGreaterThan(0)
    expect(() => parseProjectDocument({ nope: true })).toThrow(/Not a SpeechEdit project/)
  })

  test('slim cache drops file-backed looks and keeps demo waveforms', () => {
    const demo = createDemoProject()
    const fat = {
      ...demo,
      assets: {
        ...demo.assets,
        demo_src: { ...demo.assets.demo_src, thumbnails: ['data:image/jpeg;base64,abc'] },
        take: {
          id: 'take',
          path: '/data/reel/take.mp4',
          name: 'take.mp4',
          kind: 'video' as const,
          duration: 8,
          waveform: Array.from({ length: 1800 }, (_, i) => (i % 10) / 10),
          thumbnails: ['data:image/jpeg;base64,xxx']
        },
        still: {
          id: 'still',
          path: 'https://example.com/a.png',
          name: 'a.png',
          kind: 'image' as const,
          duration: 2,
          waveform: [0.5]
        }
      }
    }
    const slim = slimProjectForCache(fat)
    expect(slim.assets.demo_src.thumbnails).toBeUndefined()
    expect(slim.assets.demo_src.waveform.length).toBeGreaterThan(10)
    expect(slim.assets.take.thumbnails).toBeUndefined()
    expect(slim.assets.take.waveform).toEqual([])
    expect(slim.assets.still.waveform).toEqual([0.5])
    const recovery = makeRecovery(fat, { documentPath: null, lastSavedAt: null, dirty: true })
    expect(recovery.project.assets.demo_src.thumbnails).toBeUndefined()
    expect(recovery.project.assets.demo_src.waveform.length).toBeGreaterThan(10)
    expect(recovery.project.assets.take.waveform).toEqual([])
    const doc = serializeDocument(fat, '/data/reel/talk.speechedit.json')
    expect(JSON.stringify(doc.project.assets.take).length).toBeLessThan(
      JSON.stringify(fat.assets.take).length / 4
    )
  })

  test('recovery is offered only when unsaved work is newer than the last save', () => {
    const saved = createDemoProject()
    const edited = applyCommand(saved, { type: 'setName', name: 'Edited' })
    expect(
      shouldOfferRecovery(
        {
          kind: 'speechedit.recovery',
          version: 1,
          recoveredAt: edited.updatedAt,
          documentPath: '/tmp/talk.speechedit.json',
          lastSavedAt: saved.updatedAt,
          dirty: true,
          project: edited
        },
        { savedAt: saved.updatedAt, projectId: saved.id, path: '/tmp/talk.speechedit.json' }
      )
    ).toBe(true)
    expect(
      shouldOfferRecovery(
        {
          kind: 'speechedit.recovery',
          version: 1,
          recoveredAt: saved.updatedAt,
          documentPath: '/tmp/talk.speechedit.json',
          lastSavedAt: saved.updatedAt,
          dirty: false,
          project: saved
        },
        { savedAt: saved.updatedAt, projectId: saved.id }
      )
    ).toBe(false)
    expect(
      shouldOfferRecovery(
        {
          kind: 'speechedit.recovery',
          version: 1,
          recoveredAt: edited.updatedAt,
          documentPath: null,
          lastSavedAt: null,
          dirty: true,
          project: edited
        },
        null
      )
    ).toBe(false)
  })

  test('missing media ignores empty demo paths and http stills', () => {
    const demo = createDemoProject()
    expect(localMediaRefs(demo)).toEqual([])
    const withHttp = applyCommand(demo, {
      type: 'addBroll',
      start: 1,
      duration: 2,
      asset: {
        id: 'still',
        path: 'https://example.com/a.png',
        name: 'a.png',
        kind: 'image',
        duration: 2,
        waveform: []
      }
    })
    const withFile = {
      ...withHttp,
      assets: {
        ...withHttp.assets,
        staleBrowser: {
          id: 'staleBrowser',
          path: 'blob:http://127.0.0.1/stale',
          name: 'browser-take.mp4',
          kind: 'video' as const,
          duration: 4,
          waveform: []
        },
        take: {
          id: 'take',
          path: '/missing/take.mp4',
          name: 'take.mp4',
          kind: 'video' as const,
          duration: 4,
          waveform: []
        }
      }
    }
    expect(missingMedia(withFile, {
      'blob:http://127.0.0.1/stale': false,
      '/missing/take.mp4': false
    })).toEqual([
      { id: 'staleBrowser', name: 'browser-take.mp4', path: 'blob:http://127.0.0.1/stale' },
      { id: 'take', name: 'take.mp4', path: '/missing/take.mp4' }
    ])
    expect(missingMedia(withFile, () => true)).toEqual([])
  })

  test('sibling relink guesses other missing names in the picked folder', () => {
    expect(
      siblingRelinkGuesses('/new/bin/talk.mp4', [
        { id: 'a', name: 'talk.mp4', path: '/old/bin/talk.mp4' },
        { id: 'b', name: 'broll.mp4', path: '/old/bin/broll.mp4' },
        { id: 'c', name: 'music.wav', path: '/old/bin/music.wav' }
      ])
    ).toEqual([
      { id: 'b', path: '/new/bin/broll.mp4' },
      { id: 'c', path: '/new/bin/music.wav' }
    ])
    expect(siblingRelinkGuesses('talk.mp4', [{ id: 'b', name: 'broll.mp4', path: '/old/broll.mp4' }])).toEqual(
      []
    )
  })

  test('suggested name and file label stay portable', () => {
    expect(suggestedDocumentName(createEmptyProject('My Talk #2'))).toBe('My-Talk-2.speechedit.json')
    expect(fileName('/data/reel/talk.speechedit.json')).toBe('talk.speechedit.json')
  })

  test('legacy recovery files still unwrap', () => {
    const demo = createDemoProject()
    const recovery = parseRecovery(serializeDocument(demo))
    expect(recovery?.project.id).toBe(demo.id)
    expect(parseRecovery({ foo: 1 })).toBeNull()
  })

  test('relativize/resolve is a closed loop on a packed reel folder', () => {
    const project = {
      ...createEmptyProject('Packed'),
      assets: {
        a: {
          id: 'a',
          path: '/home/ryan/reel/media/take.mp4',
          name: 'take.mp4',
          kind: 'video' as const,
          duration: 8,
          waveform: []
        }
      }
    }
    const packed = withRelativizedAssets(project, '/home/ryan/reel')
    expect(packed.assets.a.path).toBe('media/take.mp4')
    expect(withResolvedAssets(packed, '/home/ryan/reel').assets.a.path).toBe(
      '/home/ryan/reel/media/take.mp4'
    )
  })
})
