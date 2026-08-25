import { describe, expect, test } from 'bun:test'
import type { Project } from '../types'
import { applyCommand, programLength } from './commands'
import { createDemoProject, createEmptyProject } from './demo'
import { programmedSegments } from './exportGraph'
import { projectToExportJob } from './exportJob'
import {
  programLengthOf,
  programToSourceOf,
  resolveProgram,
  resolveSegments,
  sourceToProgramOf,
  wordSnapTimes
} from './resolver'

function sourceToProgramLinear(segs: { kind?: string; inPoint: number; outPoint: number; start: number; duration: number; speed: number; overlapNext: number }[], sourceTime: number): number {
  let program = 0
  for (const seg of segs) {
    if (seg.kind === 'slug') {
      program += seg.duration - seg.overlapNext
      continue
    }
    if (sourceTime < seg.inPoint) return program
    if (sourceTime <= seg.outPoint) return program + (sourceTime - seg.inPoint) / seg.speed
    program += seg.duration - seg.overlapNext
  }
  return program
}

function programToSourceLinear(
  segs: { kind?: string; inPoint: number; start: number; duration: number; speed: number }[],
  programTime: number
): number {
  const hits = segs.filter((s) => programTime >= s.start && programTime < s.start + s.duration)
  const seg = hits[hits.length - 1] ?? segs.find((s) => programTime < s.start) ?? segs[segs.length - 1]
  if (!seg) return 0
  if (seg.kind === 'slug') return seg.inPoint
  const local = Math.min(seg.duration, Math.max(0, programTime - seg.start))
  return seg.inPoint + local * seg.speed
}

function denseTalk(cuts = 400): Project {
  const sourceDuration = cuts * 0.4 + 0.2
  return {
    ...createEmptyProject('dense'),
    sourceDuration,
    assets: {
      src: {
        id: 'src',
        path: '/tmp/dense.mp4',
        name: 'dense.mp4',
        kind: 'video',
        duration: sourceDuration,
        waveform: []
      }
    },
    cuts: Array.from({ length: cuts }, (_, i) => {
      const start = 0.2 + i * 0.4
      return { id: `c${i}`, start, end: start + 0.2, source: 'silence' as const }
    })
  }
}

function expectMapsMatch(project: Project) {
  const segs = resolveSegments(project)
  const times = [0, 0.01, 0.2, 0.199, 0.2001, 1, 1.4, 5, 10, project.sourceDuration / 2, project.sourceDuration - 0.01, project.sourceDuration + 1]
  for (const source of times) {
    expect(sourceToProgramOf(project, source)).toBeCloseTo(sourceToProgramLinear(segs, source), 8)
  }
  const length = programLengthOf(project)
  for (const program of [0, 0.01, length / 3, length / 2, length - 0.01, length, length + 1]) {
    if (program < 0) continue
    expect(programToSourceOf(project, program)).toBeCloseTo(programToSourceLinear(segs, program), 8)
  }
}

describe('resolved program cache', () => {
  test('the same project object reuses one resolved program and export job', () => {
    const project = applyCommand(createDemoProject(), { type: 'applySafeSuggestions' })
    expect(resolveSegments(project)).toBe(resolveSegments(project))
    expect(resolveProgram(project)).toBe(resolveProgram(project))
    const job = projectToExportJob(project)
    expect(projectToExportJob(project)).toBe(job)
    expect(programmedSegments(job)).toBe(programmedSegments(job))
    const exported = projectToExportJob(project, '/tmp/se-out.mp4')
    expect(exported).not.toBe(job)
    expect(exported.output).toBe('/tmp/se-out.mp4')
    expect(projectToExportJob(project)).toBe(job)
    expect(job.output).toBe('')
  })

  test('a command yields a new resolved program, not a stale cache', () => {
    const project = createDemoProject()
    const first = resolveSegments(project)
    const next = applyCommand(project, { type: 'deleteRange', start: 1, end: 1.4, source: 'manual' })
    expect(resolveSegments(next)).not.toBe(first)
    expect(programLength(next)).toBeLessThan(programLength(project))
    expect(projectToExportJob(next)).not.toBe(projectToExportJob(project))
  })

  test('log-time mapping matches the linear walk on demo, slugs, speed, and dense cuts', () => {
    expectMapsMatch(createDemoProject())
    expectMapsMatch(applyCommand(createDemoProject(), { type: 'applySafeSuggestions' }))
    const gapped = applyCommand(
      {
        ...createEmptyProject('gap'),
        sourceDuration: 2,
        transcript: {
          words: [{ id: 'w1', text: 'Speech 1', start: 0, end: 2, speaker: 'ryan', deleted: false }],
          speakers: [{ id: 'ryan', name: 'Speaker 1', color: '#C4452D' }]
        }
      },
      { type: 'insertGap', time: 1, duration: 1 }
    )
    expectMapsMatch(gapped)
    expect(sourceToProgramOf(gapped, 1.5)).toBeCloseTo(2.5, 5)
    const sped = applyCommand(createDemoProject(), { type: 'setSpeed', start: 0, end: 4, speed: 2 })
    expectMapsMatch(sped)
    const dense = denseTalk(500)
    expect(resolveSegments(dense).length).toBeGreaterThan(400)
    expectMapsMatch(dense)
    const resolved = resolveProgram(dense)
    expect(wordSnapTimes(dense)).toEqual([])
    expect(sourceToProgramOf(dense, 0.1)).toBeCloseTo(sourceToProgramLinear(resolved.segments, 0.1), 8)
    expect(sourceToProgramOf(dense, 0.35)).toBeCloseTo(sourceToProgramLinear(resolved.segments, 0.35), 8)
  })
})
