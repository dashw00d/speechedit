# SPE-INT5 integration checkpoint — accepted RYA-505 keyboard + RYA-504 wrong-key fixes merged

Task: [RYA-536](/RYA/issues/RYA-536). Purpose: mechanically merge the two last independently
accepted SpeechEdit co-op/QoL fixes into the single release candidate so campaign step 7 runs
once on the complete build. No new product behavior.

## Candidate identity

- Repository: `/home/ryan/dev/speechedit-integration` (isolated clone; the shared
  `/home/ryan/dev/speechedit` checkout, both Astra source clones, and all harness/evidence
  clones were not written to).
- Branch: `spe-integration/release-candidate-433`.
- Base tip (accepted SPE-INT4 / RYA-479): `1f61c4f51578df5f874da12c9bf208cd6007e4c2`.
- RYA-505 source: Astra clone `/home/ryan/.paperclip/workspaces/speechedit/astra-rya505`,
  branch `astra/rya505-keyboard`. Accepted product commit
  `4a20be0a6576850a8ef946be432f4ae576f2adb7` (parent `452e968`); checkpoint doc `0999dab`.
- RYA-504 source: Astra clone `/home/ryan/.paperclip/workspaces/speechedit/astra-rya504`,
  branch `astra/rya504-wrong-key`. Accepted product commit
  `73b522514b8ddf229772e6fee887e35b3d83f991` (parent `452e968`); checkpoint doc `58f5b94`.
  Accepted SHA read from the native GLM verdict on [RYA-504](/RYA/issues/RYA-504)
  (comment `44d17e60…`, ACCEPT on `73b5225` / checkpoint `58f5b94`), not assumed.
- Fetched from both Astra clones via `git fetch <clone> <branch>` (read-only source; no remote
  config persisted).
- Merge commits (`--no-ff`, `ort`, zero conflicts):
  - `d14ad5f456c38457d1b8a2edc71534b76670b397` — RYA-505 (parents `1f61c4f` + `4a20be0`).
  - `48407728457069eece86827fb72e78227a454f1c` — RYA-504 (parents `d14ad5f` + `73b5225`).
    **Integration merge commit / candidate product tree.**
- Checkpoint/evidence commit on top of `4840772` adds only this doc and the `rya504` rail in
  `.lab-integration-433/run_rails.py`. Its product tree is identical to `4840772`, so the
  `index-BMU_WyFb.js` / `c2c9d035…` fingerprint below applies to it too.
- Ancestry checks: `git merge-base --is-ancestor` → true for `4a20be0`, `73b5225`,
  `d85e8ef` (RYA-479), `3b8fd2b` (RYA-497), `355556e` (RYA-463), `1f61c4f`.
- Merged scope `git diff --stat 1f61c4f HEAD` is exactly the two accepted diffs:
  - RYA-505: `src/renderer/src/components/Transcript.tsx`, `scripts/run-selection-keyboard.py`,
    `scripts/selection-keyboard-smoke.cjs`.
  - RYA-504: `src/renderer/src/components/EditPage.tsx`, `scripts/edit-key-smoke.cjs`.
  - No unrelated branch, product commit, or behavior change.

## Build fingerprint (`bun run build:web`)

Build tools: node `v25.9.0`, bun `1.4.0`.

- `src/renderer/dist/assets/index-BMU_WyFb.js` — 973,980 B — sha256
  `c2c9d035d82402dae07efcbebb430ef30cb72ef2a33e529526897d1c6233448d` (**new integrated main
  chunk**; combines RYA-505 + RYA-504).
- `src/renderer/dist/assets/index-CMZUotNj.css` — 136,200 B — sha256
  `2f08967ed0ebe8d559981b82632d4325e1417a4082d3e70185a3d9e275ac88f1` (unchanged).
- `src/renderer/dist/assets/index-D4CZzrgb.js` — 691,409 B — sha256
  `96f3d92ab141c3a92fcadccad6c89027e712c0efa4d464ba10e9c3fe516b5d89` (unchanged).
- `src/renderer/dist/assets/browserWhisper.worker-DrMuM1nz.js` — 870,047 B — sha256
  `49720ab52fd45280e5d0a3e8866552cdf0271d561549b0fd522d35a25e94d823` (unchanged).
- `dist/index.html` references `index-BMU_WyFb.js` + `index-CMZUotNj.css`.
- The RYA-505 keyboard runner independently re-fetched and fingerprinted the served bundle as
  exactly `index-BMU_WyFb.js` / `c2c9d035…` (`.lab-integration-433/runs/rya505/served-build.json`).

## Checks actually run (on this exact integration `4840772`)

