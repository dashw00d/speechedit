import { host, isElectron } from '../host'
import { programLength } from './commands'
import { captionsForExport } from './captions'
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
import { cancelExport, isJobCancelled, mediaBusyToast } from './mediaJobs'
import { saveTextExport } from './saveText'
import { formatClock } from './time'
import { useEditor } from '../store'
import type { Project } from '../types'
import type { ToastFn } from './fileActions'

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
    hint: 'Copy speaker notes. Paste into Slack or Notion.',
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

export function copyToastForSidecar(id: SidecarId): string | null {
  if (id === 'chapters') return 'Copied YouTube chapters. Paste into the description.'
  if (id === 'md') return 'Copied the transcript. Paste into Slack or Notion.'
  return null
}

export function sidecarById(id: SidecarId): SidecarSpec {
  const spec = SIDECARS.find((item) => item.id === id)
  if (!spec) throw new Error(`Unknown export ${id}`)
  return spec
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

export async function exportContentPackage(onToast: ToastFn): Promise<void> {
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
    isElectron
      ? `Saved ${saved} files · captions, transcript, chapters`
      : `Downloaded ${saved} files · captions, transcript, chapters`
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
  const copied = copyToastForSidecar(id)
  if (copied) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body)
        onToast(copied)
        return
      }
    } catch {
      /* fall through to a file they can open */
    }
  }
  const filename = `${project.name}${spec.ext}`
  try {
    const path = await saveTextExport(filename, body)
    if (!path) return
    onToast(isElectron ? `Saved ${filename}` : `Downloaded ${filename}`)
  } catch (err) {
    onToast(err instanceof Error ? err.message : 'Export failed.')
  }
}

export async function exportVideoAction(onToast: ToastFn, opts: ExportVideoOpts = {}): Promise<void> {
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
  if (!info.ready) {
    onToast(info.problem ?? 'Open media to export a program.')
    return
  }
  if (!isElectron) {
    onToast(
      opts.audioOnly
        ? opts.markedOnly
          ? 'Audio export needs the desktop app. Captions still download here. Clear marks for the next clip.'
          : 'Audio export needs the desktop app. Captions and transcripts still download here.'
        : opts.markedOnly
          ? 'Video export needs the desktop app. Captions still download here. Clear marks for the next clip.'
          : 'Video export needs the desktop app. Captions and transcripts still download here.'
    )
    return
  }
  const job = buildExportJob(editor.project, '', opts)
  if (!job) {
    onToast('Open media to export a program.')
    return
  }
  const picked = await host.chooseExport()
  if (!picked) return
  const output = opts.audioOnly ? picked.replace(/\.[^.]+$/, '.m4a') : picked
  editor.setExporting(true)
  onToast(`Export 0% — ${info.summary}`)
  const stop = host.onExportProgress((progress) =>
    onToast(`Export ${Math.round(progress.ratio * 100)}% — ${progress.stage}`)
  )
  try {
    await host.exportProgram({ ...job, output })
    onToast(
      opts.markedOnly
        ? `Export finished — ${info.summary}. File: ${output} Clear marks for the next clip.`
        : `Export finished — ${info.summary}. File: ${output}`
    )
  } catch (err) {
    onToast(isJobCancelled(err) ? 'Export cancelled.' : err instanceof Error ? err.message : 'Export failed.')
  } finally {
    stop()
    useEditor.getState().setExporting(false)
  }
}
