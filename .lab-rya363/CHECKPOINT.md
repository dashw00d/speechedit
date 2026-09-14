# RYA-363 Astra candidate — 2026-09-14 07:30Z slot

Product commit: `6987f21`, branch `astra/rya363-preserve-recordings`, based on accepted harness `7345baf` / product baseline `e9b6590`.

User outcome: collaborators record separate passages, save, and both takes survive on the server and peer screen without an unnecessary conflict decision. New track containers merge only with identical settings and non-overlapping clips (identical clips deduplicate). Overlaps, mismatched clip identity, track settings and deletion/edit conflicts retain the prior explicit conflict behavior.

Changed product: `src/shared/collaboration.ts`. Adjacent regression: `src/renderer/src/lib/collaboration.test.ts`.

Checks actually run:
- `bun scripts/qa365-nonoverlap-voice-merge-regression.ts`: baseline lost clips in all four acceptance checks; unchanged candidate passes all checks. Logs alongside this report.
- `bun test src/renderer/src/lib/collaboration.test.ts src/renderer/src/lib/collaborationClient.test.ts src/renderer/src/lib/replaceAudio.test.ts`: Bun matched only collaboration.test.ts, 7 tests / 55 assertions passed.
- `bun run build:web`: passed (existing bundle/annotation warnings).
- `git diff --check`: passed.
- Supplemental Electron two-context replay: exit 0. Server retains A and B; owner retains A and B; guest reports All changes saved and no conflict banner. Evidence in `auto-browser/qa365-trace.json` and screenshots. Isolated candidate service 127.0.0.1:3383 was owned by the test subprocess and terminated in finally.

Harness limitation: original QA365 browser script hard-requires a conflict banner and clicking Keep my conflicting edits. It cannot accept automatic merge. Original scripts remain unchanged. Supplemental `qa363-auto.cjs` changes only the obsolete banner/resolve step to require All changes saved and absence of conflict, retaining all original recording assertions. `auto-harness.diff` records the exact changes. Run with NODE_PATH=$PWD/node_modules and Electron, pointing at the candidate service. GLM must independently assess this difference and rerun before acceptance; this is implementer evidence, not independent acceptance. Mock microphone/ASR, real renderer/client/server. Exact ServerChirp deployed commit remains unconfirmed.

Next: GLM Reviewer independently validates exact candidate, both save orders and adjacent overlap/deletion controls. Dispatcher owns routing and any repair queue, integration with accepted fixes, then full two-user session. No production deployment or real user data changed.
