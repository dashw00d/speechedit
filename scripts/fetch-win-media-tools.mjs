import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const RELEASE = 'b6.1.1'
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`
const here = dirname(fileURLToPath(import.meta.url))
const destination = join(here, '..', 'vendor', 'win32-x64')

const assets = [
  {
    name: 'ffmpeg.exe',
    url: `${BASE}/ffmpeg-win32-x64.gz`,
    compressedSha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
    sha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
    gzip: true
  },
  {
    name: 'ffprobe.exe',
    url: `${BASE}/ffprobe-win32-x64.gz`,
    compressedSha256: 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d',
    sha256: '3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4',
    gzip: true
  },
  {
    name: 'LICENSE.ffmpeg.txt',
    url: `${BASE}/win32-x64.LICENSE`,
    sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
    gzip: false
  }
]

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

async function verifiedExisting(path, expected) {
  try {
    return sha256(await readFile(path)) === expected
  } catch {
    return false
  }
}

async function fetchAsset(asset) {
  const output = join(destination, asset.name)
  if (await verifiedExisting(output, asset.sha256)) {
    process.stdout.write(`${asset.name} · verified\n`)
    return
  }

  process.stdout.write(`${asset.name} · downloading ${RELEASE}\n`)
  const response = await fetch(asset.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${asset.url}`)
  const downloaded = Buffer.from(await response.arrayBuffer())
  if (asset.compressedSha256 && sha256(downloaded) !== asset.compressedSha256) {
    throw new Error(`${asset.name} download checksum did not match.`)
  }
  const body = asset.gzip ? gunzipSync(downloaded) : downloaded
  if (sha256(body) !== asset.sha256) throw new Error(`${asset.name} checksum did not match.`)
  const temporary = `${output}.${process.pid}.tmp`
  await writeFile(temporary, body)
  await rename(temporary, output)
}

await mkdir(destination, { recursive: true })
try {
  for (const asset of assets) await fetchAsset(asset)
  await writeFile(
    join(destination, 'SOURCE.ffmpeg.txt'),
    [
      'SpeechEdit bundled media tools',
      `Source: ${BASE}`,
      'Build: ffmpeg-static Windows x64, FFmpeg 6.1.1',
      'License: LICENSE.ffmpeg.txt',
      ''
    ].join('\n')
  )
  process.stdout.write(`Windows media tools ready in ${destination}\n`)
} catch (error) {
  await rm(destination, { recursive: true, force: true })
  throw error
}
