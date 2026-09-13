import { expect, test } from 'bun:test'
import { createDemoProject } from './demo'
import { applyCommand } from './commands'
import { projectToExportJob } from './exportJob'
import { buildSegmentFilters } from './exportGraph'
import { sampleProgram } from './programLook'

test('eye toggles disable the corresponding output without changing duration or removing tracks', () => {
  const original = createDemoProject()
  const before = projectToExportJob(original)
  for (const id of ['v1', 'a1', 'v2', 'v3']) {
    const hidden = applyCommand(original, { type: 'setTrackFlag', trackId: id, patch: { hidden: true } })
    const job = projectToExportJob(hidden)
    expect(job.duration).toBe(before.duration)
    expect(hidden.tracks.map(t => t.id)).toEqual(original.tracks.map(t => t.id))
    expect(hidden.tracks.find(t => t.id === id)?.clips).toEqual(original.tracks.find(t => t.id === id)?.clips)
    if (id === 'v1') {
      expect(job.segments.every(s => s.opacity === 0)).toBe(true)
      expect(sampleProgram(job, 1).incomingOpacity).toBe(0)
      expect(buildSegmentFilters(job, job.segments[0]).vf).toContain('drawbox=color=black:t=fill')
      expect(job.segments.map(s => s.volume)).toEqual(before.segments.map(s => s.volume))
    }
    if (id === 'a1') {
      expect(sampleProgram(job, 1).voice.gain).toBe(0)
      expect(job.segments.map(s => s.opacity)).toEqual(before.segments.map(s => s.opacity))
    }
    const restored = applyCommand(hidden, { type: 'setTrackFlag', trackId: id, patch: { hidden: false } })
    expect(projectToExportJob(restored)).toEqual(before)
  }
})
