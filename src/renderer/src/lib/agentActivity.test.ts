import { describe, expect, test } from 'bun:test'
import {
  agentActivityState,
  recordAgentTurn,
  selectAgentTurn,
  selectedAgentTurn,
  subscribeAgentActivity
} from './agentActivity'

describe('agent activity history', () => {
  test('records completed calls and selects one as follow-up context', () => {
    selectAgentTurn(null)
    let updates = 0
    const unsubscribe = subscribeAgentActivity(() => { updates += 1 })
    const turn = recordAgentTurn({
      question: 'Tighten this section',
      answer: 'Tightened two pauses.',
      calls: [],
      changed: true,
    })
    selectAgentTurn(turn.id)
    expect(selectedAgentTurn()).toEqual(turn)
    expect(agentActivityState().turns[0]).toEqual(turn)
    expect(updates).toBeGreaterThanOrEqual(3)
    unsubscribe()
  })
})
