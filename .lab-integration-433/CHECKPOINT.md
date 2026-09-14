# SPE-INT2 integration checkpoint — mic-denied fix merged into release candidate

Task: [RYA-463](/RYA/issues/RYA-463). Purpose: mechanically merge the already-accepted
RYA-433 microphone-denial recovery fix into the accepted RYA-458 release candidate so the
campaign can run its full two-user journey on one complete build. No new product behavior.

## Candidate identity

- Repository: `/home/ryan/dev/speechedit-integration` (isolated clone; the shared
  `/home/ryan/dev/speechedit` checkout and all Astra evidence clones were not written to).
- Branch: `spe-integration/release-candidate-433`.
- Base (RYA-458 accepted): `spe-integration/release-candidate` @
  `53adef5efe19e99b6c55495841d21b07ad123144` (reviewer-approved).
- Source merged: `astra/rya433-microphone-recovery` @ `b109fb3` (product `c07ae38`,
  base `e9b6590`), fetched from `/home/ryan/.paperclip/workspaces/speechedit/astra-rya433`.
- Merge commit: `3feecc9a8528ff14045627faf509248786bf9c4a`
  (parents `53adef5` + `b109fb3`).
- Product files changed by the merge (exactly the accepted RYA-433 diff; verified byte-identical
  to `c07ae38`):
  - `src/renderer/src/components/RecordReplacementSheet.tsx`
  - `src/renderer/src/lib/recording.ts`
- Everything else the merge brought in is the accepted RYA-433 `.lab-rya433/` evidence directory.
- No reset/clean/stash/history rewrite was run. Working tree clean.

## Conflicts resolved

None. The two RYA-433 product files were not touched by any of the six RYA-458 fixes, and the
`ort` merge completed with zero conflict markers. `git grep -E '^(<<<<<<<|=======|>>>>>>>)'` on
both changed files: none. No product-behavior decision was required.

## Behavior left unmerged

None. The only accepted source beyond the RYA-458 candidate is the RYA-433 product diff above.
No other branch, product commit, or behavior change is included.

## Build fingerprint (`bun run build:web`)

Build tools: node `v25.9.0`, bun `1.4.0`. The node-invoked command was also run to give the
reviewer a second reproducible path; unlike RYA-458 there is **no** invoker-dependent hash here
— both commands produce the identical main chunk.

- `src/renderer/dist/assets/index-BA79dj9M.js` — 971,547 B — sha256
  `b3544bb60cee656474177bc823ce5eafcfdf21a259e807349396c7bb443dd2e7`
  (same from `bun run build:web` and
  `node node_modules/vite/bin/vite.js build --config vite.web.config.ts`)
- `src/renderer/dist/assets/index-CMZUotNj.css` — 136,200 B — sha256
  `2f08967ed0ebe8d559981b82632d4325e1417a4082d3e70185a3d9e275ac88f1` (unchanged from base)
- `src/renderer/dist/assets/index-D4CZzrgb.js` — 691,409 B — sha256
  `96f3d92ab141c3a92fcadccad6c89027e712c0efa4d464ba10e9c3fe516b5d89` (unchanged)
- `src/renderer/dist/assets/browserWhisper.worker-DrMuM1nz.js` — 870,047 B — sha256
  `49720ab52fd45280e5d0a3e8866552cdf0271d561549b0fd522d35a25e94d823` (unchanged)
- `index.html` references `index-BA79dj9M.js` + `index-CMZUotNj.css`.

Compared with the RYA-458 base fingerprint (`index-CEANCXUr.js` / `a0061eec…`), only the main
chunk changed; CSS and vendor chunks are identical, consistent with a two-file source change.

## Checks actually run (on this exact candidate `3feecc9`)

