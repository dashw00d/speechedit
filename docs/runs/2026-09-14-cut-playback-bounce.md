# Backward playback at cuts under UI load

After merging progressive sharing into main (`8a2fa25`), reproduced an editor
playback defect using the private Staff Training fixture, an 8 fps VP8/Opus
preview, eleven 200 ms cuts, and a 300 ms UI stall during spoken audio.

The media clock advanced into a deleted interval while the last displayed
program frame remained before the cut. `stepProgramPlayback` advanced that old
frame by the capped 80 ms wall step, producing a source target behind the decoder.
The resulting seek replayed earlier picture/audio rather than reaching the cut.

Before: source `6.101334 → 5.797400` (304 ms backward). The captured output's
waveform independently matched source audio progressing to 5.983 s and then
returning to 5.7885 s, confirming actual repeated audio rather than only a timing
log. The reference was decoded directly from the same preview file.

The fix finishes the current retained segment when the decoder has reached the
following deleted interval. It seeks to the exact next boundary, preserving the
first samples after the cut and any inserted pause. It continues to hold that
target during the asynchronous seek; deliberate jumps and different-source
handling retain their existing behavior.

After: source `6.109333 → 6.200000`, with no backward seeks or backward waveform
matches. Playback reached the 22.8-second edited end. Captured elapsed output was
22.944 seconds; this does not claim sample-perfect splice timing or eliminate
all possible clicks. The user's exact shared session has not yet been supplied,
so this establishes one app defect and repair, not complete perceptual acceptance.

Validation:

- New unit regression failed before the fix and passed after it.
- 772 tests pass, 0 fail; TypeScript and web build pass.
- Normal and periodic-load cut playback pass, with eleven forward seeks landing
  exactly at cut ends and no backwards seeks.
- A deterministic stall across a spoken cut fails on pre-fix main and passes on
  the repair. Captured source/output waveform correlation confirms repetition
  before and its absence after at that boundary.
- Tests cover keeping an inserted pause and holding the target while seeking.

The committed real-speech harness now supports `SPEECHEDIT_CUTS=1`, which adds
the cuts and makes the loaded case stall across the spoken six-second cut:

```sh
SPEECHEDIT_CUTS=1 SPEECHEDIT_CASES=shared,loaded \
SPEECHEDIT_SPEECH_CORPUS=/path/to/private/corpus \
bun run smoke:real-speech -- --no-sandbox
```

Private captures, logs, the isolated before/after harness, and correlation data
are under `/home/ryan/.paperclip/workspaces/speechedit/playback-popping-20260914`.
No private recording or transcript is committed.

Deployment note: main is push-to-deploy. The encoding merge deployed as
`cmu1ffkm800k00ubxa8hior88`; its regenerated Nginx microphone policy was restored
to `microphone=(self)` and verified over HTTPS. Future pushes must preserve that
exception and verify the deployed repair; a Git push is not merely a local merge.
