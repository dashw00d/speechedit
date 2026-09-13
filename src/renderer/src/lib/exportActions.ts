import { host, isElectron } from '../host'
import { programLength } from './commands'
import { captionsForExport, typedTapeNotes } from './captions'
import { summarizeJob, validateExportJob } from './exportGraph'
import { buildExportJob, type ExportVideoOpts } from './exportJob'
import {
  projectToAutoEditor,
  projectToChapters,
  projectToFcpxml,
  projectToKdenlive,
  projectToMlt,
  projectToOtio,
  projectToPremiere,
  projectToSrt,
  projectToTranscriptMd,
  projectToTranscriptTxt,
  projectToVtt
} from './interchange'
import { mediaToolsBlocker } from './mediaHealth'
import { cancelExport, isJobCancelled, mediaBusyToast } from './mediaJobs'
import { saveTextExport } from './saveText'
import { formatClock } from './time'
import { useEditor } from '../store'
import type { Asset, Project } from '../types'
import type { ToastFn } from './fileActions'
import type { ToastDispatch, ToastEntry } from './toastActions'
import { relinkAssetInteractive } from './documentIo'
import { failActivity, finishActivity, startActivity, updateActivity } from './activity'

export type SidecarId =
  | 'srt'
  | 'vtt'
  | 'md'
  | 'txt'
  | 'chapters'
  | 'otio'
  | 'fcpxml'
  | 'premiere'
  | 'autoeditor'
  | 'mlt'
  | 'kdenlive'

export interface SidecarSpec {
  id: SidecarId
  label: string
  hint: string
  group: 'common' | 'pipeline'
  ext: string
  body: (project: Project) => string
  ready: (project: Project) => boolean
}

function hasWords(project: Project): boolean {
  return project.transcript.words.some((word) => !word.deleted)
}

/** True when the reel has a video A-roll. Audio-only meetings and podcasts do not. */
export function projectHasPicture(project: Project): boolean {
  return Object.values(project.assets).some((asset) => asset.kind === 'video')
}

function hasCaptions(project: Project): boolean {
  return captionsForExport(project).length > 0
}

function hasProgram(project: Project): boolean {
  return programLength(project) > 0.05 || hasWords(project)
}

export const SIDECARS: SidecarSpec[] = [
  {
    id: 'srt',
    label: 'Captions · SRT',
    hint: 'YouTube, Premiere, most players',
    group: 'common',
    ext: '.srt',
    body: projectToSrt,
    ready: hasCaptions
  },
  {
    id: 'vtt',
    label: 'Captions · VTT',
    hint: 'Web players and YouTube Studio',
    group: 'common',
    ext: '.vtt',
    body: projectToVtt,
    ready: hasCaptions
  },
  {
    id: 'md',
    label: 'Transcript · Markdown',
    hint: 'Copy notes with chapter headings. Paste into Slack or Notion.',
    group: 'common',
    ext: '.md',
    body: projectToTranscriptMd,
    ready: hasWords
  },
  {
    id: 'txt',
    label: 'Transcript · Text',
    hint: 'Plain words for another editor',
    group: 'common',
    ext: '.txt',
    body: projectToTranscriptTxt,
    ready: hasWords
  },
  {
    id: 'chapters',
    label: 'Chapters · YouTube',
    hint: 'Copy timestamps. Paste into the description.',
    group: 'common',
    ext: '.chapters.txt',
    body: projectToChapters,
    ready: (project) => Boolean(projectToChapters(project))
  },
  {
    id: 'otio',
    label: 'OpenTimelineIO',
    hint: 'Resolve and other NLEs',
    group: 'pipeline',
    ext: '.otio',
    body: projectToOtio,
    ready: hasProgram
  },
  {
    id: 'fcpxml',
    label: 'Final Cut XML',
    hint: 'Hand off the cut list',
    group: 'pipeline',
    ext: '.fcpxml',
    body: projectToFcpxml,
    ready: hasProgram
  },
  {
    id: 'premiere',
    label: 'Premiere XML',
    hint: 'Adobe sequence interchange',
    group: 'pipeline',
    ext: '.xml',
    body: projectToPremiere,
    ready: hasProgram
  },
  {
    id: 'autoeditor',
    label: 'Auto-Editor JSON',
    hint: 'v3 timeline for Auto-Editor',
    group: 'pipeline',
    ext: '.autoeditor.json',
    body: projectToAutoEditor,
    ready: hasProgram
  },
  {
    id: 'mlt',
    label: 'Shotcut MLT',
    hint: 'Shotcut project',
    group: 'pipeline',
    ext: '.mlt',
    body: projectToMlt,
    ready: hasProgram
  },
  {
    id: 'kdenlive',
    label: 'Kdenlive',
    hint: 'Kdenlive project',
    group: 'pipeline',
    ext: '.kdenlive',
    body: projectToKdenlive,
    ready: hasProgram
  }
]

