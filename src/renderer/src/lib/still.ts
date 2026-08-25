import { useEditor, usePlayback } from '../store'
import { currentWord } from './edl'
import { quoteFromSelection } from './quote'
import { programToSourceOf } from './resolver'
import { formatYoutubeClock } from './time'
import { sentenceIds } from './transcriptEdit'
import type { Project } from '../types'

export function stillCaption(project: Project, programTime: number, selectedWordIds: string[]): string {
  const selected = quoteFromSelection(project, selectedWordIds)
  if (selected) return selected
  const source = programToSourceOf(project, programTime)
  const word = currentWord(project.transcript.words, source)
  if (!word) return `${project.name} · ${formatYoutubeClock(programTime)}`
  const index = project.transcript.words.findIndex((row) => row.id === word.id)
  return quoteFromSelection(project, sentenceIds(project.transcript.words, index)) ?? `${formatYoutubeClock(programTime)}: ${word.text}`
}

export function stillFilename(project: Project, programTime: number): string {
  const clock = formatYoutubeClock(programTime).replace(/:/g, '-')
  const safe = project.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'frame'
  return `${safe} ${clock}.png`
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
}> {
  const editor = useEditor.getState()
  const programTime = usePlayback.getState().programTime
  const caption = stillCaption(editor.project, programTime, editor.selectedWordIds)
  const filename = stillFilename(editor.project, programTime)
  if (typeof document === 'undefined') {
    return { copied: false, toast: 'Could not copy this frame.' }
  }
  const canvas = document.createElement('canvas')
  paintStill(canvas, { video: video ?? null, caption, title: editor.project.name })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return { copied: false, toast: 'Could not copy this frame.' }
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return { copied: true, toast: 'Copied the frame. Paste into the ticket.' }
    }
  } catch {
    /* fall through to a file they can drop */
  }
  downloadBlob(filename, blob)
  return { copied: false, toast: 'Downloaded the frame.' }
}
