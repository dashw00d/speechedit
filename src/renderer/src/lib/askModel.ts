import type { Project } from '../types'
import { EMPTY_SESSION, type EditorSession } from './agentContext'
import { runAgent, type AgentTurn } from './agent'
import { loadSettings } from './settings'

export async function askEditor(
  project: Project,
  intent: string,
  session: EditorSession = EMPTY_SESSION
): Promise<AgentTurn> {
  return runAgent(project, intent, session, loadSettings().intelligence)
}
