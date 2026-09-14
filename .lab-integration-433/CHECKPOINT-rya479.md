# SPE-INT4 integration checkpoint — RYA-479 host-workspace sync fix merged into release candidate

Task: [RYA-519](/RYA/issues/RYA-519). Purpose: mechanically merge the independently accepted
RYA-479 host-workspace sync fix into the single SpeechEdit release candidate so the campaign
step-7 two-user journey runs on one complete build. No new product behavior.

## Candidate identity

- Repository: `/home/ryan/dev/speechedit-integration` (isolated clone; the shared
  `/home/ryan/dev/speechedit` checkout, the Astra source clone and all harness evidence
  clones were not written to).
- Branch: `spe-integration/release-candidate-433`.
- Base tip (accepted RYA-497 integration): `7401bf8eb05e05c0edca4d1577140d5c3cf3e1f1`.
- Source fetched from Astra clone
  `/home/ryan/.paperclip/workspaces/speechedit/astra-rya479`, branch `astra/rya479-host-sync`,
  tip `452e9688c151be528cf8d1741059b4e851cf1b68`. Accepted product+harness commit
  `d85e8ef`; checkpoint/evidence `ed4fe6a`, `452e968`.
- `merge-base(452e968, 7401bf8) = 7401bf8`, so the merged range is exactly the three accepted
  commits: `d85e8ef`, `ed4fe6a`, `452e968`.
- Integration merge commit: `1c80a5cb506e848e535ee0896b38099aba1d08f4`
  (parents `7401bf8` + `452e968`, `--no-ff`, `ort` zero conflicts).
- `git merge-base --is-ancestor d85e8ef HEAD` → true; `git merge-base --is-ancestor 452e968 HEAD`
  → true; prior accepted fixes `3b8fd2b` (RYA-497) and `355556e` (RYA-463) remain reachable.
- Product files changed by the merge (exactly the accepted `d85e8ef` diff plus its docs/harness):
  - `src/renderer/src/components/OwnerSharedEdits.tsx`
  - `src/renderer/src/lib/ownerSharedEdits.ts`
  - `src/renderer/src/lib/collaborationClient.ts`
  - `src/renderer/src/lib/sharedMediaUpload.ts` (new)
  - `scripts/owner-workspace-sync-smoke.cjs` (accepted harness, new)
  - `docs/quality/RYA-479.md`, `docs/quality/RYA-479-results.json`
- Dirty `.lab-rya433/baseline/*` evidence preserved: `denied.png` sha256
  `050cfcd3d45abe199bffea70ecfbe507b0ee92fe64c10a3350e64403082de42d` and `trace.json` sha256
  `abb651d8b45f9ad17109b887448789365bd886e554865a740e4bc2cbe6869255` are byte-identical to the
  RYA-497 checkpoint and remain uncommitted in the working tree. No reset/clean/stash/history
  rewrite was run.

## Build fingerprint (`bun run build:web`)

Build tools: node `v25.9.0`, bun `1.4.0`.

- `src/renderer/dist/assets/index-CubxN0L6.js` — 973,136 B — sha256
  `fa8773b9b3e13be637082f1c594a0eeb975280eb0c52c514bb37090fb20b2f23`
  — **byte-identical to the independently accepted RYA-479 candidate fingerprint**.
- `src/renderer/dist/assets/index-CMZUotNj.css` — 136,200 B — sha256 `2f08967e…` (unchanged)
- `src/renderer/dist/assets/index-D4CZzrgb.js` — 691,409 B — sha256 `96f3d92a…` (unchanged)
- `src/renderer/dist/assets/browserWhisper.worker-DrMuM1nz.js` — 870,047 B — sha256
  `49720ab5…` (unchanged)
- `index.html` references `index-CubxN0L6.js` + `index-CMZUotNj.css`.

The main chunk hash matching RYA-479's accepted `fa8773b9…` demonstrates the integrated build
is the accepted build, not a re-derived one.

## Checks actually run (on this exact integration `1c80a5c`)

| Check | Command | Result |
| --- | --- | --- |
| Build (web) | `bun run build:web` | PASS — `index-CubxN0L6.js` / `fa8773b9…` |
| Full lib suite | `bun test src/renderer/src/lib` | **767 pass / 0 fail**, 5701 expect(), 102 files |
| RYA-493 host/guest export journey | `python3 .lab-rya493/run-journey.py` | **PASS** exit 0 (11 downloads) |
| RYA-490 export acceptance | `QA490_SKIP_BUILD=1 QA490_WEB_ROOT=<integrated dist> python3 .lab-rya490/run-export.py` | **PASS 70/70 checks, 13 downloads, 0 failures, 0 network errors** |
| RYA-479 host-workspace sync rail | `python3 .lab-integration-433/run_rails.py rya479` | **PASS** exit 0 — `results.completed=true`, `results.pass=true`, 0 failures |

