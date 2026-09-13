import type { Interval, Project } from '../types'
import { overlap } from './edl'
import { inferScenesLocal, normalizeScenes } from './sceneAnalysis'
import { isPlaceholderWord } from './transcript'

/** Complete the imported take without replacing chapters the editor already named or split. */
export function addMissingTranscriptChapters(project: Project, span: Interval): Project {
  let gaps = [span]
  for (const scene of project.scenes) {
    gaps = gaps.flatMap(gap => overlap(gap, scene) <= 0 ? [gap] : [
      { start: gap.start, end: Math.min(gap.end, scene.start) },
      { start: Math.max(gap.start, scene.end), end: gap.end }
    ].filter(gap => gap.end > gap.start))
  }
  const scenes = gaps.flatMap(gap => {
    const words = project.transcript.words.filter(word =>
      !word.deleted && !isPlaceholderWord(word) && word.start >= gap.start && word.end <= gap.end
    )
    if (!words.length) return []
    return inferScenesLocal({ sourceDuration: project.sourceDuration, transcript: { ...project.transcript, words } }).scenes
  })
  if (!scenes.length) return project
  return { ...project, scenes: normalizeScenes([...project.scenes, ...scenes]) }
}