export function copyToastForSidecar(id: SidecarId, project?: Project): string | null {
  if (id === 'chapters') {
    const n = project ? youtubeChapterCount(project) : 0
    return n > 1
      ? `Copied ${n} YouTube chapters. Paste into the description.`
      : 'Copied YouTube chapters. Paste into the description.'
  }
  if (id === 'md') {
    const n = project ? typedTapeNotes(project).length : 0
    if (n) {
      return n === 1
        ? 'Copied the notes. The mark you typed is in the paste. Drop it into Slack or Notion.'
        : `Copied the notes. ${n} marks you typed are in the paste. Drop it into Slack or Notion.`
    }
    return 'Copied the notes. Chapter headings are in the paste. Drop it into Slack or Notion.'
  }
  if (id === 'srt') return 'Copied the captions. Upload the SRT next to the MP4.'
  return null
}

/** SRT is a file YouTube and an LMS can upload. Copy is extra. */
export function sidecarAlsoSaves(id: SidecarId): boolean {
  return id === 'srt'
}

export function fileToastForSidecar(id: SidecarId, filename: string): string {
  const verb = isElectron ? 'Saved' : 'Downloaded'
  if (id === 'srt') return `${verb} ${filename}. Upload it next to the MP4.`
  if (id === 'md') return `${verb} ${filename}. Drop it into Slack or Notion.`
  if (id === 'chapters') return `${verb} ${filename}. Paste into the description.`
  return `${verb} ${filename}`
}

export function hasExportableCaptions(project: Project): boolean {
  return sidecarById('srt').ready(project)
}

export function youtubeChapterCount(project: Project): number {
  const text = projectToChapters(project)
  return text ? text.split('\n').filter(Boolean).length : 0
}

export function hasYouTubeChapters(project: Project): boolean {
  return youtubeChapterCount(project) >= 2
}

export function sidecarById(id: SidecarId): SidecarSpec {
  const spec = SIDECARS.find((item) => item.id === id)
  if (!spec) throw new Error(`Unknown export ${id}`)
  return spec
}

export function canPackSidecars(project: Project): boolean {
  return SIDECARS.some((item) => item.group === 'common' && item.ready(project))
}

/** Media that only has a shared preview. Playback works; the final render needs the original. */
export function proxyOnlyAssets(project: Project): Asset[] {
  return Object.values(project.assets).filter((asset) => asset.proxyOnly)
}

function proxyRelinkMessage(count: number): string {
  if (count <= 1) return 'Relink the original recording to render the final video.'
  return `Relink ${count} original recordings to render the final video.`
}

function proxyRelinkDetail(count: number): string {
  if (count <= 1) return 'The shared copy can preview but not render. Relink the original recording.'
  return `The shared copies can preview but not render. Relink ${count} original recordings.`
}

/**
 * Hand the blocked final render to the existing relink flow, one original at a time.
 * After the last original is relinked, `retry` re-runs the export on the same path.
 */
export async function relinkProxyOriginals(
  onToast: ToastDispatch,
  retry?: () => void
): Promise<void> {
  const next = proxyOnlyAssets(useEditor.getState().project)[0]
  if (!next) {
    retry?.()
    return
  }
  const result = await relinkAssetInteractive(next.id)
  const remaining = proxyOnlyAssets(useEditor.getState().project).length
  if (remaining === 0) {
    retry?.()
    return
  }
  const message =
    result === null ? proxyPreviewAfterCancel(remaining) : proxyPreviewProgress(remaining)
  onToast(proxyRelinkEntry(message, onToast, retry))
}

