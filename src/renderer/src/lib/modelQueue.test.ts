import { describe, expect, test } from 'bun:test'
import { ModelQueue } from '../../../shared/modelQueue'

describe('model request queue', () => {
  test('runs expensive requests one at a time in FIFO order', async () => {
    const releases: (() => void)[] = []
    const order: string[] = []
    const queue = new ModelQueue()
    const task = (name: string) => queue.enqueue(async () => {
      order.push(`start:${name}`)
      await new Promise<void>((resolve) => releases.push(resolve))
      order.push(`end:${name}`)
      return name
    }, { label: name })

    const first = task('first')
    const second = task('second')
    await Promise.resolve()
    expect(order).toEqual(['start:first'])
    expect(queue.status()).toMatchObject({ active: true, pending: 1 })
    expect(queue.status().jobs.map(({ label, state }) => ({ label, state }))).toEqual([
      { label: 'first', state: 'running' },
      { label: 'second', state: 'waiting' }
    ])

    releases.shift()?.()
    await first
    await Promise.resolve()
    expect(order).toEqual(['start:first', 'end:first', 'start:second'])

    releases.shift()?.()
    expect(await second).toBe('second')
    expect(queue.status()).toMatchObject({ active: false, pending: 0 })
    expect(queue.status().jobs[0]).toMatchObject({ label: 'second', state: 'done' })
  })

  test('continues after a failed request', async () => {
    const queue = new ModelQueue()
    const failed = queue.enqueue(async () => { throw new Error('nope') }, { label: 'Broken request' })
    const next = queue.enqueue(async () => 'ok', { label: 'Next request' })
    await expect(failed).rejects.toThrow('nope')
    expect(await next).toBe('ok')
    expect(queue.status().jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Broken request', state: 'error', error: 'nope' }),
      expect.objectContaining({ label: 'Next request', state: 'done' })
    ]))
  })
})
