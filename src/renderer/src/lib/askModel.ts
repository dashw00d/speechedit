import type { Project } from '../types'
import { host } from '../host'
import { applyCommand } from './commands'
import { intelligencePrompt, parseIntelligence } from './intelligence'
import { planIntent } from './intent'
import { extractJson } from './providers'
import { loadSettings } from './settings'

export async function askEditor(project: Project, intent: string): Promise<{ project: Project; message: string }> {
  const settings = loadSettings()
  if (settings.intelligence.kind === 'openai-compatible' && settings.intelligence.baseUrl) {
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
  }
  const plan = planIntent(project, intent)
  const next = plan.commands.reduce((acc, command) => applyCommand(acc, command), project)
  return { project: next, message: plan.note }
}
