# Passage sharing, feedback inbox, and voice replacement

Local implementation follows the sharing audit on base `357e719`. The validation recorded below was completed locally before publication.

## Delivered

- A contextual **Share this passage** action opens the existing share flow with selected words and an optional question. Existing review copies reuse their uploaded media. Fragment parsing remains compatible with ordinary review links; questions are not sent in HTTP request URLs.
- Recipients land at the selected source time with highlighted words, the sender's question, and explicit playback/respond actions. Playback around suggestions is bounded.
- A **Feedback** badge aggregates pending suggestions across the current project's Audit links through an authenticated summary endpoint. The inbox has pending/all views, original and suggested wording, playback, Accept/Reject/Reply, and Next pending.
- Unsent review comments, corrections, chapter titles, and thread replies persist locally and recover on reload. A stale revision can retry once after the server explicitly rejects the first mutation with 409.
- **Re-record audio** opens a modal with the selected script, fixed slot duration, 3–2–1 countdown, time remaining, microphone level, automatic stop, early stop, listening, retry, and use/submit actions.
- The microphone audio thread captures a fixed number of PCM samples. Countdown audio is excluded; an early stop pads the unrecorded remainder with silence. The UI states the amount of padding.
- Hosted takes become mono MP3 on the server. Audit participants submit a recording proposal; full editors can use recordings directly. Authored MP3 files are preserved when shared again. Accepted/pulled recordings are downloaded into the owner's durable browser media store. Desktop local takes use WAV files in the app's recordings directory.
- Voice replacement composes a normal audio clip with `replaceVoice` mixing. It leaves video segments, source styles, captions, background music, and timeline duration unchanged. Overlapping previous replacement clips are trimmed around the new take. Undo is one step.

## Validation

- Full suite: **750 passed, 0 failed**, 99 files.
- Typecheck, theme guard, web production build, and desktop build passed.
- Unit/audio integration checks exercise countdown exclusion, exact sample count, early-stop padding, replacement overlap, speed-adjusted local slots, stale duration rejection, unchanged video/music, and Undo.
- An FFmpeg render test checks samples immediately before/inside/after the mute interval, including a 20 ms selection boundary, without splitting the video.
- Review API tests verify authenticated MP3 upload/read, malformed slot rejection, owner-only summaries, no source mutation before acceptance, proposal validation, and local MP3 preparation.
- Browser smokes use independent owner/recipient sessions, a real compressed video fixture, actual AudioWorklet capture with Chromium's fake microphone, MP3 upload/playback, inbox delivery, acceptance, local original retention, Undo, and revocation. They also exercise passage landing, question encoding, draft reload, phone-width selection, and bounded playback.

```sh
bun test src/renderer/src/lib
bun run typecheck
bun run lint:theme
bun run build:web
bun run build
SPEECHEDIT_REVIEW_VIDEO=1 bun run smoke:recording http://127.0.0.1:39099 --no-sandbox
SPEECHEDIT_RECORDING=1 SPEECHEDIT_REVIEW_VIDEO=1 bun run smoke:edit http://127.0.0.1:39099 --no-sandbox
```

The local Electron sandbox helper requires `--no-sandbox` for these test runs. The application configuration is unchanged. The final smoke server is scoped to the shell running the probes so a background server exit cannot masquerade as a product failure.

## Deliberate limits

Recording slots are 0.1–120 seconds. Audit takes target shared source time and exclude passages containing shared cuts; a changed owner playback duration requires another take. The Audit player remains a source/cut preview: proposed replacement audio has its own playback control, and the accepted mix plays in the editor. Speech that exceeds the timer is cut off, and early completion may leave silence; Listen and Retry make these consequences inspectable. There is no automatic speech stretching.

Tests use simulated microphone input and deterministic transcription responses; real microphones, device latency, physical mobile browsers, and long-session background suspension still need device testing. Payment entitlements, early unpublished recipient links, completion notifications, and public fork/remix flows are separate future work.

## Technical references

The audio worklet records against the audio rendering sample clock described by [MDN's currentFrame documentation](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame). Export mutes original speech with per-sample `aeval` expressions, as documented in the [FFmpeg audio filter reference](https://ffmpeg.org/ffmpeg-filters.html#aeval), rather than introducing video edit boundaries.
