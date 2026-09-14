# SPE-INT3 integration checkpoint — RYA-497 guest-export fix merged into release candidate

Task: [RYA-503](/RYA/issues/RYA-503). Purpose: mechanically merge the already-accepted
RYA-497 guest-export fix into the single SpeechEdit release candidate (RYA-463 tip) so the
campaign step-7 two-user journey runs on one complete build. No new product behavior.

## Candidate identity

- Repository: `/home/ryan/dev/speechedit-integration` (isolated clone; the shared
  `/home/ryan/dev/speechedit` checkout and all Astra/harness evidence clones were not written to).
- Branch: `spe-integration/release-candidate-433`.
- Base tip (accepted RYA-463): `1ad98fd7938cb4d65e04350a571d31470ff890ba`.
- Source merged: `3b8fd2b05b48aff7923754d09e5b826322bc0f9a`
  ("fix: lead shared-editor export with usable words download") on `astra/rya497-guest-export`,
  fetched from `/home/ryan/.paperclip/workspaces/speechedit/astra-rya497`. Parent of `3b8fd2b`
  is exactly `1ad98fd`, and `merge-base(3b8fd2b, base) = 1ad98fd`, so this is one clean commit.
- Integration merge commit: `999dab1a5e1727b7e1cbabb068a071e734af8b6f`
  (parents `1ad98fd` + `3b8fd2b`; `--no-ff`). Independent GLM review
  [RYA-501](/RYA/issues/RYA-501) ACCEPTED `3b8fd2b`.
- Product files changed by the merge (exactly the accepted `3b8fd2b` diff):
  - `src/renderer/src/components/ExportSheet.tsx`
  - `src/renderer/src/lib/exportActions.ts`
  - `src/renderer/src/lib/exportActions.test.ts`
  - `.lab-rya493/` (accepted harness: `.gitignore`, `qa493-export-journey.cjs`, `run-journey.py`)
- `git merge-base --is-ancestor 3b8fd2b HEAD` → true; `git log` shows the accepted source
  commit reachable from the candidate tip.
- Conflict markers: none. `ort` completed with zero conflicts. No product-behavior decision.
- Dirty `.lab-rya433/baseline/*` evidence preserved: `denied.png` sha256 `050cfcd3…` and
  `trace.json` sha256 `abb651d8…` are byte-identical before and after the merge, and remain
  uncommitted in the working tree. No reset/clean/stash/history rewrite was run.

## Build fingerprint (`bun run build:web`)

Build tools: node `v25.9.0`, bun `1.4.0`.

- `src/renderer/dist/assets/index-DC4w2cGG.js` — 971,770 B — sha256
  `80c288602f412dd0eb19a5df4185fb6d0a51107cfc01e20cf1fdac5091b610af`
- `src/renderer/dist/assets/index-CMZUotNj.css` — 136,200 B — sha256
  `2f08967ed0ebe8d559981b82632d4325e1417a4082d3e70185a3d9e275ac88f1` (unchanged from RYA-463)
- `src/renderer/dist/assets/index-D4CZzrgb.js` — 691,409 B — sha256
  `96f3d92ab141c3a92fcadccad6c89027e712c0efa4d464ba10e9c3fe516b5d89` (unchanged)
- `src/renderer/dist/assets/browserWhisper.worker-DrMuM1nz.js` — 870,047 B — sha256
  `49720ab52fd45280e5d0a3e8866552cdf0271d561549b0fd522d35a25e94d823` (unchanged)
- `index.html` references `index-DC4w2cGG.js` + `index-CMZUotNj.css`.

Compared with the RYA-463 fingerprint (`index-BA79dj9M.js` / `b3544bb6…`), only the main chunk
changed (971,547 → 971,770 B), consistent with the `ExportSheet.tsx` + `exportActions.ts`
change. CSS and vendor chunks are identical.

## Checks actually run (on this exact integration `999dab1`)