| Check | Command | Result |
| --- | --- | --- |
| Build (bun) | `bun run build:web` | PASS — `index-BA79dj9M.js` / `b3544bb6…` |
| Build (node) | `node node_modules/vite/bin/vite.js build --config vite.web.config.ts` | PASS — identical hash |
| Typecheck | `bun run typecheck` | PASS |
| Unit/collaboration suite | `bun test src/renderer/src/lib` | **766 pass / 0 fail**, 5692 expect(), 102 files |
| QA-354 merge-level | `bun scripts/qa354-cut-rerecord-merge-regression.ts` | PASS exit 0 |
| QA-365 merge-level | `bun scripts/qa365-nonoverlap-voice-merge-regression.ts` | PASS exit 0 |
| QA-334 browser (corrected) | `scripts/qa334-sentence-rerecord.cjs` | PASS 15/15 exit 0 |
| QA-336 / QA-340 browser (original) | `scripts/qa336-sentence-rerecord.cjs` | 13/15 exit 2 — two known pre-existing harness defects |
| QA-351 browser | `scripts/qa351-coop-merge-regression.cjs` | PASS exit 0 |
| QA-352 browser | `scripts/qa352-concurrent-cut-rerecord.cjs` | PASS exit 0 (conflict surfaced, no silent over-long merge) |
| QA-354 browser | `scripts/qa354-concurrent-cut-rerecord.cjs` | PASS exit 0 |
| QA-365 browser (original) | `scripts/qa365-two-records-loss.cjs` | exit 1 — obsolete assertion (below) |
| QA-365 supplemental | `.lab-rya363/qa363-auto.cjs` | PASS exit 0 (server + owner keep A+B, no conflict) |
| QA-437 browser | `.lab-rya429/qa437.cjs` | PASS exit 0 (owner observed collaborator edit at 2761 ms, poll count 2) |
| **RYA-433 genuine mic-denial regression** | `.lab-rya433/run-browser.py` (`QA_EXPECT_COPY=1`) | **PASS exit 0** (below) |

All browser rails ran against isolated `bun scripts/web-server.ts` services on free loopback
ports, own review/cache dirs, serving this candidate's `src/renderer/dist`; one service per rail,
each stopped after its run. Runner: `.lab-integration-433/run_rails.py`; evidence under
`.lab-integration-433/runs/` (git-ignored).

### RYA-433 genuine microphone-denial regression (RYA-468 gate)

`.lab-rya433/run-browser.py` mounts the real `RecordReplacementSheet` + recorder in an isolated
Vite fixture. Denial is produced by an Electron permission handler returning `false`; the harness
sets only `use-fake-device-for-media-stream`, **not** the auto-granting
`use-fake-ui-for-media-stream`. PASS on this candidate:

- Denied path shows role=alert "Your microphone is blocked. Allow microphone access in your
  browser or system settings, then retry. Nothing was recorded." with a single "Retry recording";
  MutationObserver saw no countdown and no take; `onUse` calls 0; no "fits the selected slot" and
  no "Use recording".
- Injected `PermissionDeniedError` / `SecurityError` / `NotFoundError` / `NotReadableError` /
  missing `mediaDevices` each map to the correct plain-language explanation + Retry.
- After granting permission, Retry records normally and "Use recording" fires exactly once
  (`uses` 0 → 1); success copy unchanged.
- Stop-early then cancel, and cancel during countdown, both pass (uses 0, sheet closes, no audio).
- Editor-level replacement / Undo / collaborator coverage on this same candidate is provided by
  the passing QA-334 checks `menuMicDeniedLeavesIntact`, `menuUndoRestores`,
  `guestReplacesSentence`, `guestSavedToSharedProject`, `hostObservesReplacementAfterSync`,
  `otherClientObservesReplacementAfterSync` (15/15). The full two-person journey remains the
  independent GLM reviewer's step-7 responsibility.

### Recorded pre-existing limitations (unchanged, not regressions)

- QA-336/QA-340 two failures (`keyboardActivatesReRecord`, `menuMicDeniedLeavesIntact`) are the
  original harness defects already documented in accepted RYA-334 evidence (Electron `Return`
  activation and a premature `Escape`). The corrected `qa334` harness passes 15/15, including
  the same mic-denied/undo/collaborator checks.
- QA-365 original browser harness aborts at "Guest did not get the expected stale-sync conflict"
  because RYA-363 intentionally merges non-overlapping first recordings without a conflict; the
  `.lab-rya363/qa363-auto.cjs` supplemental (only the obsolete banner assert changed) passes.

## Model / attribution transition note

- Product fix (RYA-433) implemented by **Astra** on accepted candidate `b109fb3` / product
  `c07ae38`; accepted by the GLM reviewer (`6432d34a`).
- This mechanical integration was performed by **Builder** (opencode_local,
  DeepSeek V4.1 Flash) under accepted RYA-458. No model switch, no recovery fallback, and no
  provider change was used.

## Remaining limitations / next owner

- Local build only: no deployment, no ServerChirp access, no production/user-data change.
- ASR/microphone are mocked and media is synthetic; no real human two-person session was run here.
- Exact ServerChirp deployed commit/asset hash remains unconfirmed.
- **Next owner: GLM reviewer (`6432d34a`)** — verify this exact candidate `3feecc9` + asset
  hashes and run the campaign's full two-user journey (join → edit → re-record → mic-denial
  recovery → collaborator sync → conflict/disconnect/reload → undo → export).
