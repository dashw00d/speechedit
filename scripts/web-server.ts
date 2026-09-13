import { createReadStream, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 3000)
const webRoot = resolve(process.env.SPEECHEDIT_WEB_ROOT || 'src/renderer/dist')
const whisperCacheRoot = resolve(
  process.env.SPEECHEDIT_CACHE_DIR || '.cache/speechedit-browser-whisper'
)
const whisperModelRevision = '2575352d61be1bf7225cf8f8b268a4678025fc58'
const whisperBrowserCacheVersion = 'v2'
const demoAiModel = 'openrouter/free'
const demoAiKey = process.env.OPENROUTER_API_KEY || ''
const demoLimit = Math.max(1, Number(process.env.SPEECHEDIT_DEMO_REQUESTS_PER_HOUR || 10))
const demoDailyLimit = Math.max(1, Number(process.env.SPEECHEDIT_DEMO_REQUESTS_PER_DAY || 40))
const usage = new Map<string, { since: number; count: number }>()
let dailyUsage = { since: Date.now(), count: 0 }

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp'
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

function clientKey(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return first?.trim() || request.socket.remoteAddress || 'local'
}

function takeDemoRequest(request: IncomingMessage): boolean {
  const client = clientKey(request)
  const now = Date.now()
  const previous = usage.get(client)
  const bucket =
    !previous || now - previous.since >= 60 * 60 * 1000
      ? { since: now, count: 0 }
      : previous
  if (now - dailyUsage.since >= 24 * 60 * 60 * 1000) dailyUsage = { since: now, count: 0 }
  if (bucket.count >= demoLimit || dailyUsage.count >= demoDailyLimit) return false
  bucket.count += 1
  dailyUsage.count += 1
  usage.set(client, bucket)
  return true
}

function readRequestJson(request: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('Demo AI request is too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Demo AI request is not valid JSON.'))
      }
    })
    request.on('error', reject)
  })
}

async function serveDemoAi(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith('/api/demo-ai/')) return false
  if (pathname === '/api/demo-ai/status' && request.method === 'GET') {
    json(response, 200, {
      available: Boolean(demoAiKey),
      model: demoAiModel,
      message: demoAiKey ? 'Demo AI is ready.' : 'Demo AI is not configured on this server.'
    })
    return true
  }
  if (pathname !== '/api/demo-ai/chat/completions' || request.method !== 'POST') {
    json(response, 404, { error: { message: 'Demo AI route not found.' } })
    return true
  }
  if (!demoAiKey) {
    json(response, 503, { error: { message: 'Demo AI is not configured on this server.' } })
    return true
  }
  if (!takeDemoRequest(request)) {
    json(response, 429, { error: { message: 'Demo AI usage limit reached. Try again later.' } })
    return true
  }
  try {
    const raw = (await readRequestJson(request)) as {
      messages?: Array<{ role?: unknown; content?: unknown }>
      response_format?: unknown
    }
    const messages = Array.isArray(raw.messages)
      ? raw.messages.slice(-64).flatMap((message) =>
          (message.role === 'system' || message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string'
            ? [{ role: message.role, content: message.content.slice(0, 300_000) }]
            : []
        )
      : []
    if (!messages.length) {
      json(response, 400, { error: { message: 'Demo AI needs at least one message.' } })
      return true
    }
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${demoAiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': request.headers.origin || 'https://speechedit.local',
        'X-Title': 'SpeechEdit Demo'
      },
      body: JSON.stringify({
        model: demoAiModel,
        messages,
        temperature: 0.2,
        ...(raw.response_format ? { response_format: raw.response_format } : {})
      }),
      signal: AbortSignal.timeout(180_000)
    })
    response.statusCode = upstream.status
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(await upstream.text())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Demo AI failed.'
    const status = /too large/i.test(message)
      ? 413
      : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? 504
        : 502
    json(response, status, { error: { message } })
  }
  return true
}

