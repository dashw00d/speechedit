import type { Project } from '../types'
import { host } from '../host'
import { applyCommand } from './commands'
import { intelligencePrompt, parseIntelligence } from './intelligence'
import { planIntent } from './intent'
import { extractJson } from './providers'
import { inferScenesLocal } from './sceneAnalysis'
import { loadSettings } from './settings'

export async function askEditor(project: Project, intent: string): Promise<{ project: Project; message: string }> {
  const settings = loadSettings()
  const local = planIntent(project, intent)
  const sceneAsk = /scene|retake|chapter|understand|analyze/.test(intent.toLowerCase())

  if (settings.intelligence.kind === 'openai-compatible' && settings.intelligence.baseUrl && !local.commands.length) {
    try {
      const prompt = intelligencePrompt(project, intent)
      const text = await host.complete({
        endpoint: settings.intelligence,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ]
      })
      const draft = parseIntelligence(extractJson(text))
      let next = applyCommand(project, {
        type: 'mergeIntelligence',
        scenes: draft.scenes,
        suggestions: draft.suggestions
      })
      next = draft.commands.reduce((acc, command) => applyCommand(acc, command), next)
      return { project: next, message: draft.notes || `Model · ${draft.scenes.length} scenes` }
    } catch (err) {
      if (!sceneAsk && !local.commands.length) throw err
    }
  }

  if (local.commands.length) {
    const next = local.commands.reduce((acc, command) => applyCommand(acc, command), project)
    return { project: next, message: local.note }
  }

  if (sceneAsk) {
    const draft = inferScenesLocal(project)
    const next = applyCommand(project, {
      type: 'mergeIntelligence',
      scenes: draft.scenes,
      suggestions: draft.suggestions
    })
    return {
      project: next,
      message: `Local intelligence · ${draft.scenes.length} scenes · ${draft.suggestions.length} retake cuts (no LLM).`
    }
  }

  return { project, message: local.note }
}
