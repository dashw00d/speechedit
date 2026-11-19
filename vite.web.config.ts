import { createReviewHandler } from './scripts/review-server'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { WHISPER_MODEL_CACHE_VERSIONS, whisperModelRevision } from './src/shared/whisperModels'

function packageVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version?: unknown }
    return typeof raw.version === 'string' ? raw.version : '0.1.0'
  } catch {
    return '0.1.0'
  }
}

const whisperCacheRoot = resolve('node_modules/.cache/speechedit-browser-whisper')
const demoAiModel = 'openrouter/free'

function readRequestJson(request: import('node:http').IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
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
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Demo AI request is not valid JSON.'))
      }
    })
    request.on('error', reject)
  })
}

function demoAiServer(apiKey: string): Plugin {
  const usage = new Map<string, { since: number; count: number }>()
  const install = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use('/api/demo-ai', async (request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      const route = (request.url ?? '/').split('?')[0]
      if (route === '/status' && request.method === 'GET') {
        response.statusCode = 200
        response.end(JSON.stringify({
          available: Boolean(apiKey),
          model: demoAiModel,
          message: apiKey ? 'Demo AI is ready.' : 'Demo AI is not configured on this server.'
        }))
        return
      }
      if (route !== '/chat/completions' || request.method !== 'POST') {
        response.statusCode = 404
        response.end(JSON.stringify({ error: { message: 'Demo AI route not found.' } }))
        return
      }
      if (!apiKey) {
        response.statusCode = 503
        response.end(JSON.stringify({ error: { message: 'Demo AI is not configured on this server.' } }))
        return
      }
      const client = request.socket.remoteAddress || 'local'
      const now = Date.now()
      const prior = usage.get(client)
      const bucket = !prior || now - prior.since >= 60 * 60 * 1000 ? { since: now, count: 0 } : prior
      if (bucket.count >= 10) {
        response.statusCode = 429
        response.end(JSON.stringify({ error: { message: 'Demo AI hourly limit reached. Try again later.' } }))
        return
      }
      bucket.count += 1
      usage.set(client, bucket)
      try {
        const raw = await readRequestJson(request) as {
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
        if (!messages.length) throw new Error('Demo AI needs at least one message.')
        const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost',
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
        response.end(await upstream.text())
      } catch (error) {
        response.statusCode = error instanceof Error && /too large/i.test(error.message) ? 413 : 400
        response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Demo AI failed.' } }))
      }
    })
  }
  return {
    name: 'speechedit-demo-ai',
    configureServer: install,
    configurePreviewServer: install
  }
}

function browserWhisperModelServer(): Plugin {
  const install = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use('/whisper-models', async (request, response) => {
      const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]).replace(/^\/+/, '')
      const parts = pathname.split('/').filter(Boolean)
      const resourceParts = WHISPER_MODEL_CACHE_VERSIONS.includes(parts[0]) ? parts.slice(1) : parts
      if (resourceParts.length < 3 || resourceParts.some((part) => part === '..' || part.includes('\\'))) {
        response.statusCode = 400
        response.end('Invalid model path')
        return
      }
      const cachePath = resolve(whisperCacheRoot, ...resourceParts)
      if (!cachePath.startsWith(`${whisperCacheRoot}${sep}`)) {
        response.statusCode = 400
        response.end('Invalid model path')
        return
      }
      try {
        if (existsSync(cachePath)) {
          const info = await stat(cachePath)
          response.statusCode = 200
          response.setHeader('Content-Length', String(info.size))
          response.setHeader('Content-Type', cachePath.endsWith('.json') ? 'application/json' : 'application/octet-stream')
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          response.setHeader('X-SpeechEdit-Whisper-Cache', 'hit')
          if (request.method === 'HEAD') response.end()
          else createReadStream(cachePath).pipe(response)
          return
        }
        const [owner, model, ...fileParts] = resourceParts
        const revision = whisperModelRevision(owner, model)
        if (!revision) {
          response.statusCode = 404
          response.end('Unknown Whisper model')
          return
        }
        const upstreamUrl = `https://huggingface.co/${encodeURIComponent(owner)}/${encodeURIComponent(model)}/resolve/${revision}/${fileParts.map(encodeURIComponent).join('/')}`
        const upstream = await fetch(upstreamUrl, { redirect: 'follow' })
        if (!upstream.ok || !upstream.body) {
          response.statusCode = upstream.status || 502
          response.end(`Whisper model download failed (${upstream.status || 'network'})`)
          return
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
          return
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
    })
  }
  return {
    name: 'speechedit-browser-whisper-models',
    configureServer: install,
    configurePreviewServer: install
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const openRouterKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || ''
  return {
    root: resolve('src/renderer'),
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    define: {
      'process.env.SPEECHEDIT_VERSION': JSON.stringify(packageVersion())
    },
    plugins: [{ name: 'speechedit-reviews', configureServer(server) {
      const handler = createReviewHandler(resolve('node_modules/.cache/speechedit-review-dev'))
      server.middlewares.use((req, res, next) => { void handler(req, res, new URL(req.url || '/', 'http://localhost').pathname).then(handled => { if (!handled) next() }).catch(next) })
    } }, browserWhisperModelServer(), demoAiServer(openRouterKey), react()],
    server: { port: 5173, strictPort: true }
  }
})
