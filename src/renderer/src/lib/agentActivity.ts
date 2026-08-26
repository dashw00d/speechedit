import type { AgentCall } from './agent'

export interface AgentActivityTurn {
  id: string
  question: string
  answer: string
  calls: AgentCall[]
  changed: boolean
  failed?: boolean
  completedAt: number
  parentId?: string
}

export interface AgentActivityState {
  turns: AgentActivityTurn[]
  selectedId: string | null
}

let nextId = 1
const states = new Map<string, AgentActivityState>()
const listeners = new Map<string, Set<(next: AgentActivityState) => void>>()

function stateFor(projectId: string): AgentActivityState {
  const existing = states.get(projectId)
  if (existing) return existing
  const created: AgentActivityState = { turns: [], selectedId: null }
  states.set(projectId, created)
  return created
}

function publish(projectId: string): void {
  const current = stateFor(projectId)
  const next = { ...current, turns: [...current.turns] }
  states.set(projectId, next)
  for (const listener of listeners.get(projectId) ?? []) listener(next)
}

export function agentActivityState(projectId: string): AgentActivityState {
  return stateFor(projectId)
}

export function subscribeAgentActivity(
  projectId: string,
  listener: (next: AgentActivityState) => void
): () => void {
  const projectListeners = listeners.get(projectId) ?? new Set()
  projectListeners.add(listener)
  listeners.set(projectId, projectListeners)
  listener(stateFor(projectId))
  return () => {
    projectListeners.delete(listener)
    if (projectListeners.size === 0) listeners.delete(projectId)
  }
}

export function recordAgentTurn(
  projectId: string,
  turn: Omit<AgentActivityTurn, 'id' | 'completedAt'>
): AgentActivityTurn {
  const recorded: AgentActivityTurn = {
    ...turn,
    id: `agent-turn-${nextId++}`,
    completedAt: Date.now()
  }
  const state = stateFor(projectId)
  state.turns = [recorded, ...state.turns].slice(0, 12)
  publish(projectId)
  return recorded
}

export function selectAgentTurn(projectId: string, id: string | null): void {
  const state = stateFor(projectId)
  state.selectedId = id
  publish(projectId)
}

export function selectedAgentTurn(projectId: string): AgentActivityTurn | undefined {
  const state = stateFor(projectId)
  return state.turns.find((turn) => turn.id === state.selectedId)
}
