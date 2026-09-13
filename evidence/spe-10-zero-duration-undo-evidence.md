# SPE-10 (RYA-182) zero-duration cuts, recording-start tokens, automatic Undo

Snapshot: branch `spe-05/first-session-polish` @ `fb7d84a` (SPE-03 `7da9678` is an ancestor).
Branch held from merge pending independent review. No branch switch, reset, clean or stash.

## Defects and fixes

1. P1 — deleting a zero-duration token clipped the neighbouring word.
   `src/renderer/src/lib/edl.ts` `withPlayableWordDurations` no longer extends a
   token with no gap on either side. `src/renderer/src/lib/commands.ts`
   `toggleWords` now removes such tokens from the transcript only (`setWordDeleted`)
   and keeps them out of the audio-cut range pass, so no cut overlaps the neighbour.
2. P2 — a zero-duration token at the recording start became `[-0.06, 0]`, never
   highlighted and never deleted. `withPlayableWordDurations` never borrows past 0
   (`prevEnd` floored at 0); a token flush to 0 keeps `[0, 0]`, is reached for
   display by the new `wordHighlightSpan`/`currentWord`, and is text-deletable
   without touching following audio.
3. P2 — Undo reversed the wrong action. Auto cuts, auto captions and the leftover
   review now share one history boundary. `src/renderer/src/store.ts` gains
   `beginHistoryGroup`/`endHistoryGroup` (one snapshot, only when a dispatch
   changed the project); `src/renderer/src/lib/firstEdit.ts` exposes `groupHistory`;
   `src/renderer/src/lib/fileActions.ts` wraps `toastAfterIntel`, `onLooks` and
   `onWords` so Undo performs the edit the toast names. Streaming later chunks use
   `replay`/`patch` and do not open a new entry.

Design separation: display highlighting (`wordHighlightSpan`) is never used for
audio cutting; cutting uses the word's own `[start, end]` interval.

## Workflow trace (real editing command)

`bun run scripts/spe10-workflow-trace.ts` (temporary script, not committed):

```
P1 before:  hello[0.00,0.30] uh[0.30,0.30] world[0.30,0.60]
P1 after:   hello[0.00,0.30] uh[0.30,0.30](deleted) world[0.30,0.60]
P1 world survives delete: true [ 0.3, 0.6 ]
P1 cuts overlap world? false
P1 program length before/after: 1 / 1
P2 token timestamps: [ 0, 0 ] highlight span: [ 0, 0.06 ]
P2 currentWord at 0: uh
P2 after delete world: [ 0, 0.6 ] deleted? false
P2 cuts overlap world? false
Undo group: start/group/one-undo: 46.20 / 27.67 / 46.20
One undo restores the whole automatic unit: true
```

## Checks actually run

Baseline recorded before editing (same checkout):

```
bun test src/renderer/src/lib
730 pass / 0 fail, 5449 expect() calls, 96 files
bun run typecheck   (tsc web + node) exit 0
```

After the fix:

```
bun test src/renderer/src/lib
734 pass / 0 fail, 5475 expect() calls, 96 files, 23.89s
bun run typecheck   (tsc web + node) exit 0
```

New regression tests driven through the real commands:

- `transcript.test.ts`:
  - `SPE-10 P1: deleting a flush zero-duration filler leaves the following word intact`
    (runs `applyCommand` `toggleWords`, asserts `world` untouched, no overlapping cut,
    unchanged program length, and restore re-deletes/undeletes safely).
  - `SPE-10 P2: a zero-duration token at recording start is reachable and cut-safe`
    (asserts `[0,0]`, `currentWord(...,0) === 'uh'`, neighbour intact, no cut).
  - Updated the existing zero-duration row test to the retained-timestamp contract.
- `asr.test.ts`: updated the whisper zero-duration test to retained timestamps plus
  reachable highlight.
- `firstEdit.test.ts`:
  - `non-streaming first edit + captions undo as one unit that names its edit`
    (real import; last toast offers Undo and names the edit; one Undo reverts the
    cut, un-deletes the word, and removes the auto captions).
  - `an undo group reverses as one unit and keeps later user edits separate`
    (intervening user edit is one step; the automatic unit is the next).
  - Streaming: first ASR chunk's cut + captions now assert as one undo unit.

## Criteria

| Criterion | Result |
| --- | --- |
| Deleting a zero-duration token does not cut adjacent speech (real command) | Pass |
| Token at recording start is highlightable and text-deletable, no negative time | Pass |
| Automatic edit + follow-ups share one history boundary; Undo matches the message | Pass |
| Streaming and non-streaming completion covered | Pass |
| Intervening user edits remain separate undo steps | Pass |
| Relevant renderer regression tests + typecheck | Pass (734/0; typecheck exit 0) |
| Merge hold respected | Yes — not merged; submitted for GLM review |

## Notes

- The changed files use the repo's dominant CRLF endings; `git diff --check`
  flags CR-at-eol on added lines, which is a repo-wide CRLF artifact, not content.
- Working tree otherwise preserved: the untracked SPE-09 probe files were not
  touched and no SPE-09 edits were swept into this change.
- Unmet criteria: none for the three reproductions. Independent GLM verification
  of the exact commit is still required before the merge hold lifts.