| Check | Command | Result |
| --- | --- | --- |
| Build (web) | `bun run build:web` | PASS — `index-DC4w2cGG.js` / `80c28860…` |
| Focused unit test | `bun test src/renderer/src/lib/exportActions.test.ts` | **4 pass / 0 fail**, 49 expect() |
| Full lib suite | `bun test src/renderer/src/lib` | **767 pass / 0 fail**, 5701 expect(), 102 files |
| RYA-493 host/guest export journey | `python3 .lab-rya493/run-journey.py` | **PASS** exit 0 (11 downloads) |
| RYA-490 export acceptance | `QA490_SKIP_BUILD=1 QA490_WEB_ROOT=<integrated dist> python3 .lab-rya490/run-export.py` | **PASS 70/70 checks, 13 downloads, 0 errors** |

All rails ran against isolated `bun scripts/web-server.ts` services on free loopback ports with
their own review/cache dirs; one service per rail, each stopped after its run.

### RYA-493 host/guest export journey (guest words-primary + RYA-435 gate)

`.lab-rya493/run-journey.py` PASS, `QA493_RESULTS {"pass":true,"failures":[],"downloadCount":11}`.
Evidence `.lab-rya493/runs/20260914T111229Z/`:

- Guest export sheet primary = **"Download the words"**, detail/copy
  "This shared copy can preview but not render without the original recording. Download the
  words and chapters now." — the accepted `3b8fd2b` behavior (previously the guest got a dead
  "Relink original media" prompt).
- Guest "Download the words" wrote **five** files (`rya493.srt/.vtt/.md/.txt/.chapters.txt`).
- Host toolbar Export opened the sheet, emitted **zero** downloads; the exported
  `shared-edit-draft.speechedit.json` control is rejected by the RYA-435 gate with all three
  expected reasons (`export sheet did not open`, `downloaded a .speechedit.json project file`,
  false toast). No silent loss.

### RYA-490 export acceptance

Run against the integrated web root (`src/renderer/dist` of this candidate):

- Run `20260914T111335Z`: **PASS — 70/70 checks, 0 failures, 13 downloads, 0 network errors.**
- Run `20260914T111421Z`: **PASS — 70/70 checks, 0 failures, 13 downloads.**
- Downloads: steps C 5, D 5, E 1, F 1, H 1 (`qa490-tone.speechedit.json`, control only).
- One earlier run (`20260914T111246Z`) hit a **transient harness flake** at step E: the
  "Transcript · Text" click produced zero `will-download` events within the 20 s budget
  (`Transcript . Text writes one .txt: []`), while steps A–D passed. No console errors, no
  network errors, no renderer crash. The same baseline dist (`index-BA79dj9M.js`) passed on a
  separate run, and two subsequent integrated runs passed 70/70, so this is a pre-existing
  timing flake in the harness download sink, **not** an integration regression. The accepted
  `3b8fd2b` change does not touch `exportSidecar`/`downloadText`; it only adds a shared-editor
  branch to the pure `exportPrimaryCopy` function.
- Fixture: `qa490-tone.wav`, 512,078 B, sha256
  `15a1f8e508f20c9c135e6f35f5003db677dab505853bd15c4e0ec4e9ed180002`.

## Behavior left unmerged

None. The only accepted source beyond the RYA-463 candidate is the RYA-497 product diff above.
No unrelated branch, product commit, or behavior change is included.

## Model / attribution transition note

- Product fix (RYA-497) implemented by **Astra** on accepted commit `3b8fd2b`; accepted by the
  GLM reviewer ([RYA-501](/RYA/issues/RYA-501)).
- This mechanical integration was performed by **Builder** (opencode_local, DeepSeek V4.1 Flash).
  No model switch, no recovery fallback, no provider change.

## Remaining limitations / next owner

- Local build only: no deployment, no ServerChirp access, no production/user-data change.
- ASR/microphone are mocked and media is synthetic; no real human two-person session was run here.
- Exact ServerChirp deployed commit/asset hash remains unconfirmed.
- **Next owner: independent GLM reviewer (Dispatcher schedules it)** — verify this exact
  candidate `999dab1` + asset hash `80c28860…` and run the campaign's full two-user journey
  (join → edit → re-record → mic-denial recovery → collaborator sync → conflict/disconnect/
  reload → undo → export), including the guest words-primary download.
