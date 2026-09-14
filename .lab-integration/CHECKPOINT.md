# SPE-INT integration checkpoint — SpeechEdit release candidate

Task: [RYA-458](/RYA/issues/RYA-458). Purpose: mechanically assemble the six accepted
Astra SpeechEdit fixes into ONE buildable candidate for the campaign's full two-user journey.

## Candidate identity

- Repository: `/home/ryan/dev/speechedit-integration` (fresh isolated clone of
  `/home/ryan/dev/speechedit`, base `main` @ `e9b65904dfe71f9d28a901fc16db6f0d509e46ec`).
- Branch: `spe-integration/release-candidate`.
- Integration merge tip (contains all six accepted branches): `0ac3867`.
- Exact candidate tip: the commit that adds this file (`git -C /home/ryan/dev/speechedit-integration rev-parse spe-integration/release-candidate`).
- Six source branches fetched from the Astra evidence clones (tips verified before merge):
  `astra/rya342-collaborative-undo` `ccd5759`, `astra/rya334-context-rerecord` `6744523`,
  `astra/rya352-cut-rerecord` `2052e6d`, `astra/rya343-caption-merge` `8075aa4`,
  `astra/rya363-preserve-recordings` `cc59f23`, `astra/rya429-owner-shared-edit-polling` `d8e5450`.
- Merge order: RYA-342 (fast-forward to `ccd5759`), RYA-334 (`861f29f`), RYA-352 (`ddf6d6a`),
  RYA-343 (`5c2e669`), RYA-363 (`a3b8deb`), RYA-429 (`0ac3867`).
- No reset/clean/stash/history rewrite was run. Astra evidence clones and
  `/home/ryan/dev/speechedit` were not written to.

## Conflicts resolved (mechanical only)

1. `src/renderer/src/lib/collaboration.test.ts` — RYA-343 and RYA-363 both inserted a new
   `test(...)` block after the same test ("independent editorial changes…"). Resolved by
   keeping both test blocks and restoring the closing `})` for RYA-343's caption-merge test
   (`collaboration.test.ts:108`). No assertion or product code changed.
2. `src/shared/collaboration.ts` auto-merged (RYA-352 timing check + RYA-343 caption text
   merge + RYA-363 first-track merge) and was reviewed line-by-line; all three coexist
   coherently (imports at line 1-3, `mergeCaptionText` line 58, `merge` signature line 82,
   container block line 93, timing block line 142). No manual edit needed.
3. `src/renderer/src/App.tsx` auto-merged the RYA-334 `startReRecord` extraction with the
   RYA-429 `OwnerSharedEdits` mount; both present, no manual edit.

No conflict required a product-behavior decision.

## Integration build repair (non-behavioral, documented)

`bun run typecheck` PASSED on baseline `e9b6590` but FAILED on the merged tree (and on the
RYA-352 branch alone) with `TS6307`: RYA-352 added `import { resolveProgram } from
'../renderer/src/lib/resolver'` to `src/shared/collaboration.ts`, pulling renderer files into
`tsconfig.node.json`'s program that were not listed. Added `resolver.ts`, `edl.ts`, `takes.ts`,
`keyframes.ts` to the `tsconfig.node.json` `include` list. This changes the typecheck config
only; it changes no product behavior and no emitted bundle. `bun run typecheck` now PASSES.

## Build + deployment fingerprint

- `bun run build:web` — PASS (`✓ built`; pre-existing zod/source-map/chunk-size warnings only).
- Output dir `src/renderer/dist` (git-ignored, rebuilt from the candidate source). `index.html`
  references:
  - `assets/index-BPf3wiR7.js` — 970,878 B — sha256 `7280de50a2a2cee70bf4e5912bfff8cad56a014ba3527e58c53c90e8f865183c`
  - `assets/index-CMZUotNj.css` — 136,200 B — sha256 `2f08967ed0ebe8d559981b82632d4325e1417a4082d3e70185a3d9e275ac88f1`
- Other emitted bundles for completeness:
  - `assets/index-D4CZzrgb.js` — 691,409 B — sha256 `96f3d92ab141c3a92fcadccad6c89027e712c0efa4d464ba10e9c3fe516b5d89`
  - `assets/browserWhisper.worker-DrMuM1nz.js` — 870,047 B — sha256 `49720ab52fd45280e5d0a3e8866552cdf0271d561549b0fd522d35a25e94d823`
- Reference: deployment-approximate `e9b6590` asset was `index-B26-WSjr.js` 965,453 B /
  `index-CreKLqQ_.css` 136,011 B (planning/SPEECHEDIT_DEPLOY_PLAN.md).

## Checks actually run