| Check | Command | Result |
| --- | --- | --- |
| Build (web) | `bun run build:web` | PASS — `index-BMU_WyFb.js` / `c2c9d035…` |
| Full lib suite | `bun test src/renderer/src/lib` | **767 pass / 0 fail**, 5701 expect(), 102 files |
| RYA-505 keyboard rail | `python3 scripts/run-selection-keyboard.py --out .lab-integration-433/runs/rya505` | **PASS** exit 0 — 26/26 steps, 0 findings |
| RYA-504 wrong-key rail | `python3 .lab-integration-433/run_rails.py rya504` | **PASS** exit 0 — 6/6 checks, 0 failures |
| RYA-493 host/guest export journey | `python3 .lab-rya493/run-journey.py` | **PASS** exit 0 (11 downloads) |
| RYA-490 export acceptance | `QA490_SKIP_BUILD=1 QA490_WEB_ROOT=<integrated dist> python3 .lab-rya490/run-export.py` | **PASS 70/70 checks, 13 downloads, 0 failures, 0 network errors** |
| RYA-479 host-workspace sync rail | `python3 .lab-integration-433/run_rails.py rya479` | **PASS** exit 0 — 0 failures; `hostSyncMs=2978`, conflict/offline/reopen checks pass |

All browser rails ran against isolated `bun scripts/web-server.ts` services on free loopback
ports with their own review/cache dirs; each service stopped after its run. No production or
ServerChirp access, no real user data.

### RYA-505 keyboard rail

`.lab-integration-433/runs/rya505/` — `KEYBOARD_RESULTS {"findings":[]}`, exit 0. 26/26 host and
guest steps pass (pointer/keyboard selection → 1 Tab to `BUTTON:chip:Correct word`; Enter opens
the word input; Escape returns to the transcript; Delete/repeat-Delete/Undo/search guardrails).

### RYA-504 wrong-key rail

`.lab-integration-433/runs/rya504/` — `results.json` all six checks `pass:true`, exit 0:
reused-context wrong fragment denies editor, server rejects wrong bearer with a valid cookie,
valid fragment recovers editor, cookie-only reload retains access, fresh wrong key denies, reused
wrong key reload denies. Screenshot `wrong-key.png`.

### RYA-493 / RYA-490 / RYA-479 rails

- `QA493_RESULTS {"pass":true,"failures":[],"downloadCount":11}`.
- RYA-490 `QA490_RESULTS {"pass":true,"failures":[],"exchangeCount":7,"downloadCount":13}`;
  `results.checks` = 70/70 ok, `completed=true` (prior pass count retained, 0 errors).
- RYA-479 `QA471_RESULTS {"pass":true,"failures":[],...}` (prior PASS retained).

## Harness-only integration (no product behavior)

- `.lab-integration-433/run_rails.py` — added a `rya504` rail that runs the accepted
  `scripts/edit-key-smoke.cjs` harness from the existing integration runner and passes
  `--out=<rail evidence dir>`. Generic optional extra-args support; existing rails unchanged.
- RYA-490 harness reused from the accepted harness clone via a local untracked copy
  (`.lab-rya490/`) pointed at the integrated dist; not part of the committed change.

## Preserved dirty evidence

`.lab-rya433/baseline/*` remains uncommitted and byte-identical to the SPE-INT4 record:
`denied.png` sha256 `050cfcd3d45abe199bffea70ecfbe507b0ee92fe64c10a3350e64403082de42d`,
`trace.json` sha256 `abb651d8b45f9ad17109b887448789365bd886e554865a740e4bc2cbe6869255`.
No reset/clean/stash/history rewrite was run.

## Behavior left unmerged

None. Beyond the RYA-479 candidate the only accepted source is exactly the RYA-505 and RYA-504
product ranges above.

## Attribution

- Product fixes implemented by **Astra** (`4a20be0` accepted by GLM on 2026-09-14 12:48Z;
  `73b5225` accepted by GLM on 2026-09-14 13:11Z). This mechanical integration and the
  harness-only rail addition were performed by **Builder** (opencode_local, DeepSeek V4.1 Flash).
  No model switch, no recovery fallback, no provider change.

## Remaining limitations / next owner

- Local build only: no deployment, no ServerChirp access, no production/user-data change.
- ASR/microphone are mocked and media is synthetic; no real human two-person session was run here.
- Exact ServerChirp deployed commit/asset hash remains unconfirmed.
- **Next owner: independent GLM reviewer via [RYA-537](/RYA/issues/RYA-537)** (already blocked by
  this issue; Dispatcher-created). Verify this exact candidate `4840772` + asset hash `c2c9d035…`
  and rerun the campaign two-user journey on the integrated build. Not self-approved.
