import { host, isElectron } from '../host'
import type { Asset } from '../types'
import { uid } from './time'

export async function pickBroll(): Promise<Asset | null> {
  if (isElectron) {
    const file = await host.openBroll()
    if (!file) return null
    const info = await host.probe(file).catch(() => null)
    const name = file.split(/[\\/]/).pop() ?? 'B-roll'
    const image = /\.(png|jpe?g|webp|gif)$/i.test(name)
    return {
      id: uid('asset'),
      path: file,
      name,
      kind: image ? 'image' : info?.hasVideo ? 'video' : 'image',
      duration: info?.duration || 8,
      width: info?.width,
      height: info?.height,
      fps: info?.fps,
      waveform: []
    }
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
    const info = await host.probe(file).catch(() => null)
    const peaks = await host.waveform(file).catch(() => [])
    const name = file.split(/[\\/]/).pop() ?? 'Music'
    return {
      id: uid('asset'),
      path: file,
      name,
      kind: 'audio',
      duration: info?.duration || 8,
      sampleRate: info?.sampleRate,
      waveform: peaks
    }
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
