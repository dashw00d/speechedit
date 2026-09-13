import { describe, expect, test } from 'bun:test'
import { browserGpuUnavailableReason } from './browserGpu'

describe('browser GPU availability', () => {
  test('requires a secure context before querying the GPU', async () => {
    let queried = false
    expect(await browserGpuUnavailableReason(false, { requestAdapter: async () => { queried = true; return {} } })).toContain('HTTPS')
    expect(queried).toBe(false)
  })
  test('explains missing WebGPU and an unavailable adapter separately', async () => {
    expect(await browserGpuUnavailableReason(true)).toContain('does not expose WebGPU')
    expect(await browserGpuUnavailableReason(true, { requestAdapter: async () => null })).toContain('could not access a GPU')
  })
  test('only selects WebGPU when an adapter is available', async () => {
    expect(await browserGpuUnavailableReason(true, { requestAdapter: async () => ({}) })).toBeUndefined()
  })
  test('retains the reason when the browser rejects adapter access', async () => {
    expect(await browserGpuUnavailableReason(true, { requestAdapter: async () => { throw new Error('adapter blocked') } })).toContain('adapter blocked')
  })
})
