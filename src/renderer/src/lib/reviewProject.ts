import type { Project, Command } from '../types'
import { primaryTakes, sourceOffsetOf } from './takes'
import { isPlaceholderWord } from './transcript'
import { applyCommand } from './commands'
import { reviewConflict, parseReviewSnapshot, type ReviewEdit, type ReviewSnapshot } from '../../../shared/review'

export function snapshotForReview(project: Project): ReviewSnapshot {
  return parseReviewSnapshot({
    projectId: project.id, name: project.name, sourceDuration: project.sourceDuration,
    assets: primaryTakes(project).filter(a => a.kind !== 'image').map(a => ({ id: a.id, name: a.name, kind: a.kind, duration: a.duration, sourceOffset: sourceOffsetOf(a), waveform: a.waveform.filter((_, index) => index % Math.max(1, Math.ceil(a.waveform.length / 2000)) === 0).map(n => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))) })),
    words: project.transcript.words.filter(w => !isPlaceholderWord(w)).map(w => ({ id: w.id, text: w.text, start: w.start, end: w.end, deleted: w.deleted })),
    scenes: project.scenes.map(s => ({ id: s.id, title: s.title, start: s.start, end: s.end })),
    cuts: project.cuts.map(({ start, end }) => ({ start, end })),
    protected: project.tags.filter(tag => tag.kind === 'keep').map(({ start, end }) => ({ start, end }))
  })
}
export function commandForReview(edit: ReviewEdit, assets?: Project['assets']): Command {
  if (edit.kind === 'replaceAudio') {
    const asset = assets?.[edit.assetId]
    if (!asset) throw new Error('This replacement recording is unavailable.')
    return { type: 'replaceRangeAudio', start: edit.start, end: edit.end, asset }
  }
  return edit.kind === 'cut' ? { type: 'deleteRange', start: edit.start, end: edit.end, source: 'manual' }
    : edit.kind === 'correctWord' ? { type: 'setWordText', wordId: edit.wordId, text: edit.text }
    : { type: 'renameScene', sceneId: edit.sceneId, title: edit.title }
}

export function applyReviewDecision(project: Project, room: import('../../../shared/review').ReviewRoom, proposal: import('../../../shared/review').ReviewProposal, decision: 'accepted' | 'rejected'): Project {
  if (project.id !== room.snapshot.projectId) throw new Error('Open the original project to accept this feedback.')
  const receipt = `${room.id}:${proposal.id}`
  if (project.reviewDecisions?.[receipt]) {
    if (project.reviewDecisions[receipt] !== decision) throw new Error('This feedback already has a different local decision.')
    return project
  }
  let next = project
  if (decision === 'accepted' && proposal.edit) {
    const conflict = reviewConflict(room.snapshot, snapshotForReview(project), proposal.edit)
    if (conflict) throw new Error(conflict)
    next = applyCommand(project, commandForReview(proposal.edit, room.mediaAssets))
    if (next === project) throw new Error('This edit could not be applied. It may already be cut or protected.')
  }
  return { ...next, reviewDecisions: { ...next.reviewDecisions, [receipt]: decision } }
}
