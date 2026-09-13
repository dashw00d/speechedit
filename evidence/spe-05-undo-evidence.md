# SPE-05 (RYA-26) durable end-to-end undo evidence

Snapshot: branch `spe-05/first-session-polish`.
- Feature commit under review: `c8d92bf` (base `7da9678`).
- Committed build used for the local probe: `out/` (electron-vite) mtime `2026-09-13T02:38:39-05:00`.
- Committed web build used for the shared probe: `src/renderer/dist/` mtime `2026-09-13T02:43:24-05:00`.
- Current branch HEAD at evidence-write time: `aa1791d` (a concurrent, uncoordinated writer landed a first-edit toast-merge fix and its own `docs/runs` web smokes while this probe was running; see "Concurrency" below). `aa1791d` does not alter the local undo wiring probed here.

Environment: Linux, X display `:0`; `ffmpeg`/`ffprobe` present; probes run with `--no-sandbox --disable-gpu` (no GPU/WebGPU), each hard-capped and never retried.

## 1. Local end-to-end keyboard Undo (built desktop app)

Command:

```
env -u ELECTRON_RUN_AS_NODE DISPLAY=:0 timeout 125 \
  ./node_modules/.bin/electron --no-sandbox --disable-gpu \
  desktop-undo-probe.cjs --out=$PWD/evidence
```

`desktop-undo-probe.cjs` boots the real built main process (`out/main/index.js`) so the ffmpeg-backed "looks" analysis produces the automatic first edit; the earlier revision loaded only the renderer and therefore never reached app-ready (recorded in the RYA-26 review). Full stdout + JSON result:

- `evidence/desktop-undo-probe.output.txt`
- `evidence/desktop-undo-probe.result.json` (`PROBE_RESULT`, exit 0)

Observed journey:

1. Drop a 10s WAV (tone 0-2s, silence 2-6s, tone 6-8s, silence 8-10s) -> automatic first edit, toast `Removed 2 pauses. Undo to put them back.` with real buttons `Undo` (`aria-label="Undo the last edit"`) and `Dismiss` (`aria-label="Dismiss message"`).
2. Keyboard-only: focus `Dismiss message`, `Shift+Tab` -> `document.activeElement` is `Undo the last edit`, then `Enter` through the real Electron input pipeline.
3. Toast becomes `Undid the last edit. Redo puts it back.` and the Undo chip is gone. Timeline/edit state restored: `cuts 2 -> 0`, `applied 2 -> 0`.
4. `Ctrl+Shift+Z` redoes: `cuts 0 -> 2`, `applied 2 -> 2`.

`PROBE_RESULT { "ok": true }`.

Note: the probe intentionally does not await real Whisper (bounded), so the transcript shows `0 words · 0 chapters`; the restored state here is the automatic pause edit's timeline state (`cuts`/`applied`). Word/chapter-level restoration is covered by the shared observation and by the concurrent `smoke:first-undo` result in `docs/runs`.

## 2. Supported shared context (observed result)

Command (reuses the already-running local web server on `127.0.0.1:3311`, which serves the `c8d92bf` web build at `src/renderer/dist`, so no new long-lived server is started):

```
env -u ELECTRON_RUN_AS_NODE DISPLAY=:0 \
  SPEECHEDIT_SMOKE_RUN_MS=200000 SPEECHEDIT_SMOKE_WAIT_MS=90000 timeout 210 \
  ./node_modules/.bin/electron --no-sandbox --disable-gpu \
  scripts/edit-ui-smoke.cjs http://127.0.0.1:3311
```

Full stdout: `evidence/shared-edit-smoke.output.txt`; extracted result: `evidence/shared-edit-smoke.result.json`.

Observed (exit 0):

```
Share creation wait { seconds: 0.23, video: false }
Compressed preview { bytes: 64135, duration: '10.000000', fps: undefined, codec: 'opus' }
{"fullEditor":true,"compression":true,"remoteSave":true,"reload":true,
 "secondEditorSync":true,"conflictRecovery":true,"newImageUpload":true,
 "isolated":true,"originalPreserved":true,"ownerPullUndo":true,"revoked":true}
```

`remoteSave`, `reload`, `secondEditorSync`, `conflictRecovery` and `ownerPullUndo` (owner pulls shared edits, then Undo restores the pre-pull transcript) are the observed shared recovery/undo results.

## 3. Criterion-by-criterion map (RYA-26 acceptance criteria)

| Criterion | Evidence |
| --- | --- |
| 1. Use current editor evidence to remove the highest-friction step | `c8d92bf` adds the inline Undo chip: `src/renderer/src/lib/toastActions.ts` (`toastOffersUndo`, `TOAST_UNDONE`) + `src/renderer/src/App.tsx` wiring to the pre-existing `useEditor.getState().undo()`. Probe #1 observes the chip on the automatic first edit and its one-`Enter` activation. The concurrent `aa1791d` keeps the same chip reachable after merging the import toast. |
| 2. Preserve visible TRANSCRIBE retry, CPU fallback and automatic missing-chapter detection | `bun test src/renderer/src/lib` -> **730 pass / 0 fail**, 5449 expect() calls, 96 files, 22.80s (HEAD `aa1791d`); `bun run typecheck` clean. `c8d92bf` touches none of the transcription/retry/chapter paths (`browserWhisper.test.ts`, `transcriptionCompletion.test.ts`). |
| 3a. Keyboard / older-user usability | Probe #1: `Dismiss message` focused -> `Shift+Tab` -> `activeElement === "Undo the last edit"` -> `Enter` through the real input pipeline; chip is a focusable `<button>` beside `Dismiss`. |
| 3b. Recovery | Preserved retry/CPU-fallback tests above; shared smoke #2 `conflictRecovery:true`, `reload:true`, `secondEditorSync:true`. |
| 3c. Undo in local + supported shared contexts | Local: probe #1 `cuts 2->0`, `applied 2->0`, toast names redo, `Ctrl+Shift+Z` restores `cuts 0->2`. Shared: smoke #2 `ownerPullUndo:true` (owner Undo restores the pre-pull transcript), `remoteSave:true`. |

## Concurrency

During this heartbeat a second, uncoordinated writer modified and committed product source on this same branch (`aa1791d`, 02:49:10Z): a `firstEdit.ts`/`fileActions.ts` toast-merge fix, `package.json` smoke scripts, and web smokes with results under `docs/runs/`. Those changes were preserved untouched; this evidence commit adds only the two Dispatcher-exempted probes plus `evidence/`. Flagged for the Dispatcher because RYA-96 required a single writer and no new product scope.
