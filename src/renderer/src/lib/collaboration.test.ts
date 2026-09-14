import { resolveSegments } from './resolver'
import { buildExportJob } from './exportJob'
import { validateExportJob } from './exportGraph'
import { describe, test, expect } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { createReviewHandler } from '../../../../scripts/review-server'
import { prepareSharedProject, sharedProject, mergeSharedProjects } from '../../../shared/collaboration'
import { projectFromTake } from './importMedia'
import { wordsFromAsr } from './asr'
import { applyCommand } from './commands'
import { snapshotForReview } from './reviewProject'
import { replaceAudioRange } from './replaceAudio'

const fixture = () => projectFromTake({
  asset: { id: 'source', name: 'Source.wav', path: '/private/original.wav', browserMediaKey: 'private-key', kind: 'audio', duration: 3, waveform: [], sourceOffset: 0 },
  words: wordsFromAsr([{ start: 0.2, end: 1, text: 'Hello there.' }, { start: 2, end: 2.8, text: 'Next chapter.' }]), whispered: null,
  analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
})
describe('shared editing document', () => {
  test('preview-only projects cannot render until originals are relinked', () => {
    const project = fixture(); project.assets.source.proxyOnly = true
    expect(validateExportJob(buildExportJob(project, '/tmp/final.mp4')!)).toContain('Relink the original recording')
    const linked = applyCommand(project, { type: 'relinkAsset', assetId: 'source', path: '/local/new-original.wav' })
    expect(linked.assets.source.proxyOnly).toBe(false)
    expect(validateExportJob(buildExportJob(linked, '/tmp/final.mp4')!)).toBeNull()
  })
  test('full editor state survives sanitization while local file references do not', () => {
    let p = fixture()
    p = applyCommand(p, { type: 'addTitle', start: 0, duration: 2, text: 'My title' })
    p = applyCommand(p, { type: 'setPicture', transform: { scale: 1.4 } })
    p = applyCommand(p, { type: 'setSegmentStyle', segmentId: resolveSegments(p)[0].id, patch: { volume: 0.6 } })
    const safe = prepareSharedProject(p)
    expect(safe.tracks).toEqual(p.tracks); expect(safe.styles).toEqual(p.styles); expect(safe.picture.scale).toBe(1.4)
    expect(JSON.stringify(safe)).not.toContain('/private'); expect(JSON.stringify(safe)).not.toContain('private-key')
    expect(() => sharedProject({ ...safe, tracks: [{ ...safe.tracks[0], clips: [{ ...safe.tracks[0].clips[0], assetId: 'missing' }] }] })).toThrow('reference')
    expect(() => sharedProject({ ...safe, fps: Infinity })).toThrow()
  })
  test('independent editorial changes merge and overlapping changes require a decision', () => {
    const base = prepareSharedProject(fixture())
    const mine = applyCommand(base, { type: 'setWordText', wordId: base.transcript.words[0].id, text: 'Welcome' })
    const theirs = applyCommand(base, { type: 'setPicture', transform: { scale: 1.2 } })
    const result = mergeSharedProjects(base, mine, theirs)
    expect(result.conflicts).toEqual([]); expect(result.project.picture.scale).toBe(1.2); expect(result.project.transcript.words[0].text).toBe('Welcome')
    const conflict = mergeSharedProjects(base, mine, applyCommand(base, { type: 'setWordText', wordId: base.transcript.words[0].id, text: 'Goodbye' }))
    expect(conflict.conflicts.some(p => p.includes('.text'))).toBe(true)
    expect(conflict.project.transcript.words[0].text).toBe('Welcome')
  })
  test('first recordings merge separate slots but preserve overlap, settings and deletion conflicts', () => {
    const base = prepareSharedProject(fixture())
    const record = (start: number, end: number, id: string) => replaceAudioRange(base, start, end,
      { id, name: id, path: `/private/${id}.wav`, kind: 'audio', duration: end - start, waveform: [], isRecording: true })
    const a = record(0, 1, 'take-a'), b = record(1, 2, 'take-b')
    const voice = (p: typeof base) => p.tracks.find(t => t.id === 'voice_replacements')!
    const before = JSON.stringify([base, a, b])
    for (const [local, remote] of [[a, b], [b, a]]) {
      const result = mergeSharedProjects(base, local, remote)
      expect(result.conflicts).toEqual([])
      expect(voice(result.project).clips.map(c => c.assetId)).toEqual(['take-a', 'take-b'])
      expect(() => sharedProject(result.project)).not.toThrow()
    }
    expect(JSON.stringify([base, a, b])).toBe(before)
    const overlap = record(0.5, 1.5, 'overlap')
    for (const [local, remote] of [[a, overlap], [overlap, a]]) {
      expect(mergeSharedProjects(base, local, remote).conflicts).toContain('tracks[voice_replacements]')
    }
    const settings = structuredClone(b); voice(settings).muted = true
    expect(mergeSharedProjects(base, a, settings).conflicts).toContain('tracks[voice_replacements]')
    const edited = structuredClone(a); voice(edited).clips[0].volume = 0.5
    expect(mergeSharedProjects(a, base, edited).conflicts).toContain('tracks[voice_replacements]')
    expect(mergeSharedProjects(base, a, edited).conflicts).toContain('tracks[voice_replacements]')
  })
  test('concurrent track moves conflict without duplicating or resurrecting clips', () => {
    let base = prepareSharedProject(fixture())
    base = applyCommand(base, { type: 'addTitle', start: 0, duration: 2, text: 'Move me' })
    const clip = base.tracks.flatMap(t => t.clips).find(c => c.text === 'Move me')!
    base.tracks.push({ id: 'destA', type: 'overlay', name: 'A', locked: false, muted: false, hidden: false, clips: [] }, { id: 'destB', type: 'overlay', name: 'B', locked: false, muted: false, hidden: false, clips: [] })
    const moved = (dest: string) => ({ ...base, tracks: base.tracks.map(t => ({ ...t, clips: [...t.clips.filter(c => c.id !== clip.id), ...(t.id === dest ? [{ ...clip, trackId: dest }] : [])] })) })
    const result = mergeSharedProjects(base, moved('destA'), moved('destB'))
    expect(result.conflicts).toContain(`clips[${clip.id}].trackId`)
    expect(result.project.tracks.flatMap(t => t.clips).filter(c => c.id === clip.id).map(c => c.trackId)).toEqual(['destA'])
    const deleted = { ...base, tracks: base.tracks.map(t => ({ ...t, clips: t.clips.filter(c => c.id !== clip.id) })) }
    const deletion = mergeSharedProjects(base, deleted, moved('destB'))
    expect(deletion.conflicts).toContain(`clips[${clip.id}]`)
    expect(deletion.project.tracks.flatMap(t => t.clips).some(c => c.id === clip.id)).toBe(false)
    const changed = applyCommand(base, { type: 'setText', clipId: clip.id, text: 'Updated independently' })
    const independent = mergeSharedProjects(base, moved('destA'), changed)
    expect(independent.conflicts).toEqual([])
    expect(independent.project.tracks.find(t => t.id === 'destA')!.clips[0].text).toBe('Updated independently')
    const bad = moved('destA'); bad.tracks.find(t => t.id === 'destB')!.clips.push({ ...clip, trackId: 'destB' })
    expect(() => sharedProject(bad)).toThrow('reference')
  })
  test('deleting an object while someone edits it conflicts; independent additions survive', () => {
    const base = prepareSharedProject(fixture())
    base.tags = [{ id: 'tag', start: 0, end: 1, kind: 'note', label: 'Initial' }]
    const local = { ...base, tags: [] }
    const remote = { ...base, tags: [{ ...base.tags[0], label: 'Changed' }] }
    expect(mergeSharedProjects(base, local, remote).conflicts).toContain('tags[tag]')
    const a = { ...base, tags: [...base.tags, { ...base.tags[0], id: 'a' }] }, b = { ...base, tags: [...base.tags, { ...base.tags[0], id: 'b' }] }
    expect(mergeSharedProjects(base, a, b).project.tags.map(t => t.id).sort()).toEqual(['a', 'b', 'tag'])
  })
})

