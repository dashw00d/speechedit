import { host, isElectron, registerBrowserMedia } from '../host'
import { browserMediaKeyForPath } from './browserMediaStore'
import { displaySize, quarterTurn } from '../../../shared/mediaOrient'
import { needsProxy } from '../../../shared/proxy'
import type { Asset } from '../types'
import { uid } from './time'

export async function inspectPickedMedia(file: string, role: 'broll' | 'audio'): Promise<Asset> {
  const name = file.split(/[\\/]/).pop() ?? (role === 'audio' ? 'Music' : 'B-roll')
  if (role === 'audio') {
    const info = await host.probe(file)
    const peaks = await host.waveform(file)
    return {
      id: uid('asset'),
      path: file,
      name,
      kind: 'audio',
      duration: info.duration || 8,
      sampleRate: info.sampleRate,
      waveform: peaks
    }
  }
  const image = /\.(png|jpe?g|webp|gif)$/i.test(name)
  const info = await host.probe(file)
  const shown = displaySize(info.width, info.height, info.rotation)
  const displayRotation = quarterTurn(info.rotation)
  const proxyPath =
    !image && info.hasVideo && needsProxy(info)
      ? await host.makeProxy(file).catch(() => '')
      : ''
  return {
    id: uid('asset'),
    path: file,
    name,
    kind: image ? 'image' : info.hasVideo ? 'video' : 'image',
    duration: info.duration || 8,
    width: shown.width,
    height: shown.height,
    fps: info.fps,
    waveform: [],
    ...(proxyPath ? { proxyPath } : {}),
    ...(displayRotation ? { displayRotation } : {}),
    ...(info.codec ? { codec: info.codec } : {}),
    ...(info.vfr ? { vfr: true } : {})
  }
}

async function inspectBrowserPicked(file: File, kind: Asset['kind']): Promise<Asset> {
  const path = await registerBrowserMedia(file)
  let duration = 8, width: number | undefined, height: number | undefined
  if (kind === 'image') {
    const bitmap = await createImageBitmap(file)
    width = bitmap.width; height = bitmap.height; bitmap.close()
  } else {
    const info = await host.probe(path)
    if (!info.duration) throw new Error('Cannot determine this media file’s duration. Use a seekable recording.')
    duration = info.duration; width = info.width; height = info.height
  }
  return { id: uid('asset'), path, name: file.name, kind, duration, width, height, waveform: [], browserMediaKey: browserMediaKeyForPath(path) }
}

function pickBrowserAsset(accept: string, kind: (file: File) => Asset['kind']): Promise<Asset | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      void inspectBrowserPicked(file, kind(file)).then(resolve, reject)
    }
    input.oncancel = () => resolve(null); input.click()
  })
}

export async function pickBroll(): Promise<Asset | null> {
  if (isElectron) {
    const file = await host.openBroll()
    return file ? inspectPickedMedia(file, 'broll') : null
  }
  return pickBrowserAsset('image/*,video/mp4,video/webm,video/quicktime', file => file.type.startsWith('image/') ? 'image' : 'video')
}

export async function pickAudio(): Promise<Asset | null> {
  if (isElectron) {
    const file = await host.openMedia()
    return file ? inspectPickedMedia(file, 'audio') : null
  }
  return pickBrowserAsset('audio/*', () => 'audio')
}
