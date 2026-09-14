# Progressive sharing rebase validation — 2026-09-14

Rebased `feature/progressive-passage-sharing` onto `origin/main` at `1a19173`.
The feature commit is now `bb91757`. Git skipped the playback/playhead commit
because its equivalent was already on main. The original branch is preserved as
`backup/progressive-sharing-before-rebase-20260914`.

The two conflicts were imports in `ShareSheet.tsx` and adjacent additions to
`styles.css`. Resolution keeps main's `bringSharedEdits` implementation and
editor-shell layout alongside the progressive sharing imports and player styles.
`git range-diff` confirms these are the only feature-patch adaptations.

## Checks

- `bun test`: **770 pass, 0 fail**, 103 files, 5,739 assertions.
- `bun run typecheck`, `bun run lint:theme`, web build, desktop build: **pass**.
- Docker's server bundling command: **pass**, 107 modules. The resulting bundle
  served health (200), created a disposable review (201), and revoked it (200).
- Production browser checks: keyboard selection/actions/Delete/Undo; incorrect-key
  rejection and recovery; host/guest export (11 downloads); collaboration merging
  and conflicts; concurrent cut/re-record; sentence re-record; owner notification;
  preservation of both non-overlapping replacement recordings: **pass**.
- Owner workspace syncing: **pass**, including host and guest edits, Undo of the
  host correction and imported guest edit, pending remote edits, offline recovery,
  stale host tabs, conflicts, and reopening the workspace/editing link.

## Test harness corrections and baseline comparison

The owner-sync harness originally called `blur()` and then dispatched another
`focusout` while React's input was still connected. This committed each correction
twice and added duplicate Undo entries. Both untouched main and the rebased branch
failed the same two Undo assertions. A toolbar-Undo diagnostic reproduced them,
so the keyboard shortcut was not the cause. Removing the duplicate event makes
both the branch's and main's owner-sync checks pass. The committed harness now
uses one real blur; product Undo code is unchanged. The first corrected baseline
attempt hit a stale-tab assertion and an Electron `ERR_FAILED` navigation; a
separate retry passed all scenarios. Both attempts are retained in the evidence.

Two older harnesses retain their documented failures from main's integration
checkpoint: `qa336` has keyboard-activation and mic-denial simulation defects;
`qa365` expects a conflict that main intentionally resolves automatically. The
existing corrected `qa334` (15/15 checks) and `qa363-auto` harnesses both pass.

## Real-speech progressive sharing

Recreated a private 25-second fixture from the local Staff Training recording and
transcribed it with the real production browser Whisper worker (62 word cues).
Ran the unchanged `scripts/progressive-review-smoke.cjs` with a Vite sender and a
separate production-build recipient, both using disposable review storage.

Verified:

- A 5–17 second passage publishes and plays before upload completion. Media and
  transcript stay within the authorized interval, without the full waveform.
- Three audio sections schedule exactly 12 seconds of source audio without
  overlap. Delayed uploads produce a silent wait, then playback reaches the end.
- Cancel/resume retains uploaded representations and feedback, reusing cached
  work. On-demand motion/detail video plays with review audio paused.
- The actual Share dialog scopes selected words to 5.06–15.92 seconds and finishes
  the requested offline-video upload before reporting completion.
- The production recipient does not download the editor bundle. Local first
  audio/image readiness was 706 ms; the passage used 59,360 bytes for audio/stills.
  These are localhost observations, not internet/mobile performance promises.

Initial development runs were invalidated by Vite dependency re-optimization and
a reload during the first upload. The interrupted Bun-hosted Vite service retained
upload/storage locks, blocking subsequent attempts. Stopping the disposable
services, clearing only their test rooms, and using Node-hosted Vite with the
Whisper dependency pre-optimized produced the passing run. The recipient still
used the production Bun web server. Abrupt process/navigation interruption is not
fully qualified by this test; explicit cancellation and resume are covered.

## Evidence and limits

Logs, harness variants, private media, screenshots, and the main baseline worktree
are under `/home/ryan/.paperclip/workspaces/speechedit/progressive-sharing-rebase-20260914`.
The passing progressive result is `evidence/progressive-clean.log`; final owner
results are in `evidence/final-owner-rails/rya479/`; the passing main comparison is
`evidence/baseline-owner-fixed-retry/rya479/`. Earlier failures are retained.

This provides reasonable confidence that the rebase preserves main's tested
editing/collaboration behavior and the sharing feature works in Chromium/Electron
on Linux. Safari/Firefox, low-end mobile devices, long/VFR recordings, and real WAN
conditions remain outside this run. No deployment or remote branch update was made.
