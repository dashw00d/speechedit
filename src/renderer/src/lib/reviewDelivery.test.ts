import { test, expect } from 'bun:test'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReviewHandler } from '../../../../scripts/review-server'
import { parseReviewSnapshot, parseReviewSubmission, reviewConflict, type ReviewSnapshot } from '../../../shared/review'
import { scopeReviewSnapshot, REVIEW_PROFILE, ticks, reviewMotionComplete } from '../../../shared/reviewMedia'
const full: ReviewSnapshot = { projectId: 'project', name: 'Passage', sourceDuration: 10, assets: [{ id: 'source', name: 'Source', kind: 'audio', sourceOffset: 0, duration: 10, waveform: [0.8, 0.4] }], words: [{ id: 'before', text: 'PRIVATE BEFORE', start: 0, end: 1, deleted: false }, { id: 'inside', text: 'Shared', start: 3, end: 4, deleted: false }, { id: 'after', text: 'PRIVATE AFTER', start: 8, end: 9, deleted: false }], scenes: [{ id: 'chapter', title: 'Full chapter', start: 0, end: 10 }], cuts: [{ start: 1, end: 3 }], protected: [] }
test('passage scope removes neighbouring metadata while preserving absolute edit anchors', () => {
  const snapshot = parseReviewSnapshot({ ...full, scope: { start: 2, end: 6 } })
  expect(snapshot.words.map(w => [w.text, w.start, w.end])).toEqual([['Shared', 3, 4]])
  expect(snapshot.assets[0].waveform).toEqual([]); expect(snapshot.scenes).toEqual([])
  expect(snapshot.cuts).toEqual([{ start: 2, end: 3 }])
  expect(() => parseReviewSubmission({ author: 'Friend', text: 'Outside', start: 1, end: 4 }, snapshot)).toThrow('outside')
  expect(() => parseReviewSubmission({ author: 'Friend', edit: { kind: 'cut', start: 5, end: 7 } }, snapshot)).toThrow('outside')
  expect(reviewConflict(snapshot, full, { kind: 'correctWord', wordId: 'inside', text: 'Corrected' })).toBeNull()
  expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
})
test('progressive uploads publish atomically, retry idempotently, constrain scope and preserve partial feedback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'se-delivery-')), handler = createReviewHandler(join(dir, 'rooms'))
  const server = createServer((req, res) => { void handler(req, res, new URL(req.url!, 'http://localhost').pathname) })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const call = (path: string, key?: string, method = 'GET', data?: unknown) => fetch(origin + '/api/reviews' + path, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) })
  try {
    const media = join(dir, 'audio.webm')
    const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', media])
    expect(encoded.status).toBe(0)
    const bytes = await readFile(media), sha256 = createHash('sha256').update(bytes).digest('hex')
    const snapshot = scopeReviewSnapshot(full, { start: 2, end: 6 })
    const created = await (await call('', undefined, 'POST', { snapshot, profile: REVIEW_PROFILE })).json()
    const id = created.room.id, owner = created.ownerKey, friend = created.reviewerKey
    const row = { id: 'first', assetId: 'source', kind: 'audio', start: ticks(2), end: ticks(4), mime: 'audio/webm', sha256, bytes: bytes.length }
    const upload = (value = row, key = owner) => fetch(`${origin}/api/reviews/${id}/representations/${value.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${key}`, 'Content-Type': value.mime, 'X-Review-Representation': JSON.stringify(value) }, body: bytes })
    expect((await call(`/${id}`, friend)).status).toBe(403)
    expect((await upload({ ...row, start: ticks(1) })).status).toBe(400)
    expect((await upload({ ...row, sha256: 'a'.repeat(64) })).status).toBe(400)
    const first = await (await upload()).json()
    expect(first.published).toBe(true); expect(first.delivery.state).toBe('playable')
    expect(first.delivery.representations).toHaveLength(1)
    expect((await upload()).status).toBe(200)
    expect((await upload({ ...row, id: 'too-short', start: ticks(4), end: ticks(4.1) })).status).toBe(415)
    expect((await upload({ ...row, id: 'overlap' })).status).toBe(409)
    expect((await upload({ ...row, id: 'friend' }, friend)).status).toBe(403)
    const downloaded = await fetch(`${origin}/api/reviews/${id}/representations/first`, { headers: { Authorization: `Bearer ${friend}` } })
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes)
    const ranged = await fetch(`${origin}/api/reviews/${id}/representations/first`, { headers: { Authorization: `Bearer ${friend}`, Range: 'bytes=10-19' } })
    expect(ranged.status).toBe(206); expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(10, 20))
    expect((await fetch(`${origin}/api/reviews/${id}/representations/first`)).status).toBe(403)
    expect((await call(`/${id}/delivery`, owner, 'POST', { state: 'complete' })).status).toBe(409)
    const comment = await (await call(`/${id}/proposals`, friend, 'POST', { revision: 1, author: 'Friend', text: 'Reviewing before upload is complete', start: 3, end: 4 })).json()
    expect(comment.proposals).toHaveLength(1)
    const partial = await (await call(`/${id}/delivery`, owner, 'POST', { state: 'partial' })).json()
    expect(partial.published).toBe(true); expect(partial.delivery.state).toBe('partial'); expect(partial.proposals).toHaveLength(1)
    expect((await upload({ ...row, id: 'second', start: ticks(4), end: ticks(6) })).status).toBe(200)
    const complete = await (await call(`/${id}/delivery`, owner, 'POST', { state: 'complete' })).json()
    expect(complete.delivery.state).toBe('complete'); expect(complete.revision).toBe(comment.revision)
    expect(complete.delivery.completedAt).toBeGreaterThanOrEqual(complete.delivery.playableAt)
    expect((await call(`/${id}/details`, friend, 'POST', { kind: 'motion', start: 5, end: 7 })).status).toBe(400)
    expect((await call(`/${id}`, owner, 'DELETE')).status).toBe(200)
    expect((await call(`/${id}`, friend)).status).toBe(404)
  } finally { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); await rm(dir, { recursive: true, force: true }) }
}, 15000)

test('offline completion requires video coverage across every authorized source interval', () => {
  const snapshot = scopeReviewSnapshot({ ...full, assets: [{ ...full.assets[0], kind: 'video' }] }, { start: 2, end: 6 })
  const row = { id: 'motion', assetId: 'source', kind: 'motion' as const, start: ticks(2), end: ticks(4), bytes: 1, sha256: 'a'.repeat(64), mime: 'video/webm' }
  expect(reviewMotionComplete(snapshot, [row])).toBe(false)
  expect(reviewMotionComplete(snapshot, [row, { ...row, id: 'gap', start: ticks(5), end: ticks(6) }])).toBe(false)
  expect(reviewMotionComplete(snapshot, [row, { ...row, id: 'end', start: ticks(4), end: ticks(6) }])).toBe(true)
})
