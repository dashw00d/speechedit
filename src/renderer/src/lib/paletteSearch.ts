import type { PaletteSpec } from './contextActions'
import { sourceToProgramOf } from './resolver'
import { useEditor, usePlayback } from '../store'
import type { Project } from '../types'

export function paletteSearchHits(project: Project, query: string): PaletteSpec[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const hits: PaletteSpec[] = []

  for (const scene of project.scenes ?? []) {
    const hay = `${scene.title} ${scene.summary ?? ''} ${scene.kind}`.toLowerCase()
    if (!hay.includes(q)) continue
    hits.push({
      name: `Scene · ${scene.title}`,
      group: 'selection',
      run: () => {
        const editor = useEditor.getState()
        editor.selectScene(scene.id)
        editor.clearSelection()
        usePlayback.getState().seekSource(scene.start)
      }
    })
  }

  for (const sug of project.suggestions.filter((s) => !s.applied)) {
    const hay = `${sug.label} ${sug.type}`.toLowerCase()
    if (!hay.includes(q)) continue
    hits.push({
      name: `Suggestion · ${sug.label}`,
      group: 'selection',
      run: () => {
        const editor = useEditor.getState()
        editor.selectSuggestion(sug.id)
        usePlayback.getState().seekProgram(sourceToProgramOf(editor.project, sug.start))
      }
    })
  }

  return hits
}
