import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { createReviewHandler } from '../../../../scripts/review-server'
import { parseReviewSnapshot, parseReviewEdit, reviewConflict, type ReviewRoom, type ReviewProposal } from '../../../shared/review'
import { applyReviewDecision, snapshotForReview } from './reviewProject'
import { projectFromTake } from './importMedia'
import { wordsFromAsr } from './asr'
import { applyCommand } from './commands'
import { useEditor } from '../store'

const fixture = () => projectFromTake({
  asset: { id: 'source', name: 'Source.wav', path: '/private/original.wav', kind: 'audio', duration: 3, waveform: [], sourceOffset: 0 },
  words: wordsFromAsr([{ start: 0.2, end: 1, text: 'Hello there.' }, { start: 2, end: 2.8, text: 'Next chapter.' }]), whispered: null,
  analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
})
const proposal = (): ReviewProposal => ({ id: 'proposal', author: 'Reviewer', text: 'Remove the repeat', start: 0.2, end: 1, edit: { kind: 'cut', start: 0.2, end: 1 }, status: 'pending', replies: [], createdAt: 1 })
function room(): ReviewRoom { return { id: 'room', revision: 1, snapshot: snapshotForReview(fixture()), proposals: [], media: {}, published: true, createdAt: 1, expiresAt: Date.now() + 1000 } }

describe('review decisions', () => {
  test('snapshot removes originals, browser keys, thumbnails and private metadata', () => {
    const p = fixture(); p.assets.source.browserMediaKey = 'private-key'; p.assets.source.proxyPath = '/secret/proxy.mp4'
    const raw = JSON.stringify(snapshotForReview(p))
    expect(raw).not.toContain('/private'); expect(raw).not.toContain('/secret'); expect(raw).not.toContain('private-key')
    const parsed = parseReviewSnapshot({ ...snapshotForReview(p), ownerKey: 'hidden', assets: [{ ...snapshotForReview(p).assets[0], path: '/private' }] })
    expect(JSON.stringify(parsed)).not.toContain('private'); expect(JSON.stringify(parsed)).not.toContain('hidden')
  })
  test('invalid identifiers, protected cuts, empty cuts and already-cut ranges are rejected', () => {
    const snapshot = snapshotForReview(fixture())
    expect(() => parseReviewSnapshot({ ...snapshot, assets: [{ ...snapshot.assets[0], id: '__proto__' }] })).toThrow('identifier')
    expect(() => parseReviewEdit({ kind: 'cut', start: 0, end: 0.01 }, snapshot)).toThrow('0.03')
    expect(() => parseReviewEdit({ kind: 'cut', start: 0, end: 1 }, { ...snapshot, protected: [{ start: 0, end: 1 }] })).toThrow('protected')
    expect(() => parseReviewEdit({ kind: 'cut', start: 0, end: 1 }, { ...snapshot, cuts: [{ start: 0, end: 1 }] })).toThrow('already cut')
  })
  test('accept uses normal editing, preserves original references, is idempotent and undoes in one step', () => {
    const p = fixture(), r = { ...room(), snapshot: snapshotForReview(p) }, request = proposal()
    useEditor.getState().loadProject(p, { persist: false })
    const next = applyReviewDecision(p, r, request, 'accepted')
    useEditor.getState().dispatch({ type: 'replaceProject', project: next })
    expect(next.cuts.some(c => c.start <= 0.2 && c.end >= 1)).toBe(true)
    expect(next.assets.source.path).toBe('/private/original.wav')
    expect(applyReviewDecision(next, r, request, 'accepted')).toBe(next)
    useEditor.getState().undo(); expect(useEditor.getState().project.cuts).toEqual(p.cuts)
    expect(useEditor.getState().project.reviewDecisions).toBeUndefined()
  })
  test('overlapping source edits and chapter changes conflict, unrelated passages merge', () => {
    const p = fixture(), snapshot = snapshotForReview(p), edit = proposal().edit!
    const changed = applyCommand(p, { type: 'deleteRange', start: 0.4, end: 0.8 })
    expect(reviewConflict(snapshot, snapshotForReview(changed), edit)).toContain('passage changed')
    expect(reviewConflict(snapshot, snapshotForReview(applyCommand(p, { type: 'deleteRange', start: 2, end: 2.5 })), edit)).toBeNull()
    p.scenes = [{ id: 's', title: 'Opening', start: 0, end: 1, kind: 'talk', summary: '' }]
    const base = snapshotForReview(p); p.scenes[0].title = 'My title'
    expect(reviewConflict(base, snapshotForReview(p), { kind: 'renameChapter', sceneId: 's', title: 'Their title' })).toContain('chapter changed')
  })
  test('reject records the decision without changing cuts; protected ranges cannot be accepted', () => {
    const p = fixture(), r = { ...room(), snapshot: snapshotForReview(p) }
    expect(applyReviewDecision(p, r, proposal(), 'rejected').cuts).toEqual(p.cuts)
    const protectedProject = { ...p, tags: [{ id: 'keep', start: 0, end: 1, kind: 'keep' as const, label: 'Keep' }] }
    expect(() => applyReviewDecision(protectedProject, r, proposal(), 'accepted')).toThrow('passage changed')
  })
})

