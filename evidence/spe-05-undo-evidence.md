# SPE-05 (RYA-26) durable end-to-end undo evidence

Snapshot: branch `spe-05/first-session-polish`.

- Integrated evidence HEAD: `b43a476` ("Integrate first-edit undo repair aa1791d with SPE-05 evidence").
  - Feature repair: `aa1791d` "Keep the automatic first-edit undo reachable and add undo smokes" (parent `c8d92bf`), merged at `b43a476`.
  - RYA-96 evidence commits merged in: `9644f19`, `f824f8e`, `6f93e2c` (probes + `evidence/`); base `c8d92bf`; base of that `7da9678`.
- Build used for the local probe: `out/` (electron-vite), regenerated from `b43a476` on 2026-09-13 02:55 (`bun run build`, 3.80s, exit 0).
- Web build used for the shared smoke reuse: `src/renderer/dist/` mtime `2026-09-13T02:43:24-05:00` (served at `127.0.0.1:3311`).

Environment: Linux, X display `:0`; `ffmpeg`/`ffprobe` present; probes run with `--no-sandbox --disable-gpu` (no GPU/WebGPU), each hard-capped and never retried.

## 1. Local end-to-end keyboard Undo (built desktop app, integrated HEAD `b43a476`)

Command:

```
env -u ELECTRON_RUN_AS_NODE DISPLAY=:0 timeout 125 \
  ./node_modules/.bin/electron --no-sandbox --disable-gpu \
  desktop-undo-probe.cjs --out=$PWD/evidence
```

`desktop-undo-probe.cjs` boots the real built main process (`out/main/index.js`) so the ffmpeg-backed "looks" analysis produces the automatic first edit.

- `evidence/desktop-undo-probe.output.txt`
- `evidence/desktop-undo-probe.result.json` (`PROBE_RESULT`, exit 0)

Observed journey (re-run on the integrated build):

1. Drop a 10s WAV (tone 0-2s, silence 2-6s, tone 6-8s, silence 8-10s) -> automatic first edit, toast `Removed 2 pauses. Undo to put them back.` with real buttons `Undo` (`aria-label="Undo the last edit"`) and `Dismiss` (`aria-label="Dismiss message"`).
2. Keyboard-only: focus `Dismiss message`, `Shift+Tab` -> `document.activeElement` is `Undo the last edit`, then `Enter` through the real Electron input pipeline.
3. Toast becomes `Undid the last edit. Redo puts it back.` and the Undo chip is gone. Timeline/edit state restored: `cuts 2 -> 0`, `applied 2 -> 0`.
4. `Ctrl+Shift+Z` redoes: `cuts 0 -> 2`, `applied 2 -> 2`.

`PROBE_RESULT { "ok": true }`.

Word/chapter-level restoration is covered by the committed `smoke:first-undo` result below (this bounded desktop probe intentionally cancels real Whisper, so its heading stays `0 words · 0 chapters`).

### Word/chapter restoration (`aa1791d`, committed)

`docs/runs/first-session-undo-smoke.json` (command: `bun run smoke:first-undo`, Whisper worker stubbed to fixed cues):

- Before: `8 words · 1 chapters`, toast `Removed 3 pauses. Undo to put them back.`, buttons `Undo` (`aria-label="Undo the last edit"`) + `Dismiss`.
- Keyboard `Shift+Tab` from `Dismiss message` -> `Undo the last edit` -> `Enter`.
- After undo: `10 words · 1 chapters`, toast `Undid the last edit. Redo puts it back.`, Undo chip gone, suggest bar `Transcript ready. 3 safe edits ready.`
- Redo `Ctrl+Shift+Z`: back to `8 words · 1 chapters`.

## 2. Supported shared context (observed results)

A. Shared undo/recovery against the fix (`aa1791d`, committed) — `docs/runs/shared-undo-smoke.json` (command: `bun run smoke:shared-undo`):

