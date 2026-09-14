/*
 * RYA-365 / SPE-BUG2b-REG: durable merge-level regression (QA harness, not product source).
 *
 * Defect RYA-363: two collaborators each add their FIRST `voice_replacements`
 * clip from a base that lacks the track, on two different non-overlapping
 * passages. `mergeSharedProjects` compares the whole track object; the base side
 * `b` is `undefined`, so it falls through to `conflicts.push(path); return l` and
 * keeps one side's entire track — dropping every clip the other collaborator
 * recorded. `CollaborationClient.resolve(keepLocal = true)` then persists that
 * single-sided track, permanently deleting the other recording from the shared
 * project and from the first collaborator's screen on the next poll.
 *
 * This harness drives the application's real `mergeSharedProjects` through the
 * exact stale-save / conflict-resolve / peer-poll sequence, in BOTH save orders,
 * and asserts the safe invariant:
 *
 *   every modeled merge retains BOTH collaborators' voice clips
 *
 * Baseline `origin/main` @ e9b6590 (deployment-approximate) must FAIL. Astra's
 * fix must make it PASS unchanged.
 *
 * Usage:  bun scripts/qa365-nonoverlap-voice-merge-regression.ts
 * Exit:   0 = all acceptance checks pass, 2 = acceptance check failed,
 *         1 = harness error.
 */
import { mergeSharedProjects, prepareSharedProject } from '../src/shared/collaboration'
import { projectFromTake } from '../src/renderer/src/lib/importMedia'
import { wordsFromAsr } from '../src/renderer/src/lib/asr'
import { replaceAudioRange } from '../src/renderer/src/lib/replaceAudio'
import type { Project } from '../src/renderer/src/types'

// Two spoken passages with a gap between them, as in the confirmed repro.
// Cue 1 -> words 0-3 (source 0.0-2.0 s); cue 2 -> words 4-7 (source 4.0-6.0 s).
const fixture = () => projectFromTake({
  asset: { id: 'source', name: 'Source.wav', path: '/private/original.wav', browserMediaKey: 'k', kind: 'audio', duration: 10, waveform: [], sourceOffset: 0 },
  words: wordsFromAsr([
    { start: 0, end: 2, text: 'Welcome to this recording.' },
    { start: 4, end: 6, text: 'Now a different chapter.' }
  ]),
  whispered: null,
  analysis: { silence: [], scenes: { times: [], staticRegions: [] }, loudness: [] }
})

const base = prepareSharedProject(fixture())
const take = (id: string) => ({ id, name: `${id}.wav`, path: `/private/${id}.wav`, kind: 'audio' as const, duration: 2, waveform: [], isRecording: true })

// Each collaborator records a different, non-overlapping passage against the
// same base, which has NO voice_replacements track.
const A = replaceAudioRange(base, 0, 2, take('take-A') as never)
const B = replaceAudioRange(base, 4, 6, take('take-B') as never)

const VOICE = 'voice_replacements'
const voiceClips = (p: Project) =>
  (p.tracks.find(t => t.id === VOICE)?.clips || [])
    .filter(c => c.replaceVoice)
    .map(c => ({ assetId: c.assetId, start: Number(c.start.toFixed(4)), end: Number((c.start + c.duration).toFixed(4)), duration: Number(c.duration.toFixed(4)) }))
const keptIds = (p: Project) => [...new Set(voiceClips(p).map(c => c.assetId!))].sort()
const hasVoiceTrack = (p: Project) => p.tracks.some(t => t.id === VOICE)

type Check = { name: string; expected: string[]; kept: string[]; conflicts: string[]; ok: boolean; mustPass: boolean }
const results: Check[] = []
const failures: string[] = []

function check(name: string, merged: { project: Project; conflicts: string[] }, expected: string[], mustPass = true) {
  const kept = keptIds(merged.project)
  const exp = [...new Set(expected)].sort()
  const ok = kept.length === exp.length && kept.every((id, i) => id === exp[i])
  results.push({ name, expected: exp, kept, conflicts: merged.conflicts, ok, mustPass })
  console.log(`[${ok ? 'KEEP' : 'DROP'}] ${name}  kept=${JSON.stringify(kept)}  conflicts=${JSON.stringify(merged.conflicts)}`)
  if (mustPass && !ok) failures.push(`${name}: expected both recordings ${JSON.stringify(exp)} but the merge kept ${JSON.stringify(kept)} (a collaborator's clip was dropped)`)
}