All rails ran against isolated `bun scripts/web-server.ts` services on free loopback ports with
their own review/cache dirs; each service stopped after its run.

### RYA-479 host-workspace sync rail (`scripts/owner-workspace-sync-smoke.cjs`)

`QA471_RESULTS {"pass":true,"failures":[],...}`. Evidence `.lab-integration-433/runs/rya479/`:

- Host correction in the **normal workspace** reached the shared project and the guest with
  `hostSyncMs = 2970` ms (one 3-second sync interval). `hostEditShared=true`,
  `serverWordsAfterHostEdit` and `guestWordsAfterHostEdit` both contain `HostWord`.
- Undo of the host correction and of a brought-in guest edit propagated (`undoHostShared=true`,
  `undoPullShared=true`).
- Pending/conflict/offline/same-word/second-host-tab/link-reopen checks all passed.
- Baseline context (accepted RYA-479 evidence, same harness): fails **8 checks** on fresh
  `7401bf8`; passes 0-failure on the candidate. Not re-run here (recorded baseline, not a new
  regression).

### RYA-493 host/guest export journey (guest words-primary + RYA-435 gate)

`.lab-rya493/run-journey.py` PASS, `QA493_RESULTS {"pass":true,"failures":[],"downloadCount":11}`.
Evidence `.lab-rya493/runs/20260914T120226Z/`. Guest "Download the words" wrote five files; host
toolbar Export emitted zero downloads and was rejected by the RYA-435 gate.

### RYA-490 export acceptance

Against the integrated web root (`src/renderer/dist` of this candidate), run
`.lab-integration-433/runs/rya490/`: **PASS 70/70 checks, 0 failures, 13 downloads, 0 network
errors.** Fixture `qa490-tone.wav`, 512,078 B, sha256
`15a1f8e508f20c9c135e6f35f5003db677dab505853bd15c4e0ec4e9ed180002` (unchanged).

## Harness-only integrations (no product behavior)

Two test-harness files changed in a follow-up commit; no `src/renderer/src` product file was
touched by this integration beyond the accepted `d85e8ef` diff.

1. `.lab-integration-433/run_rails.py` — added a `rya479` rail so the accepted
   `scripts/owner-workspace-sync-smoke.cjs` reruns from the existing integration runner.
2. `.lab-rya493/qa493-export-journey.cjs` — the guest-save notice gate matched
   `/saved|update|change/i && !/No new updates/i`. RYA-479 replaced the host idle copy
   "No new updates." with "Your changes are shared.", which the loose regex matched
   immediately, so the harness clicked "Bring shared edits into this project" before the
   guest save was detected and aborted with a harness error. The gate now waits for the
   actual actionable pull button, which is the intended notification. This is the exact
   copy drift the accepted RYA-479 checkpoint flagged ("Existing RYA-429 checks that require
   the literal idle copy 'No new updates' … need their expected copy updated"). First
   pre-fix run `QA493_RESULTS {"pass":false,...,"downloadCount":0}` (harness error, no
   product failure); post-fix PASS 11 downloads.

## Behavior left unmerged

None. The only accepted source beyond the RYA-463/RYA-497 candidate is the RYA-479 range above.
No unrelated branch, product commit, or behavior change is included.

## Model / attribution transition note

- Product fix (RYA-479) implemented by **Astra** on accepted commit `d85e8ef`, accepted by the
  independent GLM reviewer on 2026-09-14 11:52Z. This mechanical integration and harness
  adaptation were performed by **Builder** (opencode_local, DeepSeek V4.1 Flash). No model
  switch, no recovery fallback, no provider change.

## Remaining limitations / next owner

- Local build only: no deployment, no ServerChirp access, no production/user-data change.
- ASR/microphone are mocked and media is synthetic; no real human two-person session was run here.
- Exact ServerChirp deployed commit/asset hash remains unconfirmed.
- **Next owner: independent GLM reviewer (Dispatcher schedules it)** — verify this exact
  candidate `1c80a5c` + asset hash `fa8773b9…` and run the campaign's full two-user journey
  (join → edit → re-record → mic-denial recovery → collaborator sync → conflict/disconnect/
  reload → undo → export), including host-workspace propagation and the guest words-primary
  download.
