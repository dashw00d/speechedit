# RYA-429 — Astra implementation, 2026-09-14 08:30 UTC slot

Product commit: `fd212bd`, based on `e9b6590`; branch `astra/rya429-owner-shared-edit-polling`.
Workspace: `/home/ryan/.paperclip/workspaces/speechedit/astra-rya429`.
Implementer: Studio Lead / Astra, scheduled RYA-451 (no additional invocation).

Owner now sees collaborator updates within a three-second polling interval, outside Share, with the existing “Bring shared edits into this project” command. It explicitly explains that local edits stay on this device. Polling only reads the room; it does not attach the guest client that loads/replaces projects and autosaves. Both owner surfaces call the extracted, undoable merge command. Overlap errors remain visible across polls. Link changes and project changes unsubscribe/abort the old polling. The command checks project identity across asynchronous reads/downloads and prevents concurrent imports for one room. Original media and review decisions are preserved.

## Verification actually run

- `node node_modules/vite/bin/vite.js build --config vite.web.config.ts`: PASS (existing large-chunk warning).
- `node node_modules/typescript/bin/tsc -p tsconfig.web.json --noEmit`: PASS.
- `/home/ryan/.nvm/versions/node/v25.9.0/bin/bun test src/renderer/src/lib/collaboration.test.ts`: 6 PASS, 43 assertions.
- `git diff --check`: PASS.
- Unchanged accepted QA437 browser harness: PASS on initial candidate, notice at 2511 ms; no notice before guest edits, guest-to-guest control passes.
- Fresh archive/build of pre-fix `e9b6590`: same unchanged harness FAIL (expected exit 2), 45,171 ms, zero owner polls, no notice, owner Welcome vs server RemoteWelcome; guest-to-guest control PASS. See `baseline/qa437-trace.json`.
- Final product browser controls: PASS, notice at 2510 ms, local word correction survives explicit import, Ctrl+Z restores pre-import local project, timeline remains visible (280 px, bottom 901 / viewport 971), guest-to-guest synchronization passes, overlapping corrections retain local text and visible conflict after another poll. See `final-controls/qa437-trace.json` and screenshots.

Reproduce candidate: `QA_SCRIPT=qa429-controls.cjs QA_OUTPUT=review python3 .lab-rya429/run-browser.py` after web build. `qa437.cjs` is the unchanged accepted regression; `qa429-controls.cjs` adds adjacent checks. Runner allocates a free loopback port, disposable room/profile/cache, and terminates only its own service in finally. Set QA_WEB_ROOT to a separately built baseline web root for the before case. Dependencies reuse the local node_modules symlink; bun uses an absolute path because this runtime PATH omitted it. Electron emits GPU/NSS warnings but all journeys completed. No service remains running from these tests.

## Independent review and limitations

GLM Reviewer must independently rerun the original host/guest journey on this exact candidate, verify explicit import, Undo, conflict, link revoke/project switch and reload/recovery; test the layout on a narrow screen. These latter cases were reviewed in code but not all automated here. Do not self-approve or treat helper-driven Electron with mocked ASR/synthetic audio as human usability or real microphone testing.

This clone is a standalone baseline-derived candidate, not the integrated release. Dispatcher must integrate the accepted branches together and repeat the complete two-user workflow, including denied-mic and RYA-433 checks. Exact ServerChirp deployed commit remains unconfirmed. No deployment or production/user-data change occurred.
