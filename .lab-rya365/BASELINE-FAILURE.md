# RYA-365 baseline failure proof — non-overlapping re-records drop a collaborator's clip

Baseline candidate: `origin/main` @ `e9b65904dfe71f9d28a901fc16db6f0d509e46ec`
(deployment-approximate; see `/home/ryan/dev/speechedit-qa331-main/.lab-rya331/BASELINE.md`).
Built web app under test: `assets/index-Bg71JEhD.js` (sha256 `ad92bc7d…6322e`),
CSS `assets/index-CreKLqQ_.css` (sha256 `aeb9644c…f1216c`, matches RYA-331).

## Exact command

```sh
cd /home/ryan/dev/speechedit-qa365-builder
./.lab-rya365/start-service.sh 3367 "$PWD/.lab-rya365" &   # healthz {"ok":true}
./.lab-rya365/run-suite.sh http://127.0.0.1:3367 "$PWD/.lab-rya365/runs/baseline-a"
./.lab-rya365/run-suite.sh http://127.0.0.1:3367 "$PWD/.lab-rya365/runs/baseline-b"
# exit=2 (at least one acceptance check failed) in both runs, identical results
```

Run twice with identical outcomes (`runs/baseline-a`, `runs/baseline-b`); all
discriminating controls and both candidate self-tests passed in both, so the
failure is the product defect, not a non-discriminating harness.

## Result: FAIL (suite exit 2)

### Merge-level (`runs/baseline-b/merge-level.log`)

```
fixture: A clip=[0,2]  B clip=[4,6]  baseHasVoiceTrack=false
[DROP] stale-save:B-local+A-remote  kept=["take-B"]  conflicts=["tracks[voice_replacements]"]
[DROP] stale-save:A-local+B-remote  kept=["take-A"]  conflicts=["tracks[voice_replacements]"]
[DROP] resolve:B-keep-local -> peer:A-sees-server  kept=["take-B"]  conflicts=[]
[DROP] resolve:A-keep-local -> peer:B-sees-server  kept=["take-A"]  conflicts=[]
[KEEP] control:single-A  kept=["take-A"]  conflicts=[]
[KEEP] control:single-B  kept=["take-B"]  conflicts=[]
[KEEP] control:no-op  kept=[]  conflicts=[]
[KEEP] control:identical-edit-both  kept=["take-A"]  conflicts=[]
[KEEP] control:voice-vs-unrelated-track  kept=["take-A"]  conflicts=[]
[KEEP] candidate-sim:union-both-clips  kept=["take-A","take-B"]  conflicts=[]
[KEEP] candidate-sim:conflict-resolved-both-clips  kept=["take-A","take-B"]  conflicts=["tracks[voice_replacements]"]
```

Failing assertions (verbatim):

```
QA365 FAIL:
  - stale-save:B-local+A-remote: expected both recordings ["take-A","take-B"] but the merge kept ["take-B"] (a collaborator's clip was dropped)
  - stale-save:A-local+B-remote: expected both recordings ["take-A","take-B"] but the merge kept ["take-A"] (a collaborator's clip was dropped)
  - resolve:B-keep-local -> peer:A-sees-server: expected both recordings ["take-A","take-B"] but the merge kept ["take-B"] (a collaborator's clip was dropped)
  - resolve:A-keep-local -> peer:B-sees-server: expected both recordings ["take-A","take-B"] but the merge kept ["take-A"] (a collaborator's clip was dropped)
```

Both save orders surface `conflicts: ["tracks[voice_replacements]"]` while
keeping only ONE side's clip. The keep-local resolve merges again and persists
the single-sided track (`conflicts: []` after resolve), and the peer's poll then
drops the other collaborator's previously saved clip. This is exactly the
`mergeSharedProjects` whole-track comparison the defect describes.

### Two-context browser (`runs/baseline-b/qa365-trace.json`)

| Field | Baseline value (run b) |
| --- | --- |
| `guestConflictBanner` | `true` |
| `guestConflictText` | `…tracks[voice_replacements]… Keep my conflicting edits / Use saved project` |
| `clipsAfterA` | `[{ "assetId": "rec_e8a7f7f4-…", "start": 0, "duration": 2 }]` |
| `bLocalClipBeforeSave` | `rec_e0a64031-…` |
| `serverClipsAfterResolve` | `[{ "assetId": "rec_e0a64031-…", "start": 4, "duration": 2 }]` (**A's clip gone**) |
| `ownerLocalClipsAfterSettle` | `[{ "assetId": "rec_e0a64031-…", "start": 4, "duration": 2 }]` (**A's own screen lost A's recording**) |
| `serverKeepsA` | **`false`** |
| `serverKeepsB` | `true` |
| `ownerKeepsA` | **`false`** |

Failing assertions (verbatim from the run log):

```
FAIL: owner A's recording was dropped from the server project after B chose 'Keep my conflicting edits'
FAIL: owner A's own screen lost A's recording after B chose 'Keep my conflicting edits'
FAIL: recordings not both retained: serverKeepsA=false serverKeepsB=true ownerKeepsA=false
```

`runs/baseline-a` shows the same failure with a different run's asset ids
(`rec_73f1a083-…` dropped; `rec_c3e1ce40-…` kept). This matches the independent
RYA-363 evidence (`runc1/qa333c-trace.json`: `serverClipsAfterResolve` kept only
B's clip; `aLocalClipsAfterSettle` kept only B's clip).

## Evidence

- `runs/baseline-a/qa365-trace.json`, `runs/baseline-b/qa365-trace.json`
  (force-added to git).
- `runs/baseline-a/merge-level.log`, `runs/baseline-b/merge-level.log`
  (force-added to git).
- Screenshots (`runs/baseline-a/` and `runs/baseline-b/`):
  `01-both-joined.png`, `02-owner-recorded.png`,
  `03-guest-conflict.png` (conflict banner `tracks[voice_replacements]`),
  `04-guest-resolved.png` (B kept its edits; A's clip already dropped),
  `05-owner-after-settle.png` (A's screen now shows B's clip only).
- Per-context console/network capture is embedded in the trace; no app errors
  beyond the mocked-ASR/GPU fixture notices.

## Candidate expectation

When Astra's fix retains both non-overlapping voice clips (merge the clips
within the track, or surface a conflict whose resolution preserves the
non-overlapping clip), both the merge-level check (exit 0) and the browser check
(exit 0, `serverKeepsA=true`, `serverKeepsB=true`, `ownerKeepsA=true`) must pass
with the harness **unchanged**. The GLM Reviewer replays the two-context journey
against the exact integrated candidate.