function proxyPreviewAfterCancel(remaining: number): string {
  return remaining === 1
    ? 'Still needs the original recording to render. Relink it when the file is handy.'
    : `Still needs ${remaining} original recordings to render. Relink them when the files are handy.`
}

function proxyPreviewProgress(remaining: number): string {
  return remaining === 1
    ? 'Relinked. One original recording left before the final render.'
    : `Relinked. ${remaining} original recordings left before the final render.`
}

function proxyRelinkEntry(message: string, onToast: ToastDispatch, retry?: () => void): ToastEntry {
  return {
    message,
    action: {
      label: 'Relink original media',
      ariaLabel: 'Relink the original recording',
      run: () => {
        void relinkProxyOriginals(onToast, retry)
      }
    }
  }
}

function offerProxyRelink(onToast: ToastDispatch, retry?: () => void): void {
  const count = proxyOnlyAssets(useEditor.getState().project).length
  if (!count) {
    retry?.()
    return
  }
  onToast(proxyRelinkEntry(proxyRelinkMessage(count), onToast, retry))
}

/** Render the movie when we can. Otherwise ship the words — the studio demo has no file on disk. */
export function exportPrimaryCopy(
  project: Project,
  opts: ExportVideoOpts = {},
  electron = isElectron
): { label: string; detail: string; kind: 'render' | 'pack' | 'blocked' | 'relink' } {
  const video = videoExportCopy(project, opts)
  if (video.ready && electron) {
    return {
      label: opts.audioOnly ? 'Audio · M4A' : 'Video · MP4',
      detail: video.summary,
      kind: 'render'
    }
  }
  const shared = proxyOnlyAssets(project).length
  if (shared) {
    return {
      label: 'Relink original media',
      detail: proxyRelinkDetail(shared),
      kind: 'relink'
    }
  }
  if (canPackSidecars(project)) {
    return {
      label: 'Download the words',
      detail: opts.audioOnly
        ? 'M4A needs a recording on disk and the desktop app. This saves the words and chapters.'
        : 'MP4 needs a recording on disk and the desktop app. This saves captions and the transcript.',
      kind: 'pack'
    }
  }
  return {
    label: opts.audioOnly ? 'Audio · M4A' : 'Video · MP4',
    detail: video.summary,
    kind: 'blocked'
  }
}

export function videoExportCopy(
  project: Project,
  opts: ExportVideoOpts = {}
): { ready: boolean; summary: string; problem: string | null } {
  if (opts.markedOnly && (project.markIn == null || project.markOut == null)) {
    return {
      ready: false,
      summary: 'Set In and Out first.',
      problem: 'Mark In and Out, then export just that stretch.'
    }
  }
  const job = buildExportJob(project, '', opts)
  if (!job) {
    const hasProgram = programLength(project) > 0.05
    return {
      ready: false,
      summary: hasProgram ? 'No media file on disk to render.' : 'Open a recording first.',
      problem: hasProgram
        ? opts.audioOnly
          ? 'This reel has no linked recording. Open media or relink, then export audio.'
          : 'This reel has no linked recording. Open media or relink, then export video.'
        : 'Open media to export a program.'
    }
  }
  const problem = validateExportJob(job)
  const duration = formatClock(job.duration || programLength(project))
  const extras = [
    opts.markedOnly ? 'marked range' : null,
    opts.audioOnly ? 'audio only' : null,
    project.audioMaster.normalize ? '-16 LUFS' : null,
    opts.burnCaptions === false ? 'no burned captions' : null,
    !opts.audioOnly && project.height > project.width ? '9:16' : null
  ].filter(Boolean)
  return {
    ready: !problem,
    summary: `${duration} · ${summarizeJob(job)}${extras.length ? ` · ${extras.join(' · ')}` : ''}`,
    problem
  }
}

