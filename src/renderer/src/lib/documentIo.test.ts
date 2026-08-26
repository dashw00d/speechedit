import { afterEach, describe, expect, test } from 'bun:test'
import { host } from '../host'
import { flushWorkspace, useEditor } from '../store'
import { createDemoProject } from './demo'
import { discardRecovery, hydrateWorkspace, restoreRecovery } from './documentIo'
import { parseRecovery, serializeDocument, type RecoveryRecord } from './projectDocument'

function stubHost(partial: Partial<typeof host>): () => void {
  const keys = Object.keys(partial) as (keyof typeof host)[]
  const prev = Object.fromEntries(keys.map((key) => [key, host[key]])) as Partial<typeof host>
  Object.assign(host, partial)
  return () => Object.assign(host, prev)
}

describe('crash recovery through hydrate', () => {
  let restore = () => undefined as void
  afterEach(() => {
    restore()
    useEditor.getState().setRecoveryOffer(null)
  })

  test('unsaved edits survive a restart banner without wiping the recovery file', async () => {
    const saved = createDemoProject()
    const path = '/tmp/se-crash.speechedit.json'
    const disk: {
      recovery: RecoveryRecord | null
      session: { lastDocumentPath: string | null; lastSavedAt: number | null }
      file: unknown
    } = {
      recovery: null,
      session: { lastDocumentPath: path, lastSavedAt: saved.updatedAt },
      file: serializeDocument(saved, path)
    }

    restore = stubHost({
      syncWorkspace: async (payload) => {
        disk.recovery = parseRecovery(payload.recovery)
        const session = payload.session as { lastDocumentPath?: string | null; lastSavedAt?: number | null }
        disk.session = {
          lastDocumentPath: session.lastDocumentPath ?? path,
          lastSavedAt: session.lastSavedAt ?? saved.updatedAt
        }
        return ''
      },
      readRecovery: async () => disk.recovery,
      readSession: async () => disk.session,
      readProject: async () => ({ path, project: disk.file }),
      clearRecovery: async () => {
        disk.recovery = null
      },
      mediaExists: async (paths) => paths.map((item) => ({ path: item, exists: true })),
      waveform: async () => [],
      thumbnails: async () => [],
      makeProxy: async () => '',
      probe: async () => ({ duration: 8, hasVideo: true, hasAudio: true })
    })

    useEditor.getState().loadProject(saved, { path, clean: true, lastSavedAt: saved.updatedAt })
    useEditor.getState().dispatch({ type: 'setName', name: 'After crash' })
    expect(useEditor.getState().dirty).toBe(true)
    flushWorkspace()
    await Bun.sleep(40)
    expect(disk.recovery?.dirty).toBe(true)
    expect(disk.recovery?.project.name).toBe('After crash')

    const hydrated = await hydrateWorkspace()
    expect(hydrated).toEqual({ source: 'saved', recovery: true })
    expect(useEditor.getState().project.name).toBe(saved.name)
    expect(useEditor.getState().recoveryOffer?.project.name).toBe('After crash')
    expect(parseRecovery(disk.recovery)?.project.name).toBe('After crash')
    expect(parseRecovery(disk.recovery)?.dirty).toBe(true)

    await restoreRecovery()
    expect(useEditor.getState().project.name).toBe('After crash')
    expect(useEditor.getState().recoveryOffer).toBeNull()
    expect(useEditor.getState().dirty).toBe(true)
  })

  test('discard keeps the last save and clears recovery', async () => {
    const saved = createDemoProject()
    const path = '/tmp/se-crash-discard.speechedit.json'
    const edited = { ...saved, name: 'Unsaved take', updatedAt: saved.updatedAt + 1000 }
    const disk: { recovery: RecoveryRecord | null } = {
      recovery: {
        kind: 'speechedit.recovery',
        version: 1,
        recoveredAt: edited.updatedAt,
        documentPath: path,
        lastSavedAt: saved.updatedAt,
        dirty: true,
        project: edited
      }
    }

    restore = stubHost({
      syncWorkspace: async () => '',
      readRecovery: async () => disk.recovery,
      readSession: async () => ({ lastDocumentPath: path, lastSavedAt: saved.updatedAt }),
      readProject: async () => ({ path, project: serializeDocument(saved, path) }),
      clearRecovery: async () => {
        disk.recovery = null
      },
      mediaExists: async (paths) => paths.map((item) => ({ path: item, exists: true })),
      waveform: async () => [],
      thumbnails: async () => [],
      makeProxy: async () => ''
    })

    const hydrated = await hydrateWorkspace()
    expect(hydrated.recovery).toBe(true)
    await discardRecovery()
    expect(useEditor.getState().project.name).toBe(saved.name)
    expect(useEditor.getState().recoveryOffer).toBeNull()
    expect(disk.recovery).toBeNull()
  })
})
