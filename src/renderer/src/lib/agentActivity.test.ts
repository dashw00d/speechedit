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
    const projectId = 'project-activity-test'
    selectAgentTurn(projectId, null)
    let updates = 0
    const unsubscribe = subscribeAgentActivity(projectId, () => { updates += 1 })
    const turn = recordAgentTurn(projectId, {
      question: 'Tighten this section',
      answer: 'Tightened two pauses.',
      calls: [],
      changed: true,
    })
    selectAgentTurn(projectId, turn.id)
    expect(selectedAgentTurn(projectId)).toEqual(turn)
    expect(agentActivityState(projectId).turns[0]).toEqual(turn)
    expect(updates).toBeGreaterThanOrEqual(3)
    unsubscribe()
  })

  test('keeps history and follow-up selection isolated by project', () => {
    const first = recordAgentTurn('project-a', {
      question: 'Split this scene',
      answer: 'Split it.',
      calls: [],
      changed: true
    })
    recordAgentTurn('project-b', {
      question: 'Add music',
      answer: 'Added it.',
      calls: [],
      changed: true
    })
    selectAgentTurn('project-a', first.id)

    expect(agentActivityState('project-a').turns.map((turn) => turn.question)).toEqual(['Split this scene'])
    expect(agentActivityState('project-b').turns.map((turn) => turn.question)).toEqual(['Add music'])
    expect(selectedAgentTurn('project-a')?.id).toBe(first.id)
    expect(selectedAgentTurn('project-b')).toBeUndefined()
  })
})