export async function exportContentPackage(onToast: ToastFn, note?: string): Promise<void> {
  const project = useEditor.getState().project
  const ready = SIDECARS.filter((item) => item.group === 'common' && item.ready(project))
  if (!ready.length) {
    onToast('Nothing to pack yet — need words, captions, or chapters.')
    return
  }
  let saved = 0
  for (const spec of ready) {
    try {
      const filename = `${project.name}${spec.ext}`
      const path = await saveTextExport(filename, spec.body(project))
      if (path) saved += 1
    } catch {
      /* keep going so one format cannot block the pack */
    }
  }
  if (!saved) {
    onToast('Package export was cancelled.')
    return
  }
  onToast(
    note ??
      (isElectron
        ? `Saved ${saved} files · captions, transcript, chapters`
        : `Downloaded ${saved} files · captions, transcript, chapters`)
  )
}

export async function exportSidecar(id: SidecarId, onToast: ToastFn): Promise<void> {
  const spec = sidecarById(id)
  const project = useEditor.getState().project
  if (!spec.ready(project)) {
    onToast(`Nothing to export for ${spec.label.toLowerCase()} yet.`)
    return
  }
  const body = spec.body(project)
  const copiedToast = copyToastForSidecar(id, project)
  let copied = false
  if (copiedToast) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body)
        copied = true
        if (!sidecarAlsoSaves(id)) {
          onToast(copiedToast)
          return
        }
      }
    } catch {
      /* fall through to a file they can open */
    }
  }
  const filename = `${project.name}${spec.ext}`
  try {
    const path = await saveTextExport(filename, body)
    if (!path) {
      if (copied && copiedToast) onToast(copiedToast)
      return
    }
    onToast(copied && copiedToast ? copiedToast : fileToastForSidecar(id, filename))
  } catch (err) {
    onToast(err instanceof Error ? err.message : 'Export failed.')
  }
}

export async function exportVideoAction(onToast: ToastDispatch, opts: ExportVideoOpts = {}): Promise<void> {
  if (proxyOnlyAssets(useEditor.getState().project).length) {
    offerProxyRelink(onToast, () => void exportVideoAction(onToast, opts))
    return
  }
  const editor = useEditor.getState()
  if (editor.exporting) {
    void cancelExport()
    return
  }
  const busy = mediaBusyToast(false, editor.analyzing)
  if (busy) {
    onToast(busy)
    return
  }
  const info = videoExportCopy(editor.project, opts)
  const primary = exportPrimaryCopy(editor.project, opts)
  if (primary.kind === 'pack') {
    await exportContentPackage(
      onToast,
      opts.audioOnly
        ? 'Downloaded the words. M4A needs the desktop app and a linked recording.'
        : 'Downloaded captions and the transcript. MP4 needs the desktop app and a linked recording.'
    )
    return
  }
  if (!info.ready) {
    onToast(info.problem ?? 'Open media to export a program.')
    return
  }
  const job = buildExportJob(editor.project, '', opts)
  if (!job) {
    onToast('Open media to export a program.')
    return
  }
  if (isElectron) {
    const blocked = await mediaToolsBlocker()
    if (blocked) {
      onToast(blocked)
      return
    }
  }
  const picked = await host.chooseExport()
  if (!picked) return
  const output = opts.audioOnly ? picked.replace(/\.[^.]+$/, '.m4a') : picked
  editor.setExporting(true)
  startActivity({
    id: 'media:export',
    label: opts.audioOnly ? 'Exporting audio' : 'Exporting video',
    detail: info.summary,
    ratio: 0,
    cancellable: 'export'
  })
  onToast(`Export 0% — ${info.summary}`)
  const stop = host.onExportProgress((progress) => {
    updateActivity('media:export', { ratio: progress.ratio, detail: progress.stage })
    onToast(`Export ${Math.round(progress.ratio * 100)}% — ${progress.stage}`)
  })
  let keepErrorVisible = false
  try {
    await host.exportProgram({ ...job, output })
    onToast(
      opts.markedOnly
        ? `Export finished — ${info.summary}. File: ${output} Clear marks for the next clip.`
        : `Export finished — ${info.summary}. File: ${output}`
    )
  } catch (err) {
    if (!isJobCancelled(err)) {
      failActivity('media:export', err instanceof Error ? err.message : 'Export failed.')
      keepErrorVisible = true
    }
    onToast(isJobCancelled(err) ? 'Export cancelled.' : err instanceof Error ? err.message : 'Export failed.')
  } finally {
    stop()
    if (!keepErrorVisible) finishActivity('media:export')
    useEditor.getState().setExporting(false)
  }
}