// Precondition: the modeled defect needs a base that lacks the voice track.
if (hasVoiceTrack(base)) throw new Error('Harness precondition failed: fixture base unexpectedly already has a voice_replacements track')
if (!hasVoiceTrack(A) || !hasVoiceTrack(B)) throw new Error('Harness precondition failed: a single replaceAudioRange did not add the voice_replacements track')
if (!voiceClips(A).some(c => c.assetId === 'take-A') || !voiceClips(B).some(c => c.assetId === 'take-B')) throw new Error('Harness precondition failed: replacement clips were not produced')
// Precondition: the two passages do not overlap in program time.
const [aClip] = voiceClips(A), [bClip] = voiceClips(B)
if (!(aClip.end <= bClip.start || bClip.end <= aClip.start)) throw new Error('Harness precondition failed: the two recorded passages overlap')
console.log(`fixture: A clip=[${aClip.start},${aClip.end}]  B clip=[${bClip.start},${bClip.end}]  baseHasVoiceTrack=${hasVoiceTrack(base)}`)

// --- Acceptance: the two stale-save merge orders -------------------------
// Order 1: A saves first; B is the second saver merging local B against server A.
const mergeBA = mergeSharedProjects(base, B, A)
check('stale-save:B-local+A-remote', mergeBA, ['take-A', 'take-B'])
// Order 2: B saves first; A is the second saver merging local A against server B.
const mergeAB = mergeSharedProjects(base, A, B)
check('stale-save:A-local+B-remote', mergeAB, ['take-A', 'take-B'])

// --- Acceptance: the keep-local resolve is persisted, then the peer polls ---
// B chooses "Keep my conflicting edits": resolve(keepLocal=true) computes
// mergeSharedProjects(base, local=B, latest=server=A) and persists it.
const serverAfterB = mergeBA.project
// A polls: base=A (A's last saved revision), local=A, remote=serverAfterB.
check('resolve:B-keep-local -> peer:A-sees-server', mergeSharedProjects(A, A, serverAfterB), ['take-A', 'take-B'])
// A chooses "Keep my conflicting edits": persists mergeSharedProjects(base, local=A, server=B).
const serverAfterA = mergeAB.project
// B polls: base=B, local=B, remote=serverAfterA.
check('resolve:A-keep-local -> peer:B-sees-server', mergeSharedProjects(B, B, serverAfterA), ['take-A', 'take-B'])

// --- Discriminating controls: each must PASS at baseline -----------------
// They prove the invariant is not trivially always-failing and is specific to
// the "both sides added the first clip" collision.
check('control:single-A', mergeSharedProjects(base, A, base), ['take-A'])
check('control:single-B', mergeSharedProjects(base, B, base), ['take-B'])
check('control:no-op', mergeSharedProjects(base, base, base), [])
check('control:identical-edit-both', mergeSharedProjects(base, A, A), ['take-A'])
// A non-voice edit on another track is unrelated to the voice collision and
// must not disturb it: A records voice, B deletes a word. Expected: voice clip
// kept; the word-delete is a separate track merge.
const BWordEdit: Project = { ...base, transcript: { ...base.transcript, words: base.transcript.words.map((w, i) => i === 4 ? { ...w, deleted: true } : w) } }
check('control:voice-vs-unrelated-track', mergeSharedProjects(base, A, BWordEdit), ['take-A'])

// --- Harness self-tests: the pass path must be reachable -----------------
// Simulate the two plausible fix shapes without touching product source and
// confirm the checker accepts them. (A) the fix unions both non-overlapping
// clips into the track; (B) it still surfaces a conflict but the resolution
// retains both clips.
const unionProject = (p: Project): Project => {
  const clips = [...(A.tracks.find(t => t.id === VOICE)?.clips || []), ...(B.tracks.find(t => t.id === VOICE)?.clips || [])]
  const deduped = [...new Map(clips.map(c => [c.assetId, c])).values()]
  const track = p.tracks.find(t => t.id === VOICE)
  return { ...p, tracks: track ? p.tracks.map(t => t.id === VOICE ? { ...t, clips: deduped } : t) : [...p.tracks, { id: VOICE, name: 'Voice replacements', type: 'audio', locked: false, muted: false, hidden: false, clips: deduped }] }
}
const reachable = mergeBA.project
check('candidate-sim:union-both-clips', { project: unionProject(reachable), conflicts: [] }, ['take-A', 'take-B'])
check('candidate-sim:conflict-resolved-both-clips', { project: unionProject(reachable), conflicts: ['tracks[voice_replacements]'] }, ['take-A', 'take-B'])

console.log(JSON.stringify({ results, failures, pass: failures.length === 0 }, null, 2))

if (failures.length) {
  console.error('QA365 FAIL:')
  for (const f of failures) console.error('  - ' + f)
  process.exit(2)
}
console.log('QA365 PASS: both non-overlapping recordings survive every modeled merge and resolve step.')
process.exit(0)
