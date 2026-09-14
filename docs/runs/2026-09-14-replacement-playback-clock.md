# Replacement playback follows the recording

Ryan reported that a re-record preview sounds clean but timeline playback cuts in and out. This follows the separate cut-boundary repair in `05c8cfc`, which did not resolve his report.

## Reproduction and change

The timeline used primary-video currentTime as the clock even when a replacement recording supplied all audible speech. Repeated picture stalls froze program time while the recording continued. The next sync sought the recording backwards to the picture. A real-speech Chromium capture reproduced 26 backward audio seeks in a 4.56-second replacement; the 25-second program took 28.885 seconds.

An active replacement now supplies program time. A seeking/buffering replacement holds its position; an exhausted short recording advances through its silent slot using wall time. Audio time is capped at the slot boundary, never moves the playhead backwards, and yields to explicit user seeks and loops. Picture cuts, source changes, and decoder catch-up no longer force tight seeks on continuous audio beds. Ordinary source playback retains the existing clock and cut handling.

Both playback harnesses mute their OS audio output. The EOF harness uses synthetic constant PCM, which can audibly click at its edges; it is a state-machine regression check, not a listening-quality test. Real-speech tests capture Chromium's audio graph before the muted output.

## Encoding and waveform evidence

A 4.56-second, mono 48 kHz speech WAV was submitted to the live stateless `/api/recordings` encoder. The returned MP3 decoded to exactly 218,880 samples, the same as the input. Overall source/decoded correlation: 0.999885; minimum voiced 100 ms window correlation: 0.991563. No missing speech windows were detected. The test did not alter any room.

That exact returned MP3 was then played through the repaired Monitor and Timeline with seven simulated 300 ms picture stalls. It played once with zero audio seeks. Captured duration was 25.109 seconds for a 25-second program. After accounting for the 1,024-sample capture startup offset, speech waveform correlation against the decoded MP3 was 0.999999994, with a minimum voiced-window correlation of 0.999981 and minimum RMS ratio of 0.999919. The replacement remained continuous while the muted picture caught up.

These measurements isolate the demonstrated playback problem and check this recording's production encode. They do not establish every recording's perceptual quality or reproduce Ryan/Zane's exact private session, which has not been supplied.

## Validation

- 775 library tests passed across 103 files; typecheck and web production build passed.
- Added replacement clock checks for video stalls/cuts, waiting audio, short silent tails, monotonic time, slot boundaries, and deliberate seeks.
- Portable Chromium recording regression fails against pre-fix `05c8cfc`: 13 picture stalls caused 13 audio seeks. It passes after the change with zero audio seeks, including short/full recordings, sequential owner/collaborator replacement, EOF silence, and intentional replay.
- Real-speech picture-stall capture and encoding comparisons as described above. Eleven-cut replacement playback and the prior spoken-cut/UI-stall regression both pass with no backward seeks and correct timeline following (`replacement-cuts-regression.log`).

Private audio and detailed logs remain under `/home/ryan/.paperclip/workspaces/speechedit/playback-popping-20260914/`: `replacement-buffer-before.log`, `replacement-buffer-before.wav`, `replacement-regression-before.log`, `replacement-regression.log`, `production-encoding-comparison.json`, `replacement-production-timeline.log`, `replacement-production-timeline.wav`, and `replacement-timeline-waveform.json`. Baseline worktree: `before-replacement/` at `05c8cfc`.