| Check | Command | Result |
| --- | --- | --- |
| Build | `bun run build:web` | PASS |
| Typecheck | `bun run typecheck` | PASS (after documented tsconfig repair; baseline passed) |
| Unit/collaboration suite | `bun test src/renderer/src/lib` | **766 pass / 0 fail**, 5692 expect(), 102 files |
| QA-354 merge-level | `bun scripts/qa354-cut-rerecord-merge-regression.ts` | PASS exit 0 |
| QA-365 merge-level | `bun scripts/qa365-nonoverlap-voice-merge-regression.ts` | PASS exit 0 |
| QA-351 browser | `scripts/qa351-coop-merge-regression.cjs` | PASS exit 0 (RYA-342 undo-after-merge, crossCueControl, RYA-343 same-cue both persisted/converged) |
| QA-334 browser (corrected) | `scripts/qa334-sentence-rerecord.cjs` | PASS 15/15 exit 0 |
| QA-336 / QA-340 browser (original) | `scripts/qa336-sentence-rerecord.cjs` | 13/15 exit 2 — two known pre-existing harness defects (below) |
| QA-352 browser | `scripts/qa352-concurrent-cut-rerecord.cjs` | PASS exit 0 (conflict surfaced, no silent over-long merge) |
| QA-354 browser | `scripts/qa354-concurrent-cut-rerecord.cjs` | PASS exit 0 |
| QA-365 browser (original) | `scripts/qa365-two-records-loss.cjs` | harness error exit 1 — obsolete assertion (below) |
| QA-365 supplemental | `.lab-rya363/qa363-auto.cjs` | PASS exit 0 (server keeps A+B, owner keeps A+B, no conflict) |
| QA-437 browser | `.lab-rya429/qa437.cjs` | PASS exit 0 (owner observed collaborator edit via in-editor prompt at 2762 ms, poll count 2) |
| QA-429 adjacent controls (not a required rail) | `.lab-rya429/qa429-controls.cjs` | FAIL 3/3 on unmodified harness — latent harness race (below); race-guarded variant PASS |

All browser rails ran against isolated `bun scripts/web-server.ts` services on own ports,
review dirs and whisper caches, serving the candidate `src/renderer/dist`; each service was
stopped after its run. Evidence traces/screenshots are under `.lab-integration/runs/`
(untracked, git-ignored).

### QA-336/QA-340 failures are pre-existing harness defects, not product regressions

`keyboardActivatesReRecord` and `menuMicDeniedLeavesIntact` fail because the original Builder
harness activates the context-menu item with an Electron `Return` down/up (does not fire the
native button) and sends `Escape` before the mic-denied step (closing the record sheet). The
accepted RYA-334 evidence (`docs/quality/RYA-334-results.json` candidate) records the identical
two failures; `docs/quality/RYA-334.md` documents the correction. The corrected
`scripts/qa334-sentence-rerecord.cjs` (used for the QA-334 rail above) passes 15/15.

### QA-365 original browser harness cannot validate the fixed behavior

`.lab-rya365`'s harness hard-requires the pre-fix stale-sync conflict banner and the
"Keep my conflicting edits" path. The accepted RYA-363 fix intentionally merges two
non-overlapping first recordings without a conflict, so the harness aborts at
"Guest did not get the expected stale-sync conflict" (exit 1). The unimplemented pre-fix state
is the harness's precondition, so no pass verdict is producible from it. `.lab-rya363/qa363-auto.cjs`
(changed only the obsolete banner assert; `auto-harness.diff` records the exact change) PASSES:
both recordings survive on the server and owner screen with no conflict banner.

### QA-429 adjacent-controls race (diagnosed, not an integration regression)

The unmodified `.lab-rya429/qa429-controls.cjs` failed 3/3 on the integrated candidate at
`Conflict was not preserved`. Root cause: after `click(guest,'Save now')` the harness immediately
clicks the owner's "Bring shared edits" button (already present from an earlier pending update)
without waiting for the save to land, so the owner's import GETs a stale room, merges cleanly and
reports pending again. The RYA-429 branch alone passed 2/2 (won the race); the branch build is
otherwise unchanged. A debug copy that waits for the guest's "All changes saved" plus 1.5 s before
importing PASSES (`conflictPreserved:true`) on the integrated candidate, and the overlapping
word-edit merge unit test (`collaboration.test.ts` "independent editorial changes merge and
overlapping changes require a decision") passes in the 766-test suite. Conclusion: the integrated
candidate preserves overlapping-edit conflicts; the unmodified adjacent harness has a latent race.

## Explicitly out of scope / not merged

- RYA-433 microphone-denied is a separate, unfixed defect and is NOT part of this integration.
- Known QA-336 harness defects (keyboard activation, mic-denied) and the obsolete QA-365 browser
  assertion were not modified; fixing harnesses is not product behavior for this task.
- No new product behavior beyond the six accepted fixes. Only addition is the documented
  `tsconfig.node.json` include needed for the accepted RYA-352 import to typecheck.

## Remaining limitations

- Exact ServerChirp deployed commit/asset hash remains unconfirmed; no deployment, no
  ServerChirp access, no production/user-data change was performed.
- ASR/microphone are mocked and media is synthetic in the harnesses; no real human two-person
  session was run here.
- The candidate is a local build only. Independent GLM review on this exact candidate (commit +
  asset hashes above) is the required next step, including the full join → edit → re-record →
  sync → disconnect/rejoin → undo/recovery → reload → export journey.
