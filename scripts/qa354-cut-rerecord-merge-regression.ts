/*
 * RYA-354 / SPE-BUG2a-REG: durable merge-level regression (QA harness, not product source).
 *
 * Defect RYA-352: two collaborators edit the same passage. One cuts words; the
 * other re-records the same span. `mergeSharedProjects` combines both with NO
 * conflict, and the replacement clip (fixed to its pre-merge program slot) then
 * bleeds past the now-shorter retained passage, muting the next sentence's
 * original voice.
 *
 * This harness calls the application's real `mergeSharedProjects` with an
 * overlapping cut + `replaceAudioRange` edit in BOTH orders and asserts the
 * safe invariant:
 *
 *   conflicts is non-empty
 *     OR the replacement voice covers no program time outside the retained passage
 *
 * Baseline `origin/main` @ e9b6590 (deployment-approximate) must FAIL. Astra's
 * fix must make it PASS unchanged.
 *
 * Usage:  bun scripts/qa354-cut-rerecord-merge-regression.ts
 * Exit:   0 = all acceptance checks pass, 2 = acceptance check failed,
 *         1 = harness error.
 */
import { mergeSharedProjects, prepareSharedProject } from '../src/shared/collaboration'
import { projectFromTake } from '../src/renderer/src/lib/importMedia'
import { wordsFromAsr } from '../src/renderer/src/lib/asr'
import { applyCommand } from '../src/renderer/src/lib/commands'
import { replaceAudioRange } from '../src/renderer/src/lib/replaceAudio'
import { programLengthOf, sourceToProgramOf } from '../src/renderer/src/lib/resolver'
import { buildExportJob } from '../src/renderer/src/lib/exportJob'
import { voiceLook } from '../src/renderer/src/lib/programLook'
import type { Project } from '../src/renderer/src/types'

const EPS = 0.02

const fixture = () => projectFromTake({
  asset: { id: 'source', name: 'Source.wav', path: '/private/original.wav', browserMediaKey: 'k', kind: 'audio', duration: 10, waveform: [], sourceOffset: 0 },
  // Continuous speech: sentence 2 starts exactly where sentence 1 ends.
  words: wordsFromAsr([
    { start: 0, end: 2, text: 'Welcome to this recording.' },
    { start: 2, end: 4, text: 'Now a different chapter.' }
  ]),
  whispered: null,
  analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
})

const base = prepareSharedProject(fixture())
const words = base.transcript.words
const take = { id: 'take-B', name: 'take-B.wav', path: '/private/take-B.wav', kind: 'audio' as const, duration: 2, waveform: [], isRecording: true }

// The re-recorded span: words 0..3 (source 0.0-2.0s). The concurrent cut removes
// words 1..2 (source 0.5-1.5s), leaving only 1.0s of program time for the span.
const cut = applyCommand(base, { type: 'deleteRange', start: words[1].start, end: words[2].end, source: 'manual' })
const rerecord = replaceAudioRange(base, words[0].start, words[3].end, take as never)

type Coverage = { start: number; end: number }
type Analysis = {
  label: string
  conflicts: string[]
  cuts: number[][]
  retainedPassage: Coverage
  replacementClips: Coverage[]
  coversOutsidePassage: boolean
  voiceGainAtNextSentenceMid: number | null
  programLength: number
}

