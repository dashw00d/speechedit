# RYA-365 non-overlapping re-record merge regression lab

Isolated, disposable lab for the SpeechEdit collaboration defect prepared for
Astra's queue: [RYA-363](/RYA/issues/RYA-363) (SPE-BUG2b) — two collaborators each
add their FIRST `voice_replacements` clip from a base that lacks the track, on two
different non-overlapping passages. `mergeSharedProjects` compares the whole
track object; the base side `b` is `undefined`, so it pushes
`tracks[voice_replacements]` and keeps one side's entire track. The other
recording is dropped, and `CollaborationClient.resolve(keepLocal = true)` then
persists that single-sided track, permanently deleting the first collaborator's
take from the shared project and from their own screen on the next poll.

This lab only prepares the fixtures/harness/baseline evidence. It does **not**
contain or implement the product fix; implementation belongs to Astra and the
independent two-user replay belongs to the GLM Reviewer.

## Environment

| Item | Value |
| --- | --- |
| Worktree | `/home/ryan/dev/speechedit-qa365-builder` (own branch `qa365/nonoverlap-voice-merge-regression-harness`) |
| Baseline commit | `e9b65904dfe71f9d28a901fc16db6f0d509e46ec` (`origin/main`, deployment-approximate) |
| Built web app under test | `src/renderer/dist/assets/index-Bg71JEhD.js` (965,457 B, sha256 `ad92bc7d…6322e`) |
| CSS identity cross-check | `index-CreKLqQ_.css` sha256 `aeb9644c…f1216c` — matches the RYA-331 baseline |
| Service port | **3367** (own review dir `.lab-rya365/reviews`, own whisper cache `.lab-rya365/whisper`) |
| Merge-level harness | `scripts/qa365-nonoverlap-voice-merge-regression.ts` |
| Browser harness | `scripts/qa365-two-records-loss.cjs` |

Ports `3361`/`3362` (discovery), `3363` (bh333), `3364` (RYA-340), `3365`
(RYA-351), `3366` (RYA-354) and `3376`/`3377` (Astra) were live or reserved and
were not touched. The shared checkout `/home/ryan/dev/speechedit`, the discovery
lab `/home/ryan/dev/speechedit-qa331-main` and the other Builder worktrees were
**not** modified. All product source under test is exactly `e9b6590`.

## Run

```sh
# 1. isolated service (own review dir + whisper cache + port)
/home/ryan/dev/speechedit-qa365-builder/.lab-rya365/start-service.sh 3367 \
  /home/ryan/dev/speechedit-qa365-builder/.lab-rya365 &
curl -s http://127.0.0.1:3367/healthz          # {"ok":true}

# 2. fast merge-level check + two-context browser confirmation
/home/ryan/dev/speechedit-qa365-builder/.lab-rya365/run-suite.sh \
  http://127.0.0.1:3367 \
  /home/ryan/dev/speechedit-qa365-builder/.lab-rya365/runs/<name>
# exit 0 = all checks pass, 2 = acceptance check failed, 1 = harness error/timeout
```

Requirements: `PATH` must include `/home/ryan/.nvm/versions/node/v25.9.0/bin`
(`bun` + `node`); Electron runs hidden under Xwayland. `run-suite.sh` resolves
`DISPLAY`/`XAUTHORITY` and `node_modules/.bin` automatically. No `ffmpeg` is
needed: the fixture is a synthetic WAV synthesized in-page and Whisper is mocked
deterministically.

## Re-run unchanged against Astra's integrated candidate

The harness is unchanged. Only point `run-suite.sh` at a service built from the
candidate's `src/renderer/dist` on a free port:

```sh
# e.g. in Astra's isolated candidate worktree
HOST=127.0.0.1 PORT=3378 SPEECHEDIT_REVIEW_DIR=<dir>/reviews \
  SPEECHEDIT_WEB_ROOT=<candidate>/src/renderer/dist \
  SPEECHEDIT_CACHE_DIR=<dir>/whisper bun scripts/web-server.ts &
/home/ryan/dev/speechedit-qa365-builder/.lab-rya365/run-suite.sh \
  http://127.0.0.1:3378 /home/ryan/dev/speechedit-qa365-builder/.lab-rya365/runs/<candidate>
```

The candidate passes only when both the merge-level check and the browser check
pass (suite exit 0).

## What the suite checks

