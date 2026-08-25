import { describe, expect, test } from 'bun:test'
import { applyCommand } from './commands'
import { host } from '../host'
import { useEditor } from '../store'
import { importMediaFromPath } from './fileActions'
import { ffmpegImportBusy } from './mediaJobs'
import {
  fillImportedTake,
  importedLooksCommands,
  inspectRecording,
  projectFromTake
} from './importMedia'
import { transcriptIsPlaceholder } from './transcript'

async function waitUntil(pred: () => boolean, ms = 400): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await Bun.sleep(5)
  }
}

describe('progressive import', () => {
  test('onReady fires after probe, before transcribe', async () => {
    const order: string[] = []
    const prev = {
      probe: host.probe,
      makeProxy: host.makeProxy,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      analyze: host.analyze,
      transcribe: host.transcribe
    }
    host.probe = async () => {
      order.push('probe')
      return { duration: 2, hasVideo: true, hasAudio: true, width: 320, height: 240, fps: 30 }
    }
    host.makeProxy = async () => {
      throw new Error('proxy should not run for short SD')
    }
    host.waveform = async () => {
      order.push('waveform')
      return [0.2]
    }
    host.thumbnails = async () => {
      order.push('thumbs')
      return []
    }
    host.analyze = async () => {
      order.push('analyze')
      return { silence: [{ start: 1.4, end: 1.8 }], scenes: { times: [], staticRegions: [] }, loudness: [] }
    }
    host.transcribe = async () => {
      order.push('transcribe')
      return [{ text: 'hello', start: 0.1, end: 0.4 }]
    }
    let readyAt = -1
    try {
      const take = await inspectRecording('/tmp/se-src.mp4', {
        onReady: (partial) => {
          readyAt = order.length
          order.push('ready')
          expect(partial.asset.path).toBe('/tmp/se-src.mp4')
          expect(partial.asset.duration).toBe(2)
          expect(partial.words).toEqual([])
          expect(partial.asset.waveform).toEqual([])
        },
        onLooks: (partial) => {
          order.push('looks')
          expect(partial.asset.waveform).toEqual([0.2])
          expect(partial.analysis.silence).toHaveLength(1)
          expect(partial.words).toEqual([])
        }
      })
      expect(readyAt).toBe(1)
      expect(order[0]).toBe('probe')
      expect(order[1]).toBe('ready')
      expect(order.indexOf('ready')).toBeLessThan(order.indexOf('waveform'))
      expect(order.indexOf('ready')).toBeLessThan(order.indexOf('transcribe'))
      expect(order.indexOf('analyze')).toBeLessThan(order.indexOf('looks'))
      expect(order.indexOf('analyze')).toBeLessThan(order.indexOf('thumbs'))
      expect(take.words.map((w) => w.text)).toEqual(['hello'])
      expect(take.asset.id).toBeTruthy()
    } finally {
      Object.assign(host, prev)
    }
  })

  test('HEVC opens the reel before the preview proxy finishes', async () => {
    const order: string[] = []
    let releaseProxy!: () => void
    const proxyGate = new Promise<void>((resolve) => {
      releaseProxy = resolve
    })
    const prev = {
      probe: host.probe,
      makeProxy: host.makeProxy,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      analyze: host.analyze,
      transcribe: host.transcribe
    }
    host.probe = async () => {
      order.push('probe')
      return { duration: 8, width: 640, height: 360, codec: 'hevc', hasVideo: true, hasAudio: true }
    }
    host.makeProxy = async () => {
      order.push('proxy-start')
      await proxyGate
      order.push('proxy-end')
      return '/tmp/se-hevc.proxy.mp4'
    }
    host.waveform = async () => {
      order.push('waveform')
      return [0.2]
    }
    host.thumbnails = async () => []
    host.analyze = async () => ({
      silence: [],
      scenes: { times: [], staticRegions: [] },
      loudness: []
    })
    host.transcribe = async () => [{ text: 'hello', start: 0.1, end: 0.4 }]
    try {
      const done = inspectRecording('/tmp/se-phone-hevc.mp4', {
        onReady: (partial) => {
          order.push('ready')
          expect(partial.asset.proxyPath).toBeUndefined()
          expect(partial.asset.codec).toBe('hevc')
        },
        onProxy: (partial) => {
          order.push('proxy-cb')
          expect(partial.asset.proxyPath).toBe('/tmp/se-hevc.proxy.mp4')
        },
        onLooks: (partial) => {
          order.push('looks')
          expect(partial.asset.waveform).toEqual([0.2])
        }
      })
      await waitUntil(() => order.includes('ready') && order.includes('proxy-start') && order.includes('waveform'))
      expect(order.indexOf('ready')).toBeLessThan(order.indexOf('proxy-start'))
      expect(order.includes('proxy-end')).toBe(false)
      expect(order.includes('proxy-cb')).toBe(false)
      releaseProxy()
      const take = await done
      expect(order.indexOf('ready')).toBeLessThan(order.indexOf('proxy-end'))
      expect(order.indexOf('waveform')).toBeLessThan(order.indexOf('proxy-end'))
      expect(order).toContain('proxy-cb')
      expect(take.asset.proxyPath).toBe('/tmp/se-hevc.proxy.mp4')
    } finally {
      releaseProxy()
      Object.assign(host, prev)
    }
  })

  test('looks hydration does not clear a proxy that already landed', () => {
    const project = projectFromTake({
      asset: {
        id: 'src',
        path: '/tmp/se-src.mp4',
        name: 'src.mp4',
        kind: 'video',
        duration: 2,
        waveform: [],
        sourceOffset: 0,
        proxyPath: '/tmp/se.proxy.mp4'
      },
      words: [],
      whispered: null,
      analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
    })
    const commands = importedLooksCommands(project, {
      asset: { ...project.assets.src, waveform: [0.4], proxyPath: undefined },
      words: [],
      whispered: null,
      analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
    })
    expect(commands.some((command) => command.type === 'setAssetLooks' && 'proxyPath' in command)).toBe(false)
    const next = commands.reduce((cur, command) => applyCommand(cur, command), project)
    expect(next.assets.src.proxyPath).toBe('/tmp/se.proxy.mp4')
    expect(next.assets.src.waveform).toEqual([0.4])
  })

  test('waveform and transcribe overlap after the reel is playable', async () => {
    const prev = {
      probe: host.probe,
      makeProxy: host.makeProxy,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      analyze: host.analyze,
      transcribe: host.transcribe
    }
    let waveformStarted = false
    let transcribeStarted = false
    let overlapped = false
    host.probe = async () => ({ duration: 2, hasVideo: true, hasAudio: true, width: 320, height: 240, fps: 30 })
    host.makeProxy = async () => {
      throw new Error('proxy should not run for short SD')
    }
    host.waveform = async () => {
      waveformStarted = true
      await Bun.sleep(40)
      if (transcribeStarted) overlapped = true
      return [0.2]
    }
    host.thumbnails = async () => []
    host.analyze = async () => ({
      silence: [],
      scenes: { times: [], staticRegions: [] },
      loudness: []
    })
    host.transcribe = async () => {
      transcribeStarted = true
      await Bun.sleep(40)
      if (waveformStarted) overlapped = true
      return [{ text: 'hello', start: 0.1, end: 0.4 }]
    }
    try {
      const take = await inspectRecording('/tmp/se-src.mp4')
      expect(overlapped).toBe(true)
      expect(take.words.map((w) => w.text)).toEqual(['hello'])
    } finally {
      Object.assign(host, prev)
    }
  })

  test('fillImportedTake keeps a cut made before ASR lands', () => {
    const partial = {
      asset: {
        id: 'src',
        path: '/tmp/se-src.mp4',
        name: 'src.mp4',
        kind: 'video' as const,
        duration: 2,
        waveform: [],
        sourceOffset: 0
      },
      words: [],
      whispered: null,
      analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
    }
    const early = projectFromTake(partial)
    expect(transcriptIsPlaceholder(early.transcript.words)).toBe(true)
    const cut = applyCommand(early, { type: 'deleteRange', start: 0.8, end: 1.2, source: 'manual' })
    const full = {
      ...partial,
      asset: { ...partial.asset, waveform: [0.1, 0.9], thumbnails: ['data:image/jpeg;base64,x'] },
      words: [
        { id: 'a', text: 'hello', start: 0.1, end: 0.4, speaker: 'ryan', deleted: false },
        { id: 'b', text: 'um', start: 0.85, end: 1.1, speaker: 'ryan', deleted: false },
        { id: 'c', text: 'world', start: 1.4, end: 1.8, speaker: 'ryan', deleted: false }
      ],
      analysis: {
        silence: [{ start: 1.5, end: 1.9 }],
        scenes: { times: [0], staticRegions: [] },
        loudness: []
      }
    }
    const filled = fillImportedTake(cut, full)
    expect(filled.assets.src.waveform).toEqual([0.1, 0.9])
    expect(filled.cuts).toHaveLength(1)
    expect(filled.transcript.words.find((w) => w.text === 'um')?.deleted).toBe(true)
    expect(filled.analysis.silence).toHaveLength(1)
    expect(fillImportedTake(filled, full).transcript.words.map((w) => w.text)).toEqual(
      filled.transcript.words.map((w) => w.text)
    )
  })

  test('fillImportedTake appends take 2 words without replacing take 1', () => {
    const first = {
      asset: {
        id: 'a',
        path: '/tmp/take1.mp4',
        name: 'take1.mp4',
        kind: 'video' as const,
        duration: 2,
        waveform: [0.2],
        sourceOffset: 0
      },
      words: [{ id: 'hello', text: 'hello', start: 0.1, end: 0.4, speaker: 'ryan', deleted: false }],
      whispered: null,
      analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
    }
    let project = projectFromTake(first)
    const second = {
      asset: {
        id: 'b',
        path: '/tmp/take2.mp4',
        name: 'take2.mp4',
        kind: 'video' as const,
        duration: 2,
        waveform: [],
        sourceOffset: 0
      },
      words: [],
      whispered: null,
      analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
    }
    project = applyCommand(project, { type: 'appendTake', asset: second.asset, words: [] })
    const filled = fillImportedTake(project, {
      ...second,
      asset: { ...project.assets.b, waveform: [0.4] },
      words: [{ id: 'world', text: 'world', start: 0.2, end: 0.5, speaker: 'ryan', deleted: false }],
      analysis: { silence: [{ start: 1.2, end: 1.8 }], scenes: { times: [], staticRegions: [] }, loudness: [] }
    })
    expect(filled.transcript.words.map((w) => w.text)).toEqual(['hello', 'world'])
    expect(filled.transcript.words.find((w) => w.text === 'world')?.start).toBeCloseTo(2.2, 5)
    expect(filled.assets.b.waveform).toEqual([0.4])
    expect(filled.analysis.silence.some((row) => row.start >= 3.1 && row.end <= 3.9)).toBe(true)
  })

  test('fillImportedTake does not replace a dropped transcript', () => {
    const partial = {
      asset: {
        id: 'src',
        path: '/tmp/se-src.mp4',
        name: 'src.mp4',
        kind: 'video' as const,
        duration: 2,
        waveform: [],
        sourceOffset: 0
      },
      words: [],
      whispered: null,
      analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
    }
    let project = projectFromTake(partial)
    project = applyCommand(project, {
      type: 'setTranscript',
      words: [{ id: 'user', text: 'already here', start: 0.2, end: 0.6, speaker: 'ryan', deleted: false }]
    })
    const filled = fillImportedTake(project, {
      ...partial,
      words: [{ id: 'asr', text: 'whisper', start: 0.2, end: 0.5, speaker: 'ryan', deleted: false }]
    })
    expect(filled.transcript.words.map((w) => w.text)).toEqual(['already here'])
  })

  test('Open media plays the camera file, then attaches the proxy on the command bus', async () => {
    let releaseProxy!: () => void
    const proxyGate = new Promise<void>((resolve) => {
      releaseProxy = resolve
    })
    let jobEnded = 0
    const prev = {
      probe: host.probe,
      makeProxy: host.makeProxy,
      waveform: host.waveform,
      thumbnails: host.thumbnails,
      analyze: host.analyze,
      transcribe: host.transcribe,
      beginJob: host.beginJob,
      endJob: host.endJob
    }
    host.probe = async () => ({
      duration: 8,
      width: 640,
      height: 360,
      codec: 'hevc',
      hasVideo: true,
      hasAudio: true
    })
    host.makeProxy = async () => {
      await proxyGate
      return '/tmp/se-open.proxy.mp4'
    }
    host.waveform = async () => [0.2]
    host.thumbnails = async () => []
    host.analyze = async () => ({
      silence: [],
      scenes: { times: [], staticRegions: [] },
      loudness: []
    })
    host.transcribe = async () => [{ text: 'hello', start: 0.1, end: 0.4 }]
    host.beginJob = async () => undefined
    host.endJob = async () => {
      jobEnded += 1
    }
    useEditor.getState().setAnalyzing(null)
    useEditor.getState().setExporting(false)
    try {
      const done = importMediaFromPath('/tmp/se-phone-hevc.mp4', () => undefined)
      await waitUntil(() =>
        Object.values(useEditor.getState().project.assets).some((asset) => asset.codec === 'hevc')
      )
      const early = Object.values(useEditor.getState().project.assets)[0]
      expect(early.proxyPath).toBeUndefined()
      expect(early.path).toBe('/tmp/se-phone-hevc.mp4')
      await waitUntil(() => jobEnded > 0)
      expect(Object.values(useEditor.getState().project.assets)[0].proxyPath).toBeUndefined()
      expect(ffmpegImportBusy(useEditor.getState().analyzing)).toBe(false)
      expect(useEditor.getState().analyzing).toBe('preview')
      releaseProxy()
      await done
      const late = Object.values(useEditor.getState().project.assets)[0]
      expect(late.proxyPath).toBe('/tmp/se-open.proxy.mp4')
      expect(jobEnded).toBeGreaterThan(0)
    } finally {
      releaseProxy()
      Object.assign(host, prev)
      useEditor.getState().setAnalyzing(null)
    }
  })
})