test('full editing API authorizes edits, rejects stale saves and supports new immutable proxy media', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-collab-'))
  const handler = createReviewHandler(join(dir, 'rooms'))
  const server = createServer((req, res) => { void handler(req, res, new URL(req.url!, 'http://localhost').pathname) })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = (path: string, key?: string, method = 'GET', data?: unknown) => fetch(`${origin}/api/reviews${path}`, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) })
  try {
    const project = prepareSharedProject(fixture())
    const created = await (await request('', undefined, 'POST', { snapshot: snapshotForReview(project), mode: 'edit', project })).json() as any
    expect(created.room.mode).toBe('edit')
    const { ownerKey, reviewerKey } = created, id = created.room.id
    const audioPath = join(dir, 'proxy.webm')
    expect(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:a', 'libopus', audioPath]).status).toBe(0)
    const blob = await readFile(audioPath)
    const upload = (assetId: string, key: string) => fetch(`${origin}/api/reviews/${id}/media/${assetId}`, { method: 'PUT', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'audio/webm' }, body: blob })
    expect((await upload('source', ownerKey)).status).toBe(200)
    expect((await request(`/${id}/publish`, ownerKey, 'POST', {})).status).toBe(200)
    const changed = applyCommand(project, { type: 'addTitle', start: 0, duration: 2, text: 'Remote title' })
    const saves = await Promise.all([request(`/${id}/project`, reviewerKey, 'PUT', { revision: 1, project: changed, author: 'Editor A' }), request(`/${id}/project`, ownerKey, 'PUT', { revision: 1, project: changed, author: 'Editor B' })])
    expect(saves.map(s => s.status).sort()).toEqual([200, 409])
    const room = await (await request(`/${id}`, reviewerKey)).json() as any
    expect(room.projectRevision).toBe(2); expect(room.project.tracks).toEqual(changed.tracks)
    expect(room.ownerHash).toBeUndefined(); expect(JSON.stringify(room)).not.toContain('/private')
    const added = { ...project.assets.source, id: 'music', sourceOffset: undefined }
    expect((await request(`/${id}/assets`, reviewerKey, 'POST', { asset: added })).status).toBe(200)
    const withMusic = applyCommand(changed, { type: 'addAudio', asset: added, start: 0, duration: 2 })
    expect((await request(`/${id}/project`, reviewerKey, 'PUT', { revision: 2, project: withMusic, author: 'Editor' })).status).toBe(409)
    expect((await upload('music', reviewerKey)).status).toBe(200)
    expect((await upload('music', reviewerKey)).status).toBe(409)
    expect((await request(`/${id}/project`, reviewerKey, 'PUT', { revision: 2, project: withMusic, author: 'Editor' })).status).toBe(200)
    expect((await request(`/${id}/project`, 'wrong', 'PUT', { revision: 3, project, author: 'Intruder' })).status).toBe(403)
    const audit = await (await request('', undefined, 'POST', { snapshot: snapshotForReview(project) })).json() as any
    expect((await request(`/${audit.room.id}/project`, audit.ownerKey, 'PUT', { revision: 1, project, author: 'Owner' })).status).toBe(403)
    expect((await request(`/${id}`, reviewerKey, 'DELETE')).status).toBe(403)
    expect((await request(`/${id}`, ownerKey, 'DELETE')).status).toBe(200)
    expect((await request(`/${id}`, reviewerKey)).status).toBe(404)
  } finally { await new Promise<void>(ok => server.close(() => ok())); await rm(dir, { recursive: true, force: true }) }
})
