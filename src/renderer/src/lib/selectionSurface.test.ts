import { describe, expect, test } from 'bun:test'
import { KEEPS_SELECTION } from './selectionSurface'

describe('selection surface', () => {
  test('suggest bar and menu keep the chapter so Add zoom can read it', () => {
    expect(KEEPS_SELECTION).toContain('.suggest-bar')
    expect(KEEPS_SELECTION).toContain('.menubar')
    expect(KEEPS_SELECTION).toContain('.inspector')
    expect(KEEPS_SELECTION).toContain('.scene-chip')
  })
})
