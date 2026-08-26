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
let state: AgentActivityState = { turns: [], selectedId: null }
const listeners = new Set<(next: AgentActivityState) => void>()

function publish(): void {
  state = { ...state, turns: [...state.turns] }
  for (const listener of listeners) listener(state)
}

export function agentActivityState(): AgentActivityState {
  return state
}

export function subscribeAgentActivity(listener: (next: AgentActivityState) => void): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export function recordAgentTurn(turn: Omit<AgentActivityTurn, 'id' | 'completedAt'>): AgentActivityTurn {
  const recorded: AgentActivityTurn = {
    ...turn,
    id: `agent-turn-${nextId++}`,
    completedAt: Date.now()
  }
  state.turns = [recorded, ...state.turns].slice(0, 12)
  publish()
  return recorded
}

export function selectAgentTurn(id: string | null): void {
  state.selectedId = id
  publish()
}

export function selectedAgentTurn(): AgentActivityTurn | undefined {
  return state.turns.find((turn) => turn.id === state.selectedId)
}
