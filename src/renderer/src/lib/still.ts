import { useEditor, usePlayback } from '../store'
import { currentWord } from './edl'
import { quoteFromSelection } from './quote'
import { programToSourceOf } from './resolver'
import { formatYoutubeClock } from './time'
import { sentenceIds } from './transcriptEdit'
import type { Project } from '../types'
import { zoomPlacement, type ZoomBasis } from './zoom'

export type StillPlacement = {
  programTime: number
  basis: ZoomBasis
}

/** Same context as Add zoom — the words, the chapter, or the playhead. */
export function stillAt(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null
): StillPlacement {
  const placed = zoomPlacement(project, programTime, selectedWordIds, selectedSceneId)
  return { programTime: placed.start, basis: placed.basis }
}

export function describeStill(copied: boolean, hasPicture: boolean, label?: string): string {
  const what = hasPicture ? 'the picture and the line' : 'a card with the line'
  const named = label ? ` — ${label}` : ''
  const next = copied ? 'Paste it.' : 'Drop the PNG where you need it.'
  return `${copied ? 'Copied' : 'Downloaded'} ${what}${named}. ${next}`
}

function monitorVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLVideoElement>('[data-monitor-video]')
}

async function waitForStillFrame(video: HTMLVideoElement | null, programTime: number): Promise<void> {
  const here = usePlayback.getState().programTime
  usePlayback.getState().seekProgram(programTime)
  if (!video || Math.abs(here - programTime) < 0.05) return
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    window.setTimeout(done, 180)
  })
}

function sceneForStill(project: Project, selectedSceneId: string | null) {
  if (!selectedSceneId) return undefined
  return (project.scenes ?? []).find((row) => row.id === selectedSceneId && row.kind !== 'retake')
}

function wordsInScene(project: Project, scene: { start: number; end: number }) {
  return project.transcript.words.filter(
    (word) => !word.deleted && word.start >= scene.start && word.end <= scene.end
  )
}

function wordsAreSceneSelection(selectedWordIds: string[], implied: { id: string }[]): boolean {
  if (!implied.length || selectedWordIds.length !== implied.length) return false
  const picked = new Set(selectedWordIds)
  return implied.every((word) => picked.has(word.id))
}

export function stillCaption(
  project: Project,
  programTime: number,
  selectedWordIds: string[],
  selectedSceneId: string | null = null
): string {
  const scene = sceneForStill(project, selectedSceneId)
  const implied = scene ? wordsInScene(project, scene) : []
  const impliedPick = Boolean(scene && selectedWordIds.length && wordsAreSceneSelection(selectedWordIds, implied))
  const selected = quoteFromSelection(project, selectedWordIds)
  if (selected && !impliedPick) return selected
  if (scene) {
    const first = implied[0]
    if (first) {
      const index = project.transcript.words.findIndex((row) => row.id === first.id)
      const line = quoteFromSelection(project, sentenceIds(project.transcript.words, index))
      if (line) return `${scene.title} — ${line}`
    }
    return `${scene.title} · ${formatYoutubeClock(programTime)}`
  }
  const source = programToSourceOf(project, programTime)
  const word = currentWord(project.transcript.words, source)
  if (!word) return `${project.name} · ${formatYoutubeClock(programTime)}`
  const index = project.transcript.words.findIndex((row) => row.id === word.id)
  return (
    quoteFromSelection(project, sentenceIds(project.transcript.words, index)) ??
    `${formatYoutubeClock(programTime)}: ${word.text}`
  )
}

function safeStillName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '').trim()
}

export function stillFilename(project: Project, programTime: number, label?: string): string {
  const clock = formatYoutubeClock(programTime).replace(/:/g, '-')
  const reel = safeStillName(project.name) || 'frame'
  const extra = label ? safeStillName(label) : ''
  return extra && extra !== reel ? `${reel} ${extra} ${clock}.png` : `${reel} ${clock}.png`
}

export function paintStill(
  canvas: HTMLCanvasElement,
  opts: { video: HTMLVideoElement | null; caption: string; title: string }
): void {
  const video = opts.video
  const hasPicture = Boolean(video && video.videoWidth > 2 && video.videoHeight > 2)
  const width = hasPicture ? video!.videoWidth : 1280
  const height = hasPicture ? video!.videoHeight : 720
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#1c1914'
  ctx.fillRect(0, 0, width, height)
  if (hasPicture) ctx.drawImage(video!, 0, 0, width, height)
  else {
    ctx.fillStyle = '#f4efe4'
    ctx.font = `600 ${Math.round(height * 0.06)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText(opts.title || 'Audio only', width / 2, height * 0.42)
  }
  const bar = Math.round(height * 0.22)
  ctx.fillStyle = 'rgba(12, 10, 8, 0.78)'
  ctx.fillRect(0, height - bar, width, bar)
  ctx.fillStyle = '#f4efe4'
  ctx.textAlign = 'left'
  ctx.font = `600 ${Math.round(height * 0.035)}px system-ui, sans-serif`
  const pad = Math.round(width * 0.04)
  wrapText(ctx, opts.caption, pad, height - bar + Math.round(bar * 0.42), width - pad * 2, Math.round(height * 0.045))
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(/\s+/)
  let line = ''
  let row = y
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, row)
      line = word
      row += lineHeight
    } else line = next
  }
  if (line) ctx.fillText(line, x, row)
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function copyStillFromContext(video?: HTMLVideoElement | null): Promise<{
  copied: boolean
  toast: string
  at: StillPlacement
}> {
  const editor = useEditor.getState()
  const at = stillAt(
    editor.project,
    usePlayback.getState().programTime,
    editor.selectedWordIds,
    editor.selectedSceneId
  )
  const el = video ?? monitorVideo()
  await waitForStillFrame(el, at.programTime)
  const caption = stillCaption(editor.project, at.programTime, editor.selectedWordIds, editor.selectedSceneId)
  const label =
    at.basis === 'scene'
      ? sceneForStill(editor.project, editor.selectedSceneId)?.title
      : undefined
  const filename = stillFilename(editor.project, at.programTime, label)
  const failed = { copied: false, toast: 'Could not copy this frame.', at }
  if (typeof document === 'undefined') return failed
  const canvas = document.createElement('canvas')
  paintStill(canvas, { video: el, caption, title: label || editor.project.name })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return failed
  const hasPicture = Boolean(el && el.videoWidth > 2 && el.videoHeight > 2)
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return { copied: true, toast: describeStill(true, hasPicture, label), at }
    }
  } catch {
    /* fall through to a file they can drop */
  }
  downloadBlob(filename, blob)
  return { copied: false, toast: describeStill(false, hasPicture, label), at }
}