function analyze(label: string, project: Project, conflicts: string[]): Analysis {
  // Retained passage = the program-time range of the original re-recorded words
  // after the merge has applied its cuts.
  const passageStart = sourceToProgramOf(project, words[0].start)
  const passageEnd = sourceToProgramOf(project, words[3].end)
  const retainedPassage = { start: Number(passageStart.toFixed(4)), end: Number(passageEnd.toFixed(4)) }

  const replacementClips = project.tracks
    .filter(t => t.id === 'voice_replacements')
    .flatMap(t => t.clips)
    .filter(c => c.replaceVoice)
    .map(c => ({ start: Number(c.start.toFixed(4)), end: Number((c.start + c.duration).toFixed(4)) }))

  // "safe" = no replacement voice sits in program time outside the retained passage.
  const coversOutsidePassage = replacementClips.some(c => c.start < retainedPassage.start - EPS || c.end > retainedPassage.end + EPS)

  // Corroborating user-facing signal: original voice gain ~0.3s into the next
  // sentence. A silent over-long replacement mutes it (gain 0).
  let voiceGainAtNextSentenceMid: number | null = null
  try {
    const nextStart = sourceToProgramOf(project, words[4].start)
    const job = buildExportJob(project, '/tmp/qa354.mp4')
    if (job) voiceGainAtNextSentenceMid = Number(voiceLook(job, nextStart + 0.3).incomingGain.toFixed(4))
  } catch { /* reported as null if the export graph cannot be built */ }

  return {
    label,
    conflicts,
    cuts: project.cuts.map(c => [Number(c.start.toFixed(4)), Number(c.end.toFixed(4))]),
    retainedPassage,
    replacementClips,
    coversOutsidePassage,
    voiceGainAtNextSentenceMid,
    programLength: Number(programLengthOf(project).toFixed(4))
  }
}

type Check = { name: string; analysis: Analysis; safe: boolean; mustPass: boolean }

const results: Check[] = []
const failures: string[] = []
function record(name: string, mustPass: boolean, merged: { project: Project; conflicts: string[] }) {
  const analysis = analyze(name, merged.project, merged.conflicts)
  const safe = merged.conflicts.length > 0 || !analysis.coversOutsidePassage
  results.push({ name, analysis, safe, mustPass })
  const verdict = safe ? 'SAFE' : 'UNSAFE'
  console.log(`[${verdict}] ${name}  conflicts=${JSON.stringify(merged.conflicts)}  clip=${JSON.stringify(analysis.replacementClips)}  retained=${JSON.stringify(analysis.retainedPassage)}  gainAtNextSentenceMid=${analysis.voiceGainAtNextSentenceMid}`)
  if (mustPass && !safe) failures.push(`${name}: overlapping cut + re-record merged silently with no conflict and voice covering program time outside the retained passage`)
}

// Acceptance: overlapping cut + re-record, both merge orders.
record('overlap:cut+rerecord', true, mergeSharedProjects(base, cut, rerecord))
record('overlap:rerecord+cut', true, mergeSharedProjects(base, rerecord, cut))

// Discriminating controls: each must PASS at baseline. They prove the invariant
// check is not trivially always-failing and isolates the defect to the overlap.
record('control:cut-only', true, mergeSharedProjects(base, cut, cut))
record('control:rerecord-only', true, mergeSharedProjects(base, rerecord, rerecord))

// Harness self-test: the acceptance pass-path must be reachable. Simulate the
// two fix shapes without touching product source and confirm the checker accepts
// them. (A) the collision is surfaced as a conflict; (B) the over-long slot is
// invalidated so no replacement voice covers program time outside the passage.
const overlap = mergeSharedProjects(base, cut, rerecord)
if (overlap.conflicts.length === 0) {
  const withConflict = { project: overlap.project, conflicts: ['tracks[voice_replacements].clips[0].duration'] }
  record('candidate-sim:conflict-surfaced', true, withConflict)
}
const invalidated = {
  project: {
    ...overlap.project,
    tracks: overlap.project.tracks.map(t => t.id === 'voice_replacements' ? { ...t, clips: [] } : t)
  },
  conflicts: [] as string[]
}
record('candidate-sim:slot-invalidated', true, invalidated)

console.log(JSON.stringify({ results, failures, pass: failures.length === 0 }, null, 2))

if (failures.length) {
  console.error('QA354 FAIL:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(2)
}
console.log('QA354 PASS: overlapping cut + re-record is surfaced or safely re-validated.')
process.exit(0)
