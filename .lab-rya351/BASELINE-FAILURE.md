# RYA-351 baseline failure proof — merge-wipe Undo + same-cue autosave conflict

Baseline candidate: `origin/main` @ `e9b65904dfe71f9d28a901fc16db6f0d509e46ec`
(deployment-approximate; see `/home/ryan/dev/speechedit-qa331-main/.lab-rya331/BASELINE.md`).
Built web app under test: `assets/index-Bg71JEhD.js` (sha256 `ad92bc7d…6322e`).

## Exact command

```sh
cd /home/ryan/dev/speechedit-qa336-builder
./.lab-rya351/start-service.sh 3365 "$PWD/.lab-rya351"   # healthz {"ok":true}
./.lab-rya351/run-suite.sh http://127.0.0.1:3365 "$PWD/.lab-rya351/runs/baseline-b"
# exit=2 (at least one acceptance check failed)
```

Run twice with identical results (`runs/baseline-a`, `runs/baseline-b`); the
`crossCueControl` scenario passed in both, so the failures below are the product
defects, not a non-discriminating harness.

## Result: FAIL (exit 2), `results.pass:false`

### RYA-342 — Undo wiped after a peer merge

From `runs/baseline-b/qa351-trace.json`, `results.scenarios.rya342`:

| Field | Baseline value |
| --- | --- |
| `undoEnabledBeforeMerge` | `true` |
| `undoWorkedBeforeMerge` | `true` |
| `mergeObservedAfterPeerSave` | `true` |
| `projectRevisionBefore` → `projectRevisionAfter` | `3` → `4` (`revisionAdvanced:true`) |
| `undoEnabledAfterMerge` | **`false`** |
| `undoButtonAcceptedClick` | `false` |
| `word3BeforeUndo` → `word3AfterUndoAttempt` | `"G3"` → `"G3"` |
| `undoAfterMergeWorked` | **`false`** |
| `peerWord5Preserved` | `true` |

Failing assertion (verbatim from the run log):

```
FAIL: RYA-342: Undo is disabled after the peer merge (merge wiped local history)
```

The guest's local Undo history is discarded when the peer's save advances
`projectRevision` and the merge is applied without a reset. The peer edit is
preserved, but the guest can no longer reverse their own last edit.

### RYA-343 — same-cue different-word edits hit a blocking conflict

From `results.scenarios.rya343`:

| Field | Baseline value |
| --- | --- |
| `guestSavedWord6` | `"SameCueA"` |
| `peerLocalWord7` | `"SameCueB"` |
| `peerStatus` | **`"Resolve simultaneous edits · v6"`** |
| `peerConflict` | `Another editor changed the same items.\n\ntracks[v3].clips[cap_…].text\n\nYour draft is preserved…` |
| `guestStatus` | `"All changes saved · v7"` |
| `serverWord6` | `"SameCueA"` |
| `serverWord7` | **`"chapter."`** (peer's `SameCueB` not persisted) |
| `noBlockingConflict` | **`false`** |
| `bothWordsPersisted` | **`false`** |
| `clientsConverged` | **`false`** |

Failing assertions (verbatim):

```
FAIL: RYA-343: same-cue different-word edits hit a blocking "Resolve simultaneous edits" state (tracks[v3].clips[cap_…].text)
FAIL: RYA-343: both words did not persist (server word6=SameCueA, word7=chapter.)
FAIL: RYA-343: clients did not converge on both words
```

The merge granularity is the caption-clip `text` primitive, so two different words
in one cue cannot merge; the peer's autosave halts and its word is never persisted
until a manual "Keep my conflicting edits".

### Control passed at baseline (in both runs)

`results.scenarios.crossCueControl`: `noBlockingConflict:true`,
`bothWordsPersisted:true` (server word0 `CrossA`, word4 `CrossB`),
`clientsConverged:true`, `ok:true`. Different-cue edits merge cleanly, so the
same-cue failure is isolated to merge granularity.

## Evidence

- Trace JSON: `runs/baseline-b/qa351-trace.json` (force-added to git) and
  `runs/baseline-a/qa351-trace.json`.
- Screenshots (`runs/baseline-b/`): `03-rya342-before-merge.png`,
  `04-rya342-after-merge.png` (guest Undo disabled after merge),
  `06-rya343-peer-after-reconnect.png` / `07-rya343-final.png` (blocked
  "Resolve simultaneous edits"), `01`/`02`/`05` context.
- Per-context console/network capture is embedded in the trace; no app errors
  beyond the mocked-ASR/GPU fixture notices.

## Candidate expectation

When Astra preserves local Undo history across a merge (RYA-342) and merges
same-cue word-level edits (RYA-343), the unchanged suite must report
`results.pass:true` (exit 0): `undoEnabledAfterMerge:true` +
`undoAfterMergeWorked:true`, and `noBlockingConflict` + `bothWordsPersisted` +
`clientsConverged` all true, with the `crossCueControl` still green.
