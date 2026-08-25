import type { ProgramInsert } from '../types'
import { uid } from './time'

export function isSlugId(id: string): boolean {
  return id.startsWith('slug_')
}

export function slugInsertId(clipId: string): string | undefined {
  return isSlugId(clipId) ? clipId.slice(5) : undefined
}

export function shiftInserts(inserts: ProgramInsert[], after: number, delta: number): ProgramInsert[] {
  if (Math.abs(delta) < 1e-4) return inserts
  return inserts.map((row) =>
    row.programStart >= after - 1e-4 ? { ...row, programStart: Math.max(0, row.programStart + delta) } : row
  )
}

/** Collapse inserts that sat inside a ripple-deleted program span, then shift later ones. */
export function rippleInserts(inserts: ProgramInsert[], lo: number, hi: number): ProgramInsert[] {
  const delta = lo - hi
  return inserts.flatMap((ins) => {
    const a = ins.programStart
    const b = ins.programStart + ins.duration
    if (b <= lo + 0.02) return [ins]
    if (a >= hi - 0.02) return [{ ...ins, programStart: a + delta }]
    const left = Math.max(0, lo - a)
    const right = Math.max(0, b - hi)
    const out: ProgramInsert[] = []
    if (left > 0.03) out.push({ ...ins, duration: left })
    if (right > 0.03) {
      out.push({ ...ins, id: uid('ins'), programStart: lo + delta, duration: right })
    }
    return out
  })
}

export function insertAtTime(inserts: ProgramInsert[], time: number): ProgramInsert | undefined {
  return inserts.find(
    (row) => time >= row.programStart - 0.02 && time < row.programStart + row.duration + 0.02
  )
}

export function placeInsert(inserts: ProgramInsert[], time: number, duration: number, holdSourceTime?: number): ProgramInsert[] {
  const hit = insertAtTime(inserts, time)
  if (hit) {
    return inserts.map((row) => {
      if (row.id === hit.id) return { ...row, duration: row.duration + duration }
      if (row.programStart > hit.programStart) return { ...row, programStart: row.programStart + duration }
      return row
    })
  }
  return [
    ...shiftInserts(inserts, time, duration),
    {
      id: uid('ins'),
      programStart: time,
      duration,
      kind: 'black',
      holdSourceTime
    }
  ]
}

export function closeInsert(
  inserts: ProgramInsert[],
  insertId: string
): { inserts: ProgramInsert[]; removed?: ProgramInsert } {
  const hit = inserts.find((row) => row.id === insertId)
  if (!hit) return { inserts }
  return {
    inserts: shiftInserts(
      inserts.filter((row) => row.id !== insertId),
      hit.programStart,
      -hit.duration
    ),
    removed: hit
  }
}

/** When restored media lands on a hold, eat the hold instead of shifting the tape. */
export function consumeInsert(
  inserts: ProgramInsert[],
  programStart: number,
  added: number
): { inserts: ProgramInsert[]; consumed: number } {
  const hit = inserts.find(
    (row) =>
      Math.abs(row.programStart - programStart) < 0.08 ||
      (programStart >= row.programStart - 0.02 && programStart < row.programStart + row.duration)
  )
  if (!hit || added < 0.03) return { inserts, consumed: 0 }
  const take = Math.min(hit.duration, added)
  const leftover = hit.duration - take
  const next =
    leftover < 0.03
      ? inserts.filter((row) => row.id !== hit.id)
      : inserts.map((row) => (row.id === hit.id ? { ...row, duration: leftover } : row))
  return { inserts: next, consumed: take }
}
