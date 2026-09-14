# RYA-340 selected-sentence Re-record regression lab

Isolated, disposable lab for the selected-sentence **Re-record** regression that
supports the [RYA-334](/RYA/issues/RYA-334) queue gate. Baseline candidate is the
deployment-approximate `origin/main` @ `e9b6590`.

This lab only prepares fixtures/harness/regression evidence. It does not contain or
implement the product fix; that belongs to Astra.

## Environment

| Item | Value |
| --- | --- |
| Worktree | `/home/ryan/dev/speechedit-qa336-builder` (branch `qa336/rerecord-regression-harness`) |
| Baseline commit | `e9b65904dfe71f9d28a901fc16db6f0d509e46ec` |
| Built web app | `src/renderer/dist/assets/index-Bg71JEhD.js` (965,457 B, sha256 `ad92bc7d…6322e`) |
| CSS (identity cross-check) | `index-CreKLqQ_.css` sha256 `aeb9644c…f1216c` — matches the RYA-331 baseline |
| Service port | **3364** (see deviation below), own review dir `.lab-rya336/reviews`, own whisper cache `.lab-rya336/whisper` |
| Harness | `scripts/qa336-sentence-rerecord.cjs` |

**Port deviation.** RYA-340 requested `3363`, but by the time this run started
`3363` was already held by the RYA-333 Bug Hunter service (`/home/ryan/dev/speechedit-qa331-main/.lab-rya331/bh333`).
Ports `3361`/`3362` were also live. To avoid sharing a port or mutable fixture this
lab uses `3364`. Nothing on 3361/3362/3363 was touched.

## Run

```sh
# 1. isolated service (its own review dir + whisper cache)
/home/ryan/dev/speechedit-qa336-builder/.lab-rya336/start-service.sh 3364 \
  /home/ryan/dev/speechedit-qa336-builder/.lab-rya336 &
curl -s http://127.0.0.1:3364/healthz          # {"ok":true}

# 2. two-context browser regression suite
/home/ryan/dev/speechedit-qa336-builder/.lab-rya336/run-suite.sh \
  http://127.0.0.1:3364 \
  /home/ryan/dev/speechedit-qa336-builder/.lab-rya336/runs/<name>
# exit 0 = pass, 2 = acceptance check failed, 1 = harness error/timeout
```

Requirements: PATH must include `/home/ryan/.nvm/versions/node/v25.9.0/bin`
(`bun` + `node`); Electron runs hidden under Xwayland (`DISPLAY=:0`,
`XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.*`, `--no-sandbox`). The wrapper
resolves these automatically. `ffmpeg` must be on PATH (synthetic fixture + the
server's recording encoder).

## Re-run unchanged against Astra's integrated candidate

Point the suite at a service built from the candidate's `src/renderer/dist` on a
free port; the harness itself is unchanged:

```sh
# e.g. in Astra's isolated candidate worktree
HOST=127.0.0.1 PORT=3374 SPEECHEDIT_REVIEW_DIR=<dir>/reviews \
  SPEECHEDIT_WEB_ROOT=<candidate>/src/renderer/dist \
  SPEECHEDIT_CACHE_DIR=<dir>/whisper bun scripts/web-server.ts &
/home/ryan/dev/speechedit-qa336-builder/.lab-rya336/run-suite.sh \
  http://127.0.0.1:3374 /home/ryan/dev/speechedit-qa336-builder/.lab-rya336/runs/<candidate>
```

The candidate passes only when every check is `true` (exit 0). The checks that are
`skipped` at baseline (`menuOpensRecordSheet`, `menuReplacesCorrectRange`,
`menuUndoRestores`, `keyboardActivatesReRecord`) execute once the context-menu
Re-record item exists.

## What the suite checks (RYA-334 acceptance)

Two independent Electron contexts — host/owner editor and guest via a full edit link.

1. `contextMenuHasReRecord` — with a sentence selected, the right-click (context)
   menu exposes the existing Re-record action.
2. `keyboardMenuHasReRecord` + `keyboardActivatesReRecord` — the menu opens from a
   focused word with the keyboard (Shift+F10) and the item is keyboard-activatable.
3. `menuOpensRecordSheet`, `menuReplacesCorrectRange` — invoking the menu action
   opens the record sheet for the selected words and replaces exactly that range.
4. `menuUndoRestores` — Undo restores the sentence.
5. `menuCancelLeavesIntact`, `menuMicDeniedLeavesIntact` — cancel and
   microphone-denied leave the sentence intact.
6. `panelOpensRecordSheet`, `panelReplacesCorrectRange`, `panelUndoRestores`,
   `panelCancelLeavesIntact`, `panelMicDeniedLeavesIntact` — the existing upper
   action-panel Re-record still works.
7. `guestReplacesSentence`, `guestSavedToSharedProject`,
   `hostObservesReplacementAfterSync`, `otherClientObservesReplacementAfterSync` —
   the guest re-records, saves, and the host (pull) plus a second client observe it.

Mocks are deterministic: a Whisper worker stub returns two fixed sentences; the
AudioWorklet recording chain is stubbed to emit exact-length PCM, so the real
`replaceRangeAudio` command, the review server, and client sync all run for real.
The fixture is a synthetic 10 s `testsrc2` + sine webm.

## Files

- `scripts/qa336-sentence-rerecord.cjs` — the harness.
- `.lab-rya336/start-service.sh` — isolated service launcher.
- `.lab-rya336/run-suite.sh` — env-correct runner.
- `.lab-rya336/BASELINE-FAILURE.md` — baseline failure proof and exact assertions.
- `.lab-rya336/runs/` — per-run trace + screenshots (evidence; not committed).

## Limitations

- Baseline `e9b6590` is deployment-approximate, not the confirmed deployed commit
  (see `/home/ryan/dev/speechedit-qa331-main/.lab-rya331/BASELINE.md`).
- The ASR/recording layer is mocked (no real microphone, no WAN, no real Whisper).
- The suite uses the editor's own "Select sentence" menu action to select the
  sentence: a literal same-coordinate double-click misses the word because the
  selection panel shifts the layout after the first click.
- The gated menu checks were not executed against a fixed candidate here (this
  task must not implement the fix). They share the exact replacement/undo/sync
  path proven by the passing panel checks; only the menu item's wiring differs.

## Cleanup

- Stop the service: `kill $(cat .lab-rya336/service.pid)` or `ss -ltnp | grep :3364`.
- Remove the worktree: `git -C /home/ryan/dev/speechedit worktree remove --force /home/ryan/dev/speechedit-qa336-builder`.