### 1. Merge-level regression (fast, deterministic)

Fixture: two spoken passages with a gap, source duration 10 s.

- `Welcome to this recording.` → words 0–3, source `0.0–2.0 s`
- `Now a different chapter.` → words 4–7, source `4.0–6.0 s`

Concurrent edits from one shared base that lacks `voice_replacements`:

- **A**: `replaceAudioRange(base, 0, 2, take-A)` → clip slot `[0, 2]`
- **B**: `replaceAudioRange(base, 4, 6, take-B)` → clip slot `[4, 6]`

The harness calls the app's real `mergeSharedProjects` in BOTH save orders and
through the full stale-save → keep-local → peer-poll sequence, asserting the
safe invariant:

> every modeled merge retains BOTH collaborators' voice clips

Checks (all must pass): `stale-save:B-local+A-remote`, `stale-save:A-local+B-remote`
(the second-saver merges), `resolve:B-keep-local -> peer:A-sees-server`,
`resolve:A-keep-local -> peer:B-sees-server` (the first saver polls the persisted
single-sided result). Discriminating controls (`control:single-A`,
`control:single-B`, `control:no-op`, `control:identical-edit-both`,
`control:voice-vs-unrelated-track`) must pass at baseline, proving the invariant
is specific to the "both sides added the first clip" collision. Two candidate
self-tests (`candidate-sim:union-both-clips`,
`candidate-sim:conflict-resolved-both-clips`) confirm the pass path is reachable
for either fix shape without modifying product source.

### 2. Two-context browser confirmation (owner + guest)

Two independent Electron contexts — the reel owner (FIRST recorder, opening their
own full editing link) and a guest (SECOND recorder) — over one full-editing
room:

1. Owner records words 0–3 and saves (`Save now`); server now has A's clip.
2. The guest's room poll is paused so its base has no `voice_replacements` track.
3. Guest records words 4–7 (distinct non-overlapping slot) against its stale base.
4. Poll unblocked; guest saves → conflict banner
   (`tracks[voice_replacements]`), then clicks **"Keep my conflicting edits"**.
5. Asserts the persisted server project and the owner's own synced screen:

   - `clipsAfterA` — A's clip before B saved,
   - `serverClipsAfterResolve` — the shared project after B's resolve,
   - `ownerLocalClipsAfterSettle` — A's local draft after it polls and settles,
   - **`serverKeepsA`**, **`serverKeepsB`**, **`ownerKeepsA`**.

Fail condition: either recording is missing from the server project or A's own
screen loses A's clip.

## Files

- `scripts/qa365-nonoverlap-voice-merge-regression.ts` — merge-level harness.
- `scripts/qa365-two-records-loss.cjs` — two-context browser harness.
- `.lab-rya365/start-service.sh` — isolated service launcher.
- `.lab-rya365/run-suite.sh` — env-correct runner (merge-level + browser).
- `.lab-rya365/BASELINE-FAILURE.md` — baseline failure proof and exact assertions.
- `.lab-rya365/runs/` — per-run trace + screenshots (evidence; the baseline runs
  are force-added to git).

## Limitations

- Baseline `e9b6590` is deployment-approximate, not the confirmed deployed commit
  (see `/home/ryan/dev/speechedit-qa331-main/.lab-rya331/BASELINE.md`). Deployed
  `https://speechedit.dashwood.net` is not used by this suite.
- Transcription/ASR, microphone and GPU are mocked; the real collaboration
  client, merge logic, review server, sync loop and re-record flow run for real.
- The two browser contexts both join through the room's full editing link (the
  owner opens their own link), matching the two-person scenario in
  [RYA-363](/RYA/issues/RYA-363). The merge path exercised is the same
  `mergeSharedProjects` full-editor path; the merge-level harness additionally
  pins the exact function the defect lives in.
- The candidate pass path was not exercised here (this task must not implement
  the fix). The candidate self-tests exercise the same safe invariant a fixed
  merge must satisfy.

## Cleanup

- Stop the service: `kill $(cat .lab-rya365/service.pid 2>/dev/null) $(ss -ltnp | grep :3367 | grep -o 'pid=[0-9]*' | cut -d= -f2)`.
- Remove the worktree only after its branch work is merged or no longer needed:
  `git -C /home/ryan/dev/speechedit worktree remove --force /home/ryan/dev/speechedit-qa365-builder`.
