import { host, isElectron } from '../host'
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

export async function pickBroll(): Promise<Asset | null> {
  if (isElectron) {
    const file = await host.openBroll()
    if (!file) return null
    return inspectPickedMedia(file, 'broll')
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/mp4,video/webm,video/quicktime'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const image = file.type.startsWith('image/')
      resolve({
        id: uid('asset'),
        path: URL.createObjectURL(file),
        name: file.name,
        kind: image ? 'image' : 'video',
        duration: 8,
        waveform: []
      })
    }
    input.click()
  })
}

export async function pickAudio(): Promise<Asset | null> {
  if (isElectron) {
    const file = await host.openMedia()
    if (!file) return null
    return inspectPickedMedia(file, 'audio')
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      resolve({
        id: uid('asset'),
        path: URL.createObjectURL(file),
        name: file.name,
        kind: 'audio',
        duration: 30,
        waveform: []
      })
    }
    input.click()
  })
}