test('review API enforces capabilities, immutable media, optimistic revisions, ranges, and revocation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'speechedit-review-test-'))
  const handlers = [createReviewHandler(join(dir, 'rooms')), createReviewHandler(join(dir, 'rooms'))]
  let handledRequests = 0
  const server = createServer((req, res) => { void handlers[handledRequests++ % 2](req, res, new URL(req.url!, 'http://localhost').pathname).then(handled => { if (!handled) { res.statusCode = 404; res.end() } }) })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const request = (path: string, key?: string, method = 'GET', data?: any) => fetch(`${origin}/api/reviews${path}`, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) })
  try {
    const created = await (await request('', undefined, 'POST', { snapshot: snapshotForReview(fixture()) })).json() as any
    const { ownerKey, reviewerKey } = created, id = created.room.id
    expect(ownerKey).not.toBe(reviewerKey)
    expect((await request(`/${id}`)).status).toBe(403)
    expect((await request(`/${id}`, reviewerKey)).status).toBe(403)
    expect((await request(`/${id}/publish`, ownerKey, 'POST', {})).status).toBe(409)
    const media = join(dir, 'fixture.webm')
    const encode = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'libopus', '-b:a', '48k', media])
    expect(encode.status).toBe(0)
    const bytes = await readFile(media)
    const midpoint = Math.floor(bytes.length / 2)
    const chunk = (offset: number, end: number) => fetch(`${origin}/api/reviews/${id}/media/source`, { method: 'PUT', headers: { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'audio/webm', 'Content-Range': `bytes ${offset}-${end - 1}/${bytes.length}` }, body: bytes.subarray(offset, end) })
    expect((await chunk(0, midpoint)).status).toBe(200)
    expect((await request(`/${id}/publish`, ownerKey, 'POST', {})).status).toBe(409)
    expect((await chunk(midpoint + 1, bytes.length)).status).toBe(409)
    expect((await chunk(midpoint, bytes.length)).status).toBe(200)
    const published = await request(`/${id}/publish`, ownerKey, 'POST', {}); expect(published.status).toBe(200)
    const visible = await request(`/${id}`, reviewerKey), data = await visible.json() as any
    expect(data.ownerHash).toBeUndefined(); expect(data.reviewerHash).toBeUndefined()
    expect(visible.headers.get('set-cookie')).toContain('HttpOnly')
    expect((await request(`/${id}/media/source`)).status).toBe(403)
    const range = await fetch(`${origin}/api/reviews/${id}/media/source`, { headers: { Authorization: `Bearer ${reviewerKey}`, Range: 'bytes=0-9' } })
    expect(range.status).toBe(206); expect((await range.arrayBuffer()).byteLength).toBe(10)
    expect((await fetch(`${origin}/api/reviews/${id}/media/source`, { method: 'PUT', headers: { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'audio/webm' }, body: bytes })).status).toBe(409)
    const submission = { revision: 1, author: 'Reviewer', text: 'Cut repetition', edit: { kind: 'cut', start: 0.2, end: 1 } }
    const results = await Promise.all([request(`/${id}/proposals`, reviewerKey, 'POST', submission), request(`/${id}/proposals`, reviewerKey, 'POST', submission)])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    const current = await (await request(`/${id}`, ownerKey)).json() as ReviewRoom
    expect(current.snapshot.cuts).toEqual(data.snapshot.cuts)
    const pid = current.proposals[0].id
    expect((await request(`/${id}/proposals/${pid}/resolve`, reviewerKey, 'POST', { revision: current.revision, status: 'accepted' })).status).toBe(403)
    const replied = await request(`/${id}/proposals/${pid}/reply`, reviewerKey, 'POST', { revision: current.revision, author: 'Another editor', text: 'Agreed' })
    const replyRoom = await replied.json() as ReviewRoom; expect(replyRoom.proposals[0].replies).toHaveLength(1)
    expect((await request(`/${id}/proposals/${pid}/resolve`, ownerKey, 'POST', { revision: replyRoom.revision, status: 'accepted' })).status).toBe(200)
    expect((await request(`/${id}`, reviewerKey, 'DELETE')).status).toBe(403)
    expect((await request(`/${id}`, ownerKey, 'DELETE')).status).toBe(200)
    expect((await request(`/${id}`, reviewerKey)).status).toBe(404)
    expect((await request('/../outside', ownerKey)).status).toBe(404)
    const expiring = await (await request('', undefined, 'POST', { snapshot: snapshotForReview(fixture()) })).json() as any
    const storedPath = join(dir, 'rooms', expiring.room.id, 'room.json')
    const stored = JSON.parse(await readFile(storedPath, 'utf8')); stored.expiresAt = 1
    await writeFile(storedPath, JSON.stringify(stored))
    expect((await request(`/${expiring.room.id}`, expiring.ownerKey)).status).toBe(404)
    expect((await request(`/${expiring.room.id}`, expiring.ownerKey, 'DELETE')).status).toBe(200)

  } finally { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); await rm(dir, { recursive: true, force: true }) }
}, 20000)
