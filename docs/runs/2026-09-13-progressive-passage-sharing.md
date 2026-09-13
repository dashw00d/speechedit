# Progressive passage sharing — 2026-09-13

Branch: `feature/progressive-passage-sharing`. This branch contains the already deployed playback/track fix `82616d8`; the new sharing format is not deployed yet.

## What changes

Audit links now share independently playable mono Opus audio at 24 kbps with WebP storyboard images. Selecting transcript words scopes both media and metadata to that passage. All edit coordinates stay on the original source timeline; files themselves start at zero. Neighbouring transcript words, partial chapters, and the full-source waveform are excluded. Full editing and existing legacy review links keep their existing media format.

The sender prepares the first image and two seconds of audio, then eight-second audio sections. Images appear every ten seconds and at known scene boundaries, with existing compressed previews reused when available. A bounded 128 MiB browser cache reuses generated representations. One upload overlaps the next encode; there is no full-recording output blob. A checksum-verified immutable file is atomically added to the manifest before recipients can request it. Upload retries are idempotent and overlapping audio intervals are rejected.

The link becomes available as soon as its initial audio and image are playable. The recipient schedules audio on the audio thread, waits silently for missing sections, and never repeats a short segment to fill a slot. Feedback and delivery have independent revisions. Cancellation saves the partial room and its feedback; Resume skips uploaded sections and reuses cached work.

“Watch this section” requests up to 30 seconds within a video source. The owner's open project handles pending requests even after the Share dialog closes. Ordinary motion copies use 640×360 maximum, 15 fps VP8 with mono Opus; detailed copies preserve source dimensions and frame cadence at a higher compressed bitrate. Detailed video is not an original-quality export. Requests persist while the sender is offline. The optional offline-video checkbox uploads motion copies for the entire authorized passage before declaring the requested upload complete; that choice persists across resume.

These are representations of the existing review room and source assets, not a second edit model. Comments, transcript corrections, cuts, and replacement recordings use existing proposal/acceptance operations. The review preview continues to represent source recordings and cuts; final effects belong in the editor.

## Validation

Use a private real-speech corpus, not synthesized tones, for the browser regression. This run used the first 25 seconds of the user's Staff Training recording, transcribed by the actual browser Whisper worker. Media and transcripts are kept outside the repository in `/tmp/speechedit-real-speech`.

`smoke:progressive-review` exercises the real worker, server, recipient page, and Share dialog:

- Share only 5–17 seconds; check every representation stays within that interval, with no outside words or waveform.
- Delay subsequent uploads by four seconds each. Publish and play while the upload is incomplete; reach the original source end exactly. Inspect audio-thread scheduling for overlapping nodes and capture real decoded output through an AudioWorklet.
- Cancel after publication, add feedback, then resume. Uploaded identities and feedback survive; remaining cached sections are reused.
- Request motion, upload source-rate detail, play video with review audio paused, and verify HTTP byte-range seeking. FFprobe confirmed 30 fps detail for the 30 fps source.
- Click the actual Share dialog with selected transcript words and offline video enabled. Only the selected 5.06–15.92 second interval is shared; the link works and completion includes its video.
- Open the production recipient bundle in an isolated browser profile and check the editor bundle is not downloaded.

The captured playback was transcribed again: the selected speech appears once, including “pay amounts throughout this video.” ASR also made a word-recognition error; this is a repeated-playback regression check, not a claim of perfect transcription or perceptual quality.

Server tests cover scope, immutable checksums, retries, overlap rejection, media-duration validation, authenticated range downloads, early publication, incomplete completion rejection, cancellation/resume, retained feedback, offline-video coverage, and revocation. The complete suite passed 760 tests before the last offline-coverage test was added; the final affected suites passed 12 tests. TypeScript, theme guard, web build, and desktop build pass. The previous real-video clock and eye-toggle checks are documented in `2026-09-13-playback-and-track-output.md`.

## Timing and limits

A 12-second training passage was about 59 kB for audio plus two images. On localhost, first publication was around 0.2–0.5 seconds and total completion around 8.5 seconds with artificial four-second upload delays. The recipient's `review-open-to-first-audio-and-image` Performance measure includes navigation, user pressing Play, and its first advancing audio clock plus loaded image. It is distinct from the sender's `usefulMs` (first published representation) and `totalMs`. Neither is a measurement of a person's understanding. Repeat under actual slow uplinks and on target devices before making speed promises.

The production recipient opened to its first advancing audio clock and loaded image in 907 ms on localhost in the final run, including the scripted Play click; this is not a WAN/mobile result.

The initial production review JavaScript is about 267 kB (86 kB gzip), excluding CSS/fonts and media, after separating the editor into lazy chunks. No ASR model is needed to review an existing transcript. The ten-minute 2.7 MB storyboard estimate remains illustrative; source complexity and scene count change image size.

Source decode and encoder-add time are measured separately for audio; thumbnail decode is also reported. The input/demuxer is reused but each bounded audio interval currently creates a new sink, so this is not a claim of one continuous decoder pass. Motion conversion reports elapsed time without pretending to isolate its decoder. Dense motion, unusual timestamp offsets, VFR, long recordings, Safari/Firefox, and low-end mobile hardware need broader qualification. Current browser verification uses Chromium/Electron 37 on Linux. Standard Opus is the only shipping audio profile; no neural decoder is required.

## Reproduce locally

```sh
bun run dev:web -- --host 127.0.0.1 --port 5187
# In another terminal; source.mp4 and transcript.log are the private real-speech fixture:
SPEECHEDIT_SPEECH_CORPUS=/tmp/speechedit-real-speech bun run smoke:progressive-review -- --no-sandbox
```

For a production recipient, build the web app, start `scripts/web-server.ts` on another local port using the same temporary review directory as Vite, then set `SPEECHEDIT_REVIEW_RECIPIENT_ORIGIN` to that origin when running the smoke. The smoke creates and revokes its own rooms. It does not touch real shared rooms.

## Separate codec experiment

See `scripts/codec-experiment/README.md` and the adjacent codec results JSON. The harness compares ordinary Opus 24/16 kbps and a verified Opus 1.5.2 native NoLACE build at 12/9 kbps. Lyra is a follow-up. Browser neural decoder download/startup/seeking and blind listening are still promotion gates, not implemented production capabilities.