- `linkHasEditPath: true`; recipient edits word 0 `Welcome` -> `SharedUndo`.
- Inline keyboard Undo (`Undo the last edit`, focused from `Dismiss message`) restores `Welcome` in the shared project, toast `Undid the last edit. Redo puts it back.`, Undo chip gone.
- Redo `Ctrl+Shift+Z` re-applies `SharedUndo`.

B. Shared edit/recovery smoke (reused, captured on the `c8d92bf` web build) — command:

```
env -u ELECTRON_RUN_AS_NODE DISPLAY=:0 \
  SPEECHEDIT_SMOKE_RUN_MS=200000 SPEECHEDIT_SMOKE_WAIT_MS=90000 timeout 210 \
  ./node_modules/.bin/electron --no-sandbox --disable-gpu \
  scripts/edit-ui-smoke.cjs http://127.0.0.1:3311
```

`evidence/shared-edit-smoke.output.txt` + `evidence/shared-edit-smoke.result.json` (exit 0):

```
{"fullEditor":true,"compression":true,"remoteSave":true,"reload":true,
 "secondEditorSync":true,"conflictRecovery":true,"newImageUpload":true,
 "isolated":true,"originalPreserved":true,"ownerPullUndo":true,"revoked":true}
```

`remoteSave`, `reload`, `secondEditorSync`, `conflictRecovery` and `ownerPullUndo` are the observed shared recovery/undo results.

## 3. Criterion-by-criterion map (RYA-26 acceptance criteria)

| Criterion | Evidence |
| --- | --- |
| 1. Use current editor evidence to remove the highest-friction step | `c8d92bf` adds the inline Undo chip (`src/renderer/src/lib/toastActions.ts` `toastOffersUndo`/`TOAST_UNDONE`; `App.tsx` wiring to `useEditor.getState().undo()`). `aa1791d` keeps that chip reachable for the automatic first edit by merging the import/caption/leftover toast and carrying `session.lastEdit`. Probe #1 observes the chip on the automatic first edit and its one-`Enter` activation on `b43a476`. |
| 2. Preserve visible TRANSCRIBE retry, CPU fallback and automatic missing-chapter detection | `bun test src/renderer/src/lib` on `b43a476` -> **730 pass / 0 fail**, 5449 expect() calls, 96 files, 20.92s; `bun run typecheck` exit 0. `c8d92bf`/`aa1791d` touch none of the transcription/retry/chapter paths (`browserWhisper.test.ts`, `transcriptionCompletion.test.ts`). |
| 3a. Keyboard / older-user usability | Probe #1 (`b43a476`): `Dismiss message` focused -> `Shift+Tab` -> `activeElement === "Undo the last edit"` -> `Enter`; chip is a focusable `<button>` beside `Dismiss`. |
| 3b. Recovery | Preserved retry/CPU-fallback tests above; shared B `conflictRecovery:true`, `reload:true`, `secondEditorSync:true`. |
| 3c. Undo in local + supported shared contexts | Local timeline: probe #1 `cuts 2->0`, `applied 2->0`, toast names redo, `Ctrl+Shift+Z` restores `cuts 0->2`. Local word/chapter: `docs/runs/first-session-undo-smoke.json` `8 -> 10 -> 8 words`, chapter preserved. Shared: `docs/runs/shared-undo-smoke.json` (`Welcome` restored then redone) and shared B `ownerPullUndo:true`, `remoteSave:true`. |

## Reconciliation

Two Builder runs shared this checkout without isolated workspaces (recorded by Dispatcher 2026-09-13T07:50Z). The RYA-26 run produced the feature repair `aa1791d`; the RYA-96 run produced the `desktop-undo-probe.cjs` / `review-undo-probe.cjs` / `reviewer-gpu-fallback-probe.cjs` / `evidence/` artifacts. Because the branch can only have one tip, `aa1791d` was preserved off-branch at tag `spe-05-builder-aa1791d`. `b43a476` is a no-fast-forward merge that re-unifies both lineages: the branch now contains the feature repair, its `docs/runs` smoke results, and the RYA-96 evidence. `aa1791d` remains reachable as an ancestor of `b43a476` and via the tag for independent verification. Nothing was deleted; the working tree is clean.
