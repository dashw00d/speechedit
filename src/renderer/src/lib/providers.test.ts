import { describe, expect, test } from 'bun:test'
import { extractJson } from './providers'

describe('model JSON extraction', () => {
  test('parses strict and fenced replies', () => {
    expect(extractJson('{"note":"ok","calls":[]}')).toEqual({ note: 'ok', calls: [] })
    expect(extractJson('```json\n{"note":"ok","calls":[]}\n```')).toEqual({ note: 'ok', calls: [] })
  })

  test('repairs one unmatched structural bracket without changing strings', () => {
    const malformed = '{"note":"keep ] here","calls":[{"name":"split_scene","args":{"title":"Core"}}]]}'
    expect(extractJson(malformed)).toEqual({
      note: 'keep ] here',
      calls: [{ name: 'split_scene', args: { title: 'Core' } }]
    })
  })

  test('repairs common model JSON mistakes', () => {
    expect(extractJson("{'note':'ok','calls':[],}")).toEqual({ note: 'ok', calls: [] })
    expect(extractJson('{"note":"ok" "calls":[]}')).toEqual({ note: 'ok', calls: [] })
  })

  test('does not reinterpret ordinary prose as a tool plan', () => {
    expect(() => extractJson('The strongest opening is the thesis.')).toThrow('Model reply was not JSON')
  })
})
