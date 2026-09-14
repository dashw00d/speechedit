# RYA-351 co-op merge-wipe Undo + same-cue conflict regression lab

Isolated, disposable lab for the two SpeechEdit collaboration defects prepared for
Astra's queue: [RYA-342](/RYA/issues/RYA-342) (Undo wiped after a peer merge) and
[RYA-343](/RYA/issues/RYA-343) (same-cue different-word edits raise a blocking
conflict). Baseline candidate is the deployment-approximate `origin/main` @
`e9b6590`.

This lab only prepares the fixture/harness/regression evidence. It does **not**
contain or implement the product fix; implementation belongs to Astra and the
independent two-user replay belongs to the GLM Reviewer.

## Environment

| Item | Value |
| --- | --- |
| Worktree | `/home/ryan/dev/speechedit-qa336-builder` (own branch `qa351/coop-merge-regression-harness`) |
| Baseline commit | `e9b65904dfe71f9d28a901fc16db6f0d509e46ec` (`origin/main`, deployment-approximate) |
| Built web app under test | `src/renderer/dist/assets/index-Bg71JEhD.js` (965,457 B, sha256 `ad92bc7d…6322e`) |
| CSS identity cross-check | `index-CreKLqQ_.css` sha256 `aeb9644c…f1216c` — matches the RYA-331 baseline |
| Service port | **3365** (own review dir `.lab-rya351/reviews`, own whisper cache `.lab-rya351/whisper`) |
| Harness | `scripts/qa351-coop-merge-regression.cjs` |

The worktree was previously used by [RYA-340](/RYA/issues/RYA-340); it was free, so
the Dispatcher's reuse option was taken. Its HEAD was `e59cb52` (RYA-340 harness
files only; `git diff e9b6590 e59cb52 -- src shared` is empty), so all product
source under test is exactly `e9b6590`. Ports `3361`–`3364` were live and were not
touched.

## Run

```sh
# 1. isolated service (own review dir + whisper cache + port)
/home/ryan/dev/speechedit-qa336-builder/.lab-rya351/start-service.sh 3365 \
  /home/ryan/dev/speechedit-qa336-builder/.lab-rya351 &
curl -s http://127.0.0.1:3365/healthz          # {"ok":true}

# 2. two/three-context browser regression suite
/home/ryan/dev/speechedit-qa336-builder/.lab-rya351/run-suite.sh \
  http://127.0.0.1:3365 \
  /home/ryan/dev/speechedit-qa336-builder/.lab-rya351/runs/<name>
# exit 0 = all checks pass, 2 = acceptance check failed, 1 = harness error/timeout
```

Requirements: PATH must include `/home/ryan/.nvm/versions/node/v25.9.0/bin`
(`bun` + `node`); Electron runs hidden under Xwayland. `run-suite.sh` resolves
`DISPLAY`/`XAUTHORITY` automatically. No `ffmpeg` is needed: the fixture is a
synthetic WAV synthesized in-page and Whisper is mocked deterministically.

## Re-run unchanged against Astra's integrated candidate

Point the suite at a service built from the candidate's `src/renderer/dist` on a
free port; the harness itself is unchanged:

```sh
# e.g. in Astra's isolated candidate worktree
HOST=127.0.0.1 PORT=3375 SPEECHEDIT_REVIEW_DIR=<dir>/reviews \
  SPEECHEDIT_WEB_ROOT=<candidate>/src/renderer/dist \
  SPEECHEDIT_CACHE_DIR=<dir>/whisper bun scripts/web-server.ts &
/home/ryan/dev/speechedit-qa336-builder/.lab-rya351/run-suite.sh \
  http://127.0.0.1:3375 /home/ryan/dev/speechedit-qa336-builder/.lab-rya351/runs/<candidate>
```

The candidate passes only when `results.pass === true` (exit 0).

## What the suite checks

Three independent Electron contexts — owner/editor, **Guest A**, **Guest B** — over
one full edit link. Fixture: two caption cues, 8 words.

- `Welcome to this recording.` → words 0–3 (`Welcome`, `to`, `this`, `recording.`)
- `Now a different chapter.` → words 4–7 (`Now`, `a`, `different`, `chapter.`)

### RYA-342 — Undo survives a peer merge

1. Guest edits word 2 → `G2`, saves; edits word 3 → `G3`, saves.
2. Asserts Undo is enabled and reverses `G3` **before** the merge (then Redo + save).
3. Peer edits word 5 (different cue) and saves → `projectRevision` advances.
4. Guest observes the peer edit, then asserts:
   - `undoEnabledAfterMerge` — Undo is still enabled after the merge.
   - `undoAfterMergeWorked` — clicking Undo reverses the guest's own last edit (`G3`).
   - `peerEditPreserved` — the peer's edit is still present.
   - `revisionAdvanced` — the merge really changed `projectRevision`.

Baseline result: `undoEnabledAfterMerge:false`, `undoAfterMergeWorked:false`, so the
scenario fails.

### RYA-343 — same-cue different-word edits

1. Clean sync barrier; peer goes offline so its base freezes.
2. Guest edits word 6 → `SameCueA` and saves.
3. Peer edits word 7 → `SameCueB` (different word, same cue) on the stale base.
4. Peer reconnects; its poll merges against the newer revision.
5. Asserts:
   - `noBlockingConflict` — no `Resolve simultaneous edits` / `Another editor changed…`.
   - `bothWordsPersisted` — server has word 6 `SameCueA` **and** word 7 `SameCueB`.
   - `clientsConverged` — both clients show both words.

Baseline result: peer stuck on `Resolve simultaneous edits · vN`, `serverWord7` stays
`chapter.`, so the scenario fails.

### `crossCueControl` — discriminating control (must pass at baseline)

Guest edits word 0, peer edits word 4 (different cue) from the same revision and
both save; both edits merge cleanly and persist. This control passes at baseline,
proving the convergence/conflict selectors are not trivially always-failing and
isolating RYA-343 to same-cue merge granularity.

## Files

- `scripts/qa351-coop-merge-regression.cjs` — the harness.
- `.lab-rya351/start-service.sh` — isolated service launcher.
- `.lab-rya351/run-suite.sh` — env-correct runner.
- `.lab-rya351/BASELINE-FAILURE.md` — baseline failure proof and exact assertions.
- `.lab-rya351/runs/` — per-run trace + screenshots (evidence; not committed
  except the baseline traces, which are force-added).

## Limitations

- Baseline `e9b6590` is deployment-approximate, not the confirmed deployed commit
  (see `/home/ryan/dev/speechedit-qa331-main/.lab-rya331/BASELINE.md`). Deployed
  `https://speechedit.dashwood.net` is not used by this suite.
- Transcription/ASR, microphone and GPU are mocked; the real collaboration client,
  merge logic, review server and sync loop run for real.
- Only text-word edits are exercised (no audio re-record); RYA-343's merge is a text
  primitive, so this covers the reported defect.
- The candidate pass path was not exercised here (this task must not implement the
  fix). The `crossCueControl` scenario exercises the same "no conflict / converged"
  checks that a fixed same-cue merge must satisfy.

## Cleanup

- Stop the service: `kill $(cat .lab-rya351/service.pid)` or `ss -ltnp | grep :3365`.
- Remove the worktree only after its branch work is merged or no longer needed:
  `git -C /home/ryan/dev/speechedit worktree remove --force /home/ryan/dev/speechedit-qa336-builder`.
