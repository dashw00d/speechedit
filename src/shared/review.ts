import type { Project, Asset } from '../renderer/src/types'
/** The review contract contains source coordinates and decisions, never original media paths. */
export interface ReviewSpan { start: number; end: number }
export interface ReviewAsset { id: string; name: string; kind: 'video' | 'audio'; duration: number; sourceOffset: number; waveform: number[] }
export interface ReviewWord extends ReviewSpan { id: string; text: string; deleted: boolean }
export interface ReviewScene extends ReviewSpan { id: string; title: string }
export interface ReviewSnapshot {
  projectId: string
  name: string
  sourceDuration: number
  assets: ReviewAsset[]
  words: ReviewWord[]
  scenes: ReviewScene[]
  cuts: ReviewSpan[]
  protected: ReviewSpan[]
}
export type ReviewEdit = { kind: 'cut'; start: number; end: number } | { kind: 'renameChapter'; sceneId: string; title: string }
export interface ReviewReply { id: string; author: string; text: string; createdAt: number }
export interface ReviewProposal {
  id: string
  author: string
  text: string
  start: number
  end: number
  edit?: ReviewEdit
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
  replies: ReviewReply[]
}
export interface ReviewRoom {
  id: string
  revision: number
  mode?: 'audit' | 'edit'
  project?: Project
  projectRevision?: number
  mediaAssets?: Record<string, Asset>
  history?: { revision: number; author: string; at: number }[]
  snapshot: ReviewSnapshot
  proposals: ReviewProposal[]
  media: Record<string, { bytes: number; mime: string }>
  published: boolean
  createdAt: number
  expiresAt: number
}
export const REVIEW_MAX_ASSET_BYTES = 250 * 1024 * 1024
export const REVIEW_MAX_ROOM_BYTES = 1024 * 1024 * 1024
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object.')
  return v as Record<string, any>
}
export function reviewText(v: unknown, max = 2000): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Text must contain 1–${max} characters.`)
  return v.trim()
}
function number(v: unknown, max = 86400): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new Error('Invalid source time.')
  return v
}
function span(v: unknown, duration: number): ReviewSpan {
  const o = object(v), start = number(o.start, duration), end = number(o.end, duration)
  if (end <= start) throw new Error('Choose a nonempty source range.')
  return { start, end }
}
function list<T>(v: unknown, max: number, fn: (item: unknown) => T): T[] {
  if (!Array.isArray(v) || v.length > max) throw new Error('Invalid review document.')
  return v.map(fn)
}
function unique(rows: { id: string }[]): void {
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate review identifiers.')
}
export function parseReviewSnapshot(raw: unknown): ReviewSnapshot {
  const o = object(raw), duration = number(o.sourceDuration)
  if (!duration) throw new Error('Open a recording before sharing.')
  const assets = list(o.assets, 64, v => {
    const a = object(v)
    if (a.kind !== 'audio' && a.kind !== 'video') throw new Error('Invalid review media kind.')
    const id = reviewText(a.id, 120)
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid media identifier.')
    const d = number(a.duration), sourceOffset = number(a.sourceOffset, duration)
    if (!d || sourceOffset + d > duration + 0.1) throw new Error('Invalid media duration.')
    return { id, name: reviewText(a.name, 300), kind: a.kind as 'audio' | 'video', duration: d, sourceOffset, waveform: list(a.waveform ?? [], 2000, v => number(v, 1)) }
  })
  if (!assets.length) throw new Error('No source recordings to share.')
  const words = list(o.words, 150000, v => {
    const w = object(v)
    return { ...span(w, duration), id: reviewText(w.id, 120), text: reviewText(w.text, 1000), deleted: w.deleted === true }
  })
  const scenes = list(o.scenes, 10000, v => { const s = object(v); return { ...span(s, duration), id: reviewText(s.id, 120), title: reviewText(s.title, 300) } })
  unique(assets); unique(words); unique(scenes)
  return { projectId: reviewText(o.projectId, 120), name: reviewText(o.name, 300), sourceDuration: duration, assets, words, scenes,
    cuts: list(o.cuts, 20000, v => span(v, duration)), protected: list(o.protected, 10000, v => span(v, duration)) }
}
export function parseReviewEdit(raw: unknown, snapshot: ReviewSnapshot): ReviewEdit {
  const o = object(raw)
  if (o.kind === 'cut') {
    const range = span(o, snapshot.sourceDuration)
    if (range.end - range.start < 0.03) throw new Error('Choose at least 0.03 seconds to cut.')
    let gaps = [range]
    for (const cut of snapshot.cuts) gaps = gaps.flatMap(gap => !intersects(gap, cut) ? [gap] : [{ start: gap.start, end: Math.min(gap.end, cut.start) }, { start: Math.max(gap.start, cut.end), end: gap.end }].filter(gap => gap.end > gap.start))
    if (gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0) < 0.03) throw new Error('This passage is already cut.')
    if (snapshot.protected.some(p => intersects(p, range))) throw new Error('This range contains a protected moment.')
    return { kind: 'cut', ...range }
  }
  if (o.kind === 'renameChapter' && snapshot.scenes.some(scene => scene.id === o.sceneId)) {
    return { kind: 'renameChapter', sceneId: o.sceneId, title: reviewText(o.title, 300) }
  }
  throw new Error('Unsupported review edit.')
}
export function parseReviewSubmission(raw: unknown, snapshot: ReviewSnapshot) {
  const o = object(raw)
  const edit = o.edit == null ? undefined : parseReviewEdit(o.edit, snapshot)
  const range = edit?.kind === 'renameChapter' ? snapshot.scenes.find(scene => scene.id === edit.sceneId)!
    : edit?.kind === 'cut' ? edit : span(o, snapshot.sourceDuration)
  return { author: reviewText(o.author, 80), text: reviewText(o.text), start: range.start, end: range.end, ...(edit ? { edit } : {}) }
}
export function intersects(a: ReviewSpan, b: ReviewSpan): boolean { return a.start < b.end && b.start < a.end }
/** Compare only the affected source passage, allowing independent edits to merge. */
export function reviewConflict(base: ReviewSnapshot, current: ReviewSnapshot, edit: ReviewEdit): string | null {
  if (base.projectId !== current.projectId || JSON.stringify(base.assets.map(a => [a.id, a.duration, a.sourceOffset])) !== JSON.stringify(current.assets.map(a => [a.id, a.duration, a.sourceOffset]))) return 'The source recordings changed. Create a fresh review link.'
  if (edit.kind === 'renameChapter') {
    const before = base.scenes.find(s => s.id === edit.sceneId), after = current.scenes.find(s => s.id === edit.sceneId)
    return JSON.stringify(before) === JSON.stringify(after) ? null : 'This chapter changed after sharing.'
  }
  const affected = (s: ReviewSnapshot) => ({ words: s.words.filter(w => intersects(w, edit)), cuts: s.cuts.filter(c => intersects(c, edit)), protected: s.protected.filter(p => intersects(p, edit)) })
  return JSON.stringify(affected(base)) === JSON.stringify(affected(current)) ? null : 'This passage changed after sharing. Review it manually or create a fresh link.'
}
export function editLabel(edit?: ReviewEdit): string {
  return !edit ? 'Comment' : edit.kind === 'cut' ? `Proposed cut · ${(edit.end - edit.start).toFixed(1)}s` : `Rename chapter to “${edit.title}”`
}
