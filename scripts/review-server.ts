import { sharedProject, sharedAssetSchema } from '../src/shared/collaboration'
import { encodeRecording } from './recording-server'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, rename, rm, readdir, stat, utimes } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { summarizeReview, parseReviewSnapshot, parseReviewSubmission, reviewText, REVIEW_MAX_ASSET_BYTES, REVIEW_MAX_ROOM_BYTES, type ReviewRoom } from '../src/shared/review'

interface StoredRoom extends ReviewRoom { ownerHash: string; reviewerHash: string }
const hash = (key: string) => createHash('sha256').update(key).digest('hex')
const token = () => randomBytes(32).toString('base64url')
class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body))
}
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 6_000_000) throw new HttpError(413, 'Review request is too large.'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new HttpError(400, 'Invalid JSON.') }
}
const publicRoom = ({ ownerHash: _owner, reviewerHash: _reviewer, ...room }: StoredRoom): ReviewRoom => room

/** Capability-scoped review storage. Original media is never accepted by the create endpoint. */
export function createReviewHandler(root: string, options: { maxBytes?: number; ffmpeg?: string } = {}) {
  const dir = resolve(root), maxBytes = options.maxBytes ?? 20 * 1024 ** 3
  const locks = new Map<string, Promise<unknown>>()
  const attempts = new Map<string, { at: number; count: number }>()
  const recordingAttempts = new Map<string, { at: number; count: number }>()
  const recordingQuota = (req: IncomingMessage) => {
    const ip = req.socket.remoteAddress || 'local', now = Date.now(), prior = recordingAttempts.get(ip)
    const entry = prior && now - prior.at < 3600_000 ? prior : { at: now, count: 0 }
    if (entry.count >= 100) throw new HttpError(429, 'Recording limit reached. Try again later.')
    entry.count++; recordingAttempts.set(ip, entry)
  }
  async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      // Atomic directory leases also serialize an old and new container during deployment.
      const leases = resolve(dir, '.locks'), lease = resolve(leases, key), nonce = randomUUID()
      await mkdir(leases, { recursive: true })
      const started = Date.now()
      for (;;) {
        try { await mkdir(lease); await writeFile(resolve(lease, 'owner'), nonce); break }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          const modified = await stat(lease).then(s => s.mtimeMs).catch(() => Date.now())
          if (Date.now() - modified > 300000) {
            const stale = resolve(leases, `stale-${nonce}`)
            await rename(lease, stale).then(() => rm(stale, { recursive: true, force: true })).catch(() => undefined)
            continue
          }
          if (Date.now() - started > 30000) throw new HttpError(503, 'Review storage is busy. Try again shortly.')
          await new Promise(ok => setTimeout(ok, 50))
        }
      }
      const owns = () => readFile(resolve(lease, 'owner'), 'utf8').then(owner => owner === nonce).catch(() => false)
      const heartbeat = setInterval(() => { void owns().then(yes => { if (yes) return utimes(lease, new Date(), new Date()) }).catch(() => undefined) }, 30000)
      try { return await fn() } finally { clearInterval(heartbeat); if (await owns()) await rm(lease, { recursive: true, force: true }) }
    }); locks.set(key, next)
    try { return await next } finally { if (locks.get(key) === next) locks.delete(key) }
  }
  const folder = (id: string) => resolve(dir, id)
  async function read(id: string, includeExpired = false): Promise<StoredRoom> {
    try {
      const room = JSON.parse(await readFile(resolve(folder(id), 'room.json'), 'utf8')) as StoredRoom
      if (!includeExpired && room.expiresAt < Date.now()) throw new Error('expired')
      return room
    } catch { throw new HttpError(404, 'This review link expired, was revoked, or does not exist.') }
  }
  async function save(room: StoredRoom) {
    const serialized = JSON.stringify(room)
    if (Buffer.byteLength(serialized) > 8_000_000) throw new HttpError(413, 'This review has reached its feedback storage limit.')
    const dest = resolve(folder(room.id), 'room.json'), temp = `${dest}.${randomUUID()}.tmp`
    await writeFile(temp, serialized, { mode: 0o600 }); await rename(temp, dest)
  }
  async function usage(): Promise<number> {
    await mkdir(dir, { recursive: true })
    let bytes = 0
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = resolve(dir, entry.name)
      try {
        const room = JSON.parse(await readFile(resolve(path, 'room.json'), 'utf8')) as StoredRoom
        if (room.expiresAt < Date.now() && !locks.has(room.id) && !(await stat(resolve(dir, '.locks', room.id)).then(() => true).catch(() => false))) { await rm(path, { recursive: true, force: true }); continue }
        for (const file of await readdir(path)) bytes += (await stat(resolve(path, file))).size
      } catch { /* another request may be completing creation */ }
    }
    return bytes
  }
  function auth(req: IncomingMessage, room: StoredRoom): 'owner' | 'reviewer' {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '')
    const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`se-review-${room.id}=`))?.split('=')[1]
    const value = hash(bearer || cookie || '')
    if (value === room.ownerHash) return 'owner'
    if (value === room.reviewerHash && room.published) return 'reviewer'
    throw new HttpError(403, 'This review link does not grant access.')
  }
  async function remux(input: string, output: string, duration: number, mp3 = false) {
    // Produce a seekable WebM with a duration and index; only local WebM input is permitted.
    await new Promise<void>((ok, fail) => {
      const child = spawn(options.ffmpeg || 'ffmpeg', ['-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-format_whitelist', mp3 ? 'mp3' : 'matroska,webm', '-i', input, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-t', String(duration), output], { stdio: ['ignore', 'ignore', 'pipe'] })
      let error = ''; const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('Preview preparation timed out.')) }, 90_000)
      child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000) })
      child.once('error', err => { clearTimeout(timer); fail(err) })
      child.once('exit', code => { clearTimeout(timer); code === 0 ? ok() : fail(new Error(`Could not prepare the compressed preview. ${error}`)) })
    })
  }
  return async (req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> => {
    if (!pathname.startsWith('/api/reviews') && pathname !== '/api/recordings') return false
    res.setHeader('Cache-Control', 'no-store')
    try {
      // Same-origin browser mutations; bearer credentials are also usable by explicit API clients.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Review requests must use this server.')
      if (pathname === '/api/recordings' && req.method === 'POST') {
        recordingQuota(req)
        const recording = await locked('recording-encode', () => encodeRecording(req, options.ffmpeg))
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': recording.bytes.length, 'Cache-Control': 'no-store' }); res.end(recording.bytes); return true
      }
      if (pathname === '/api/reviews' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'local'
        const prior = attempts.get(ip), now = Date.now()
        const bucket = prior && now - prior.at < 3600_000 ? prior : { at: now, count: 0 }
        if (bucket.count >= 20) throw new HttpError(429, 'Too many review links created. Try again later.')
        bucket.count++; attempts.set(ip, bucket)
        const input = await body(req), snapshot = parseReviewSnapshot(input.snapshot)
        const mode = input.mode === 'edit' ? 'edit' : 'audit'
        const project = mode === 'edit' ? sharedProject(input.project) : undefined
        if (project && project.id !== snapshot.projectId) throw new HttpError(400, 'Project identifiers do not match.')
        const created = await locked('capacity', async () => {
          if (await usage() + Buffer.byteLength(JSON.stringify({ snapshot, project, mediaAssets: project?.assets })) + 2048 >= maxBytes || (await readdir(dir)).length >= 1000) throw new HttpError(507, 'Review storage is full.')
          const id = randomBytes(16).toString('hex'), ownerKey = token(), reviewerKey = token()
          const room: StoredRoom = { id, snapshot, mode, ...(project ? { project, projectRevision: 1, mediaAssets: project.assets, history: [{ revision: 1, author: 'Owner', at: now }] } : {}), revision: 1, proposals: [], media: {}, published: false, createdAt: now, expiresAt: now + 30 * 86400_000, ownerHash: hash(ownerKey), reviewerHash: hash(reviewerKey) }
          await mkdir(folder(id)); await save(room)
          return { room: publicRoom(room), ownerKey, reviewerKey }
        })
        json(res, 201, created); return true
      }
      const match = /^\/api\/reviews\/([a-f0-9]{32})(?:\/(media)(?:\/([a-zA-Z0-9_-]{1,120}))?|\/(publish|proposals|project|assets|summary|recordings)(?:\/([a-f0-9-]{36})(?:\/(reply|resolve))?)?)?$/.exec(pathname)
      if (!match) throw new HttpError(404, 'Review route not found.')
      const [, id, media, assetId, route, proposalId, action] = match
      await locked(id, async () => {
        const room = await read(id, req.method === 'DELETE')
        const role = auth(req, room)
        const owner = () => { if (role !== 'owner') throw new HttpError(403, 'Only the owner can do that.') }
        if (route === 'recordings' && !proposalId && req.method === 'POST') {
          if (!room.published) throw new HttpError(409, 'Publish this review before adding recordings.')
          recordingQuota(req)
          if (Object.keys(room.mediaAssets || {}).length >= 256) throw new HttpError(413, 'This review has reached its recording limit.')
          const recording = await locked('recording-encode', () => encodeRecording(req, options.ffmpeg))
          const asset = { id: `rec_${randomUUID()}`, name: 'Re-recorded voice.mp3', kind: 'audio' as const, duration: recording.duration, sampleRate: 48000, waveform: [], path: '', isRecording: true }
          asset.path = `shared-media:${asset.id}`
          await locked('capacity', async () => {
            const roomSize = Object.values(room.media).reduce((n, m) => n + m.bytes, 0)
            if (roomSize + recording.bytes.length > REVIEW_MAX_ROOM_BYTES || await usage() + recording.bytes.length > maxBytes) throw new HttpError(507, 'Recording storage is full.')
            await writeFile(resolve(folder(id), `${asset.id}.mp3`), recording.bytes, { mode: 0o600 })
            room.mediaAssets = { ...room.mediaAssets, [asset.id]: asset }; room.media[asset.id] = { bytes: recording.bytes.length, mime: 'audio/mpeg' }
            await save(room)
          })
          json(res, 201, { asset }); return
        }
        if (route === 'summary' && !proposalId && req.method === 'GET') { owner(); json(res, 200, summarizeReview(room)); return }
        if (!media && !route && req.method === 'GET') {
          const key = req.headers.authorization?.replace(/^Bearer /, '')
          if (key) res.setHeader('Set-Cookie', `se-review-${id}=${key}; HttpOnly; SameSite=Strict; Path=/api/reviews/${id}; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`)
          json(res, 200, publicRoom(room)); return
        }
        if (!media && !route && req.method === 'DELETE') { owner(); await rm(folder(id), { recursive: true, force: true }); json(res, 200, { revoked: true }); return }
        if (route === 'project' && req.method === 'PUT') {
          if (room.mode !== 'edit' || !room.project || !room.published) throw new HttpError(403, 'This link is for audit only.')
          const input = await body(req)
          if (input.revision !== room.projectRevision) throw new HttpError(409, 'Another editor saved changes. Merge or resolve them before saving.')
          const project = sharedProject(input.project)
          if (project.id !== room.project.id) throw new HttpError(400, 'Cannot replace a shared project with another document.')
          for (const asset of Object.values(project.assets)) {
            const registered = room.mediaAssets?.[asset.id]
            if (!registered || !room.media[asset.id] || registered.kind !== asset.kind || registered.duration !== asset.duration) throw new HttpError(409, 'Upload each new media preview before saving.')
          }
          room.project = project; room.projectRevision = (room.projectRevision || 1) + 1
          room.history = [...(room.history || []), { revision: room.projectRevision, author: reviewText(input.author, 80), at: Date.now() }].slice(-100)
          await locked('capacity', async () => {
            if (await usage() + Buffer.byteLength(JSON.stringify(room)) > maxBytes) throw new HttpError(507, 'Shared storage is full.')
            await save(room)
          })
          json(res, 200, publicRoom(room)); return
        }
        if (route === 'assets' && req.method === 'POST') {
          if (room.mode !== 'edit') throw new HttpError(403, 'This link is for audit only.')
          const asset = sharedAssetSchema.parse((await body(req)).asset)
          room.mediaAssets ||= {}
          if (room.mediaAssets[asset.id]) {
            if (room.mediaAssets[asset.id].kind !== asset.kind || room.mediaAssets[asset.id].duration !== asset.duration) throw new HttpError(409, 'This media identifier is already registered.')
          } else {
            if (Object.keys(room.mediaAssets).length >= 256) throw new HttpError(413, 'Shared media limit reached.')
            room.mediaAssets[asset.id] = { ...asset, path: `shared-media:${asset.id}` }
            await locked('capacity', async () => {
              if (await usage() + Buffer.byteLength(JSON.stringify(room)) > maxBytes) throw new HttpError(507, 'Shared storage is full.')
              await save(room)
            })
          }
          json(res, 200, publicRoom(room)); return
        }
        if (media && assetId) {
          const asset = room.mediaAssets?.[assetId] || room.snapshot.assets.find(a => a.id === assetId)
          if (!asset) throw new HttpError(404, 'Unknown preview.')
          const isMp3 = room.media[assetId]?.mime === 'audio/mpeg' || req.method === 'PUT' && 'isRecording' in asset && asset.isRecording && asset.kind === 'audio' && req.headers['content-type'] === 'audio/mpeg'
          const target = resolve(folder(id), `${assetId}.${isMp3 ? 'mp3' : 'webm'}`)
          if (req.method === 'PUT') {
            if (room.mode !== 'edit') owner()
            if (room.media[assetId] || (room.published && room.mode !== 'edit')) throw new HttpError(409, 'Published previews are immutable. Create a new review link.')
            if (!isMp3 && !(asset.kind === 'image' ? /^image\/webp$/ : /^(audio|video)\/webm(?:;|$)/).test(req.headers['content-type'] || '')) throw new HttpError(415, 'Upload a compressed WebM preview.')
            const length = Number(req.headers['content-length'])
            const contentRange = req.headers['content-range']
            const range = contentRange ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange) : null
            if (contentRange && !range) throw new HttpError(400, 'Invalid upload range.')
            const offset = range ? Number(range[1]) : 0, total = range ? Number(range[3]) : length
            if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(total) || total > REVIEW_MAX_ASSET_BYTES || total <= 0 || offset + length > total || (range && Number(range[2]) !== offset + length - 1)) throw new HttpError(413, 'Preview must be smaller than 250 MiB and have a valid upload range.')
            await locked('capacity', async () => {
              const temp = `${target}.upload`, prepared = `${target}.prepared.${isMp3 ? 'mp3' : 'webm'}`
              const existing = await stat(temp).then(s => s.size).catch(() => 0)
              if (offset && offset !== existing) throw new HttpError(409, 'Upload offset changed. Start the share again.')
              let roomSize = 0
              for (const file of await readdir(folder(id))) roomSize += (await stat(resolve(folder(id), file))).size
              if (roomSize + length > REVIEW_MAX_ROOM_BYTES || await usage() + length + total > maxBytes) throw new HttpError(507, 'Review storage limit reached.')
              let bytes = 0; let magic = Buffer.alloc(0)
              try {
                await pipeline(req, new Transform({ transform(chunk: Buffer, _encoding, callback) {
                  bytes += chunk.length; if (magic.length < 12) magic = Buffer.concat([magic, chunk]).subarray(0, 12)
                  callback(bytes > length ? new Error('Preview exceeds its declared size.') : null, chunk)
                } }), createWriteStream(temp, { mode: 0o600, flags: offset ? 'a' : 'w' }), { signal: AbortSignal.timeout(120000) })
                if (bytes !== length || (!offset && !isMp3 && (asset.kind === 'image' ? magic.subarray(0, 4).toString() !== 'RIFF' || magic.subarray(8, 12).toString() !== 'WEBP' : magic.subarray(0, 4).toString('hex') !== '1a45dfa3'))) throw new HttpError(400, 'Invalid compressed preview.')
                if (offset + length === total) {
                  if (asset.kind === 'image') await writeFile(prepared, await readFile(temp))
                  else await remux(temp, prepared, asset.duration, !!isMp3)
                  await rename(prepared, target)
                  room.media[assetId] = { bytes: (await stat(target)).size, mime: isMp3 ? 'audio/mpeg' : asset.kind === 'image' ? 'image/webp' : `${asset.kind}/webm` }; await save(room)
                  await rm(temp, { force: true })
                }
              } catch (error) { await rm(temp, { force: true }); throw error }
              finally { await rm(prepared, { force: true }) }
            })
            json(res, 200, { uploaded: offset + length, total, ...(room.media[assetId] as { bytes: number; mime: string } | undefined || {}) }); return
          }
          if (req.method === 'GET' || req.method === 'HEAD') {
            const info = room.media[assetId]
            if (!info) throw new HttpError(404, 'Preview is not ready.')
            const total = info.bytes; let start = 0, end = total - 1
            const range = req.headers.range
            if (range) {
              const r = /^bytes=(\d*)-(\d*)$/.exec(range)
              if (!r || (!r[1] && !r[2])) throw new HttpError(416, 'Invalid media range.')
              if (!r[1]) start = Math.max(0, total - Number(r[2]))
              else { start = Number(r[1]); end = r[2] ? Math.min(Number(r[2]), end) : end }
              if (start > end || start >= total) { res.setHeader('Content-Range', `bytes */${total}`); throw new HttpError(416, 'Media range outside preview.') }
              res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
            }
            res.writeHead(range ? 206 : 200, { 'Content-Type': info.mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
            if (req.method === 'HEAD') res.end()
            else createReadStream(target, { start, end }).on('error', () => res.destroy()).pipe(res)
            return
          }
        }
        if (route === 'publish' && req.method === 'POST') {
          owner()
          if ((room.project ? Object.values(room.project.assets) : room.snapshot.assets).some(a => !room.media[a.id])) throw new HttpError(409, 'Upload every source preview before sharing.')
          room.published = true; await save(room); json(res, 200, publicRoom(room)); return
        }
        if (route === 'proposals' && req.method === 'POST') {
          const input = await body(req)
          if (input.revision !== room.revision) throw new HttpError(409, 'New feedback arrived. Refresh before submitting.')
          if (!room.published) throw new HttpError(409, 'This review is not published yet.')
          if (action === 'resolve') {
            owner(); const proposal = room.proposals.find(p => p.id === proposalId)
            if (!proposal) throw new HttpError(404, 'Proposal not found.')
            if (input.status !== 'accepted' && input.status !== 'rejected') throw new HttpError(400, 'Invalid decision.')
            if (proposal.status !== 'pending' && proposal.status !== input.status) throw new HttpError(409, 'This proposal already has a decision.')
            proposal.status = input.status
          } else if (action === 'reply') {
            const proposal = room.proposals.find(p => p.id === proposalId)
            if (!proposal) throw new HttpError(404, 'Comment not found.')
            if (proposal.replies.length >= 100) throw new HttpError(413, 'This thread is full.')
            proposal.replies.push({ id: randomUUID(), author: reviewText(input.author, 80), text: reviewText(input.text), createdAt: Date.now() })
          } else if (!proposalId) {
            if (room.proposals.length >= 1000) throw new HttpError(413, 'This review is full.')
            room.proposals.push({ id: randomUUID(), ...parseReviewSubmission(input, room.snapshot, room.mediaAssets), status: 'pending', replies: [], createdAt: Date.now() })
          } else throw new HttpError(404, 'Review action not found.')
          room.revision++
          await locked('capacity', async () => {
            if (await usage() + Buffer.byteLength(JSON.stringify(room)) > maxBytes) throw new HttpError(507, 'Review storage is full.')
            await save(room)
          })
          json(res, 200, publicRoom(room)); return
        }
        throw new HttpError(405, 'Method not allowed.')
      })
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error instanceof HttpError ? error.status : 400, { error: error instanceof Error ? error.message : 'Review request failed.' })
    }
    return true
  }
}
