import type { Command, Interval, Project } from '../types'
import { useEditor, usePlayback } from '../store'
import { programToSourceOf, resolveMediaSegments } from './resolver'
import { prepareProjectRecording } from './recordingEdges'

export function recordingEdgeMuteCommands(project: Project, clipId: string, expanded: Interval): Command[] {
  const track = project.tracks.find(t => t.clips.some(c => c.id === clipId))
  const clip = track?.clips.find(c => c.id === clipId)
  if (!clip?.replaceVoice) throw new Error('Choose a replacement recording.')
  if (track?.locked || project.tracks.some(t => t.id === 'a1' && t.locked)) throw new Error('Unlock the voice track before cleaning up its edges.')
  const start = programToSourceOf(project, clip.start), end = programToSourceOf(project, clip.start + clip.duration)
  const commands: Command[] = []
  const segments = resolveMediaSegments(project)
  const audible = (a: number, b: number) => segments.some(s => s.inPoint < b && s.outPoint > a && s.volume > 0.001)
  if (expanded.start < start - 0.005 && audible(expanded.start, start)) commands.push({ type: 'setRangeVolume', start: expanded.start, end: start, volume: 0 })
  if (expanded.end > end + 0.005 && audible(end, expanded.end)) commands.push({ type: 'setRangeVolume', start: end, end: expanded.end, volume: 0 })
  return commands
}

export async function cleanRecordingEdges(clipId: string): Promise<string> {
  const project = useEditor.getState().project
  const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === clipId)
  if (!clip?.replaceVoice) throw new Error('Choose a replacement recording.')
  const range = { start: programToSourceOf(project, clip.start), end: programToSourceOf(project, clip.start + clip.duration) }
  recordingEdgeMuteCommands(project, clipId, range)
  usePlayback.getState().pause()
  const result = await prepareProjectRecording(project, range, new AbortController().signal)
  const editor = useEditor.getState()
  if (editor.project !== project) throw new Error('The edit changed while checking the audio. Try cleaning up its edges again.')
  const commands = recordingEdgeMuteCommands(project, clipId, result.range)
  if (!commands.length) return result.range.start < range.start || result.range.end > range.end ? 'The original voice is already muted at these edges.' : result.note
  editor.beginHistoryGroup()
  try { for (const command of commands) editor.dispatch(command) }
  finally { editor.endHistoryGroup() }
  return 'Muted the original voice out to nearby pauses. Your take stays in place. Undo restores the edges.'
}