async function serveWhisperModel(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<boolean> {
  if (!pathname.startsWith('/whisper-models/')) return false
  const parts = decodeURIComponent(pathname.slice('/whisper-models/'.length)).split('/').filter(Boolean)
  const resourceParts = parts[0] === whisperBrowserCacheVersion ? parts.slice(1) : parts
  if (resourceParts.length < 3 || resourceParts.some((part) => part === '..' || part.includes('\\'))) {
    response.statusCode = 400
    response.end('Invalid model path')
    return true
  }
  const cachePath = resolve(whisperCacheRoot, ...resourceParts)
  if (!cachePath.startsWith(`${whisperCacheRoot}${sep}`)) {
    response.statusCode = 400
    response.end('Invalid model path')
    return true
  }
  try {
    if (existsSync(cachePath)) {
      const info = await stat(cachePath)
      response.statusCode = 200
      response.setHeader('Content-Length', String(info.size))
      response.setHeader(
        'Content-Type',
        cachePath.endsWith('.json') ? 'application/json' : 'application/octet-stream'
      )
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      response.setHeader('X-SpeechEdit-Whisper-Cache', 'hit')
      if (request.method === 'HEAD') response.end()
      else createReadStream(cachePath).pipe(response)
      return true
    }
    const [owner, model, ...fileParts] = resourceParts
    const upstreamUrl = `https://huggingface.co/${encodeURIComponent(owner)}/${encodeURIComponent(model)}/resolve/${whisperModelRevision}/${fileParts.map(encodeURIComponent).join('/')}`
    const upstream = await fetch(upstreamUrl, { redirect: 'follow' })
    if (!upstream.ok || !upstream.body) {
      response.statusCode = upstream.status || 502
      response.end(`Whisper model download failed (${upstream.status || 'network'})`)
      return true
    }
    response.statusCode = 200
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    response.setHeader('X-SpeechEdit-Whisper-Cache', 'miss')
    for (const name of ['content-length', 'content-type', 'etag']) {
      const value = upstream.headers.get(name)
      if (value) response.setHeader(name, value)
    }
    if (request.method === 'HEAD') {
      response.end()
      return true
    }
    const [browserBody, cacheBody] = upstream.body.tee()
    await mkdir(resolve(cachePath, '..'), { recursive: true })
    const staging = `${cachePath}.${process.pid}.part`
    void pipeline(Readable.fromWeb(cacheBody as never), createWriteStream(staging))
      .then(async () => {
        await rm(cachePath, { force: true })
        await rename(staging, cachePath)
      })
      .catch(() => rm(staging, { force: true }))
    Readable.fromWeb(browserBody as never).pipe(response)
  } catch (error) {
    response.statusCode = 502
    response.end(error instanceof Error ? error.message : 'Whisper model proxy failed')
  }
  return true
}

function safeStaticPath(pathname: string): string | null {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const path = resolve(webRoot, relative)
  return path === webRoot || path.startsWith(`${webRoot}${sep}`) ? path : null
}

function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string): void {
  const requested = safeStaticPath(pathname)
  const path = requested && existsSync(requested) && statSync(requested).isFile()
    ? requested
    : resolve(webRoot, 'index.html')
  if (!path.startsWith(`${webRoot}${sep}`) || !existsSync(path)) {
    json(response, 503, { error: { message: 'Web build is missing. Run bun run build:web.' } })
    return
  }
  const info = statSync(path)
  response.statusCode = 200
  response.setHeader('Content-Length', String(info.size))
  response.setHeader('Content-Type', contentTypes[extname(path).toLowerCase()] || 'application/octet-stream')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader(
    'Cache-Control',
    pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  )
  if (request.method === 'HEAD') response.end()
  else createReadStream(path).pipe(response)
}

if (!Number.isFinite(port) || port <= 0) throw new Error('PORT must be a positive number.')

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname
  if (pathname === '/healthz') {
    json(response, 200, { ok: true })
    return
  }
  if (await serveDemoAi(request, response, pathname)) return
  if (await serveWhisperModel(request, response, pathname)) return
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    json(response, 405, { error: { message: 'Method not allowed.' } })
    return
  }
  serveStatic(request, response, pathname)
})

server.listen(port, host, () => {
  console.log(`SpeechEdit web listening on http://${host}:${port}`)
  console.log(`Demo AI: ${demoAiKey ? 'configured' : 'not configured'}`)
  console.log(`Whisper cache: ${whisperCacheRoot}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
