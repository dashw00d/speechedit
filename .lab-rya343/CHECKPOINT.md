# RYA-343 Astra checkpoint — 2026-09-14 08:00Z slot RYA-443

Isolated workspace: /home/ryan/.paperclip/workspaces/speechedit/astra-rya343
Branch: astra/rya343-caption-merge. Baseline fd53ccc (product e9b6590).

Implemented linear-time, whitespace-preserving merge of separate changed word spans in caption clips. Overlapping/touching spans, whole-caption deletion vs edits and non-caption text remain explicit conflicts. A side with multiple separated changes is conservatively represented by one span; no general text-edit inference is claimed.

Verified regression before implementation: two new tests fail on caption text conflict paths. After implementation: bun test src/renderer/src/lib/collaboration.test.ts passes 8 tests / 56 assertions. bun run build:web passes (existing bundle warnings). git diff --check passes.

Browser replay uses original bh332/scen2.cjs A/B UI actions with B changed from observational to assertions; unrelated revoke scenario removed. Initial run could not launch because xvfb-run is absent; runner now uses the existing display. First browser run failed with Failed to fetch / subsequent save timeout; diagnostic rerun underway. No browser PASS claimed yet. Disposable service/profile only, synthetic media and mocked ASR; real production data untouched.

GLM must independently reproduce baseline failure and replay candidate in both save orders, checking both transcript and caption values, save state, overlap/deletion controls. No approval/deployment is implied. Exact evidence will be appended before native review handoff.

## Final implementation handoff

Product commit: f70e98b. Diagnostic browser rerun exited 0; service was still alive before runner-owned cleanup. A: different cues merged on both clients/server. B: stale peer corrected another word in the same cue; both clients and server retain SameCueA + SameCueB, peer reaches All changes saved · v5, no conflict. Screenshot confirms both corrections in transcript and preview. Evidence: browser/qa332b-trace.json and browser/same-caption-peer.png. First fetch failure was transient/unexplained; do not conceal it or claim repeated-run stability.

Run: python .lab-rya343/run-browser.py (existing display; isolated dynamically allocated loopback port, disposable review directory, scratch browser profile). Dependencies symlink to installed node_modules, used read-only. Original baseline browser evidence remains /home/ryan/dev/speechedit-qa331-main/.lab-rya331/bh332/run2/qa332b-trace.json; original driver scen2.cjs untouched. New test fixture explicitly generates captions, matching the reported failure. No production or shared checkout writes.

Independent review remains required, including baseline-failing browser replay and reverse save order. Accepted fixes RYA-334/342/352/363 are not integrated into this branch. Dispatcher owns integration and any concrete repair returned to the scheduled queue.
