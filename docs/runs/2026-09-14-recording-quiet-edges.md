# Place replacement edges using nearby audio pauses

Ryan reported leftover original voice at both ends of a re-recording and asked to compare transcript timestamps with the audio/silence. Re-recording previously used the transcript bounds exactly.

## Behavior

New re-recordings check the audio around both selected edges before showing Start recording. The adjusted source range determines both the captured duration and the final replacement/proposal range. A short notice explains how much was added. The same preparation is used in the main/shared editor and the review recording sheet.

Existing replacement clips offer **Clean up recording edges** in their timeline context menu. This checks the surrounding original audio, then composes ordinary `setRangeVolume` edits to mute the extra original voice. The take's start, duration, and media stay intact; both edges form one Undo step. Already muted edges are not edited again. A changed project or locked voice track stops cleanup.

The generic quiet-range primitive combines transcript neighbours, existing silence intervals, cuts/protected ranges, source bounds, and sharing scope. It only expands outward, by at most 0.75 source seconds per edge. It never invents a pause when the evidence is missing. These are conservative acoustic boundaries, not forced phoneme alignment or a guarantee for every recording.

## Resource use and media handling

A dedicated worker reads at most two short audio windows on demand. It measures 10 ms RMS bins across channels and requires sustained quiet; missing decoder samples and brief zero crossings are not treated as silence. Workers are terminated after completion/cancellation or an eight-second timeout. The work does not run on every playback frame. Coarse full-file display waveforms are not used to guess precise boundaries.

Review audio representations use their source offsets, and analysis/edits stay inside the shared scope. Unsupported/unavailable audio leaves the selected word boundaries available. Captures remain within the existing 0.1–120 second slot limit.

## Verification

- 779 library tests passed across 104 files; the final five targeted edge tests also pass, including an additional source-join regression. Typecheck and the web production build passed.
- Tests cover transcript neighbours/overlaps, cut/scope bounds, missing samples, brief zero crossings, exact mute windows, unchanged take/timeline duration, idempotent cleanup, track locks, and one-step Undo.
- `bun run smoke:recording-edges` uses actual Chromium workers and decoded WAV/Opus audio with deliberately late/early transcript boundaries. WAV adjusted 2–4 seconds to 1.47–4.53; Opus to 1.47–4.54 (10 ms measurement bins).
- The real recording sheet captured and submitted the adjusted 3.06-second slot, using a synthetic microphone. Shared scope stayed intact, progressive chunk offsets matched, active and pre-start cancellation worked, and existing-take cleanup/Undo passed.
- Test windows are muted; generated audio fixtures are temporary. Detailed logs are under `/home/ryan/.paperclip/workspaces/speechedit/playback-popping-20260914/edges-*`.

Ryan's actual private passage has not been supplied or modified; the new context action lets him apply the measured cleanup to that take.
