# RYA-340 baseline failure proof — selected-sentence context-menu Re-record

Baseline candidate: `origin/main` @ `e9b65904dfe71f9d28a901fc16db6f0d509e46ec`
(deployment-approximate; see `/home/ryan/dev/speechedit-qa331-main/.lab-rya331/BASELINE.md`).
Built web app under test: `/assets/index-Bg71JEhD.js` (sha256 `ad92bc7d…6322e`).

## Exact command

```sh
cd /home/ryan/dev/speechedit-qa336-builder
./.lab-rya336/run-suite.sh http://127.0.0.1:3364 "$PWD/.lab-rya336/runs/baseline-final"
# exit=2 (at least one acceptance check failed)
```

Service: `.lab-rya336/start-service.sh 3364 .lab-rya336` (own review dir + whisper
cache), healthz `{"ok":true}`.

## Result: FAIL (exit 2)

`pass:false`. Failing assertions, verbatim from `runs/baseline-final/qa336-trace.json`:

1. ```
   FAIL: selected-sentence right-click menu is missing the "Re-record audio" item.
   Actual items: ["Remove paragraph","Make shorter","Add zoom","Protect","Edit text…",
                  "Copy quote","Select sentence","Select paragraph","Go here"]
   ```
   Check `contextMenuHasReRecord: false`. This is the primary RYA-334 defect.
2. ```
   FAIL: keyboard-opened context menu is missing the "Re-record audio" item.
   Actual items: ["Remove paragraph","Make shorter","Add zoom","Protect","Edit text…",
                  "Copy quote","Select sentence","Select paragraph","Go here"]
   ```
   Check `keyboardMenuHasReRecord: false`. The word context menu opens from a
   focused word with Shift+F10 (recorded as `keyboardOpensContextMenu.via =
   "sendInputEvent Shift+F10"`), and it also lacks Re-record.

Selected sentence used for both assertions:
`"Welcome to this recording."` (4 words, source range `0.000–2.000 s`).

## Everything else passes at baseline

The shared re-record/sync machinery is intact; only the menu exposure is missing:

| Check | Result |
| --- | --- |
| `panelOpensRecordSheet` | true |
| `panelReplacesCorrectRange` | true (clip `0.000–2.000 s`, duration `2.000 s`) |
| `panelUndoRestores` | true |
| `panelCancelLeavesIntact` | true |
| `panelMicDeniedLeavesIntact` | true |
| `guestReplacesSentence` | true (guest used the panel fallback) |
| `guestSavedToSharedProject` | true |
| `hostObservesReplacementAfterSync` | true |
| `otherClientObservesReplacementAfterSync` | true |

This distinguishes **"the action is missing from the selection menu"** from
**"the action is broken"**: the exact `onReRecord` → record sheet →
`replaceRangeAudio` → Undo → shared-save → sync path already works through the
upper action panel.

## Evidence

- Trace JSON: `runs/baseline-final/qa336-trace.json` (`pass:false`, failure list,
  per-check details, per-context console/network capture).
- Screenshots: `runs/baseline-final/02-owner-context-menu.png` (selected sentence +
  context menu without Re-record), `01-owner-baseline.png`,
  `04-owner-panel-done.png`, `05-owner-share-link.png`,
  `06-second-client-synced.png`, `07-host-final.png`.
- Console/network capture shows no app errors beyond the mocked-ASR/GPU notices.

## Candidate expectation

When Astra adds the existing Re-record action to the word context menu (reusing the
current command/eligibility), the same unchanged suite must report `pass:true`
(exit 0): the two failing checks pass, the four `skipped` gate checks execute, and
the panel/sync checks stay green.
