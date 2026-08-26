# Real-Video Validation Roadmap

- **Status:** Active
- **Last audited:** 2026-08-25
- **Current milestone:** First complete edit of a real, useful video
- **Initial product wedge:** Client demos, software tutorials, and product walkthroughs

This is the execution plan for moving SpeechEdit from a well-tested development build to evidence that it can finish real editing jobs. It is deliberately not a general feature backlog.

The first proof is simple:

> A person imports footage they actually need, understands the automatic changes, finishes the edit, saves and reopens the project, exports the final MP4, watches it completely, and is willing to use the result.

## Current state

The core vertical slice exists: native media inspection, proxy generation, transcription, transcript and timeline edits, reversible Auto Edit operations, project persistence and recovery, preview, captions, and native FFmpeg export.

Verified on 2026-08-25:

- [x] `bun run typecheck`
- [x] `bun run lint:theme`
- [x] `bun run build`
- [x] `bun test src/renderer/src/lib` — 567 passing tests across 69 files
- [x] Native FFmpeg import/export smoke tests pass
- [x] Preview/export parity tests pass
- [x] Save, reopen, recovery, missing-media, and relink tests pass
- [x] Local whisper.cpp transcription smoke tests pass in the current Linux/WSL environment
- [x] Current environment has FFmpeg/FFprobe 4.4.2
- [ ] A representative real-video corpus exists
- [ ] A complete real deliverable has been edited and accepted
- [ ] SpeechEdit has completed a real-media import/export on a clean Windows machine
- [ ] SpeechEdit has been used successfully by a nontechnical tester

Automated coverage means the app is ready to enter internal dogfooding. It does **not** establish that the editing result is trustworthy, that timing remains correct on real capture formats, or that a new user can finish the workflow.

## Blocker audit

### Internal real-video testing

There is no confirmed code blocker preventing the first internal real-video test in the current development environment.

The following are required preflight conditions, not new product features:

- [ ] Run the Electron application with `bun run dev`; do not use `bun run dev:web` for the test. The browser build cannot open or export native media.
- [ ] Use a private, consented source video that can safely be retained while defects are reproduced.
- [ ] Preserve the original source file unchanged.
- [ ] Confirm the chosen transcription path produces real words before trusting transcript edits.
- [ ] Confirm adequate free disk space for the source, proxy, cache, project, and output.
- [ ] Record source metadata and the exact build/commit used for the run.

If any preflight item fails, fix that narrow failure; do not turn it into a general feature expansion.

### Confirmed blockers before a Windows private alpha

These do not prevent immediate internal dogfooding, but they do prevent handing the application to an ordinary Windows user and expecting a reliable first run.

#### B1 — Package and install the desktop application

The repository now has a reproducible Windows x64 ZIP packaging workflow for internal validation. A polished installer, upgrade path, and signing workflow still remain. Evidence: [`package.json`](../package.json) and [`electron-builder.yml`](../electron-builder.yml).

- [x] Choose and configure Electron Builder.
- [x] Produce a Windows x64 ZIP validation artifact.
- [x] Include the package version in the artifact name.
- [ ] Show exact version/build identity inside the application and diagnostic output.
- [ ] Test install, launch, upgrade, and uninstall on a clean Windows user account.
- [ ] Decide how unsigned private-alpha builds will be communicated; code signing can follow before wider distribution.

**Current evidence:** `bun run package:win` produces a valid ZIP. The extracted app launches natively from a `C:\` path and opens a responsive `SpeechEdit` window without a development checkout, Bun, or Node.

**Exit gate:** A tester can install or extract and launch SpeechEdit without a development checkout, Bun, or a terminal.

#### B2 — Make FFmpeg/FFprobe dependable

SpeechEdit currently invokes `ffmpeg` and `ffprobe` from `PATH`. That is acceptable for development, but not for nontechnical users. Evidence: [`src/main/ffmpeg.ts`](../src/main/ffmpeg.ts) spawns those command names directly and the [`README`](../README.md) makes their system installation a prerequisite.

- [x] Bundle checksum-pinned FFmpeg/FFprobe 6.1.1 Windows x64 binaries.
- [x] Resolve packaged binaries from `process.resourcesPath/bin` by absolute path instead of assuming shell `PATH`.
- [ ] Add a startup health check that reports the binary paths and versions.
- [ ] Provide one plain-language recovery action when either tool is unavailable.
- [ ] Document and satisfy the redistribution/license obligations of the selected build.

**Current evidence:** Both packaged executables run natively on Windows and report FFmpeg/FFprobe 6.1.1. Automated tests verify packaged-path selection and developer-PATH fallback.

**Exit gate:** A clean Windows machine can import and export without manually installing FFmpeg.

#### B3 — Repair and prove Windows local Whisper installation

The current installer recognizes a Windows whisper.cpp download URL, but its unpack and readiness logic is Linux-specific: it uses a `.tgz`, expects `whisper-cli` and `libwhisper.so.1`, and looks for the Ubuntu directory name. Therefore automatic local transcription is not yet a valid Windows first-run path. Evidence: [`src/main/asrLocal.ts`](../src/main/asrLocal.ts).

- [x] Use the Windows ZIP archive and ZIP-compatible extraction flags.
- [x] Detect `whisper-cli.exe` and the required Windows DLLs.
- [x] Remove Linux library assumptions from Windows readiness checks.
- [ ] Verify download cancellation and restart without leaving a false-ready installation.
- [ ] Run a clean-machine Windows smoke: install model and binary, transcribe an MP4, reopen the app, and reuse the installation.
- [ ] Make failed transcription unmistakable; speech-island fallback must not look like a real transcript.

**Exit gate:** The default Windows path produces editing-grade timed words without terminal setup.

#### B4 — Prove the small-laptop desktop layout

The Electron window currently has a minimum size of 1100×720. This may fit the development display but can be awkward or inaccessible on a 1280×720-class screen after operating-system chrome. Evidence: [`src/main/index.ts`](../src/main/index.ts).

- [ ] Test the actual Electron application at 1280×720 and 1366×768.
- [ ] Confirm import, playback, transcript review, suggestion decisions, save, and export remain reachable.
- [ ] Confirm playback does not cause contextual controls to change panel height or make the workspace bounce.
- [ ] Lower the minimum window size or add intentional panel collapse behavior if required.
- [ ] Keyboard-test every critical action when a panel is collapsed.

**Exit gate:** A tester can finish the baseline workflow on a small laptop without hidden or overlapping required controls.

### Required before unsupported external testing, but not before dogfooding

- [ ] Add a one-click support bundle containing app version, platform, FFmpeg/FFprobe versions, settings with secrets removed, project JSON, source metadata, and recent logs.
- [ ] Add first-run status for media tools, transcription, cache location, and free disk space.
- [ ] Test crash recovery by terminating the app during an unsaved edit.
- [ ] Define a privacy statement for local files and any configured remote transcription/model endpoint.

### Explicitly not blockers for the first validation cycle

Do not postpone real-footage testing for:

- Auto-reframe, face tracking, or OCR/cursor reconstruction
- Multicam switching
- Stream highlight or topic mining
- Brand-kit automation
- Batch variants or content factories
- More decorative interface polishing without an observed workflow failure
- Every planned item in `FEATURE_INVENTORY.md`

These should be prioritized only when real sessions repeatedly demonstrate the need.

## Phase 0 — Establish a reproducible candidate

- [ ] Capture the Git commit and note any intentional uncommitted changes.
- [ ] Run the four baseline checks listed under **Current state**.
- [ ] Launch Electron with `bun run dev`.
- [ ] Confirm FFmpeg/FFprobe paths and versions.
- [ ] Transcribe a short known sample and confirm the transcript contains real timed words.
- [ ] Create a private run folder outside the repository for sources, outputs, projects, logs, and notes.
- [ ] Create the first run record from the template at the end of this document.

**Exit gate:** One identified build can import, transcribe, save, reopen, and export a short known sample.

## Phase 1 — Build the real-media corpus

Start small. Do not collect a giant codec museum before the baseline job works.

### Required first three sources

- [ ] **Baseline client demo:** 8–15 minutes, 1080p30 H.264/AAC, one speaker, screen recording.
- [ ] **Real tutorial:** 20–45 minutes with false starts, pauses, build waits, and quiet visual demonstrations.
- [ ] **Capture stress case:** OBS/browser variable-frame-rate recording or a phone HEVC/MOV with rotation metadata.

### Add after the baseline passes

- [ ] 4K or high-bitrate source that requires a proxy
- [ ] 60–90 minute recording
- [ ] Audio-only M4A/WAV
- [ ] Mono and stereo audio at 44.1 and 48 kHz
- [ ] Noisy speech, long silence, clipped speech, and music under speech
- [ ] Project whose source media is moved and must be relinked

For each source, record:

- [ ] Consent/ownership and privacy classification
- [ ] SHA-256 fingerprint
- [ ] Original filename and byte size
- [ ] Container, codecs, duration, resolution, frame-rate mode, and audio sample rate
- [ ] Three reference timestamps near the beginning, middle, and end
- [ ] Known speech, pauses, false starts, quiet visual activity, and expected keeper sections
- [ ] What a successful final video should accomplish

**Exit gate:** All three initial sources import, become playable, and have enough truth notes to judge results.

## Phase 2 — Produce the first real deliverable

Use footage that genuinely needs to be sent, published, or reviewed. During this phase, finish the job before polishing around it.

### Import and readiness

- [ ] Open the source in Electron.
- [ ] Record time to first playable frame.
- [ ] Record time to usable transcript, completed analysis, and completed proxy.
- [ ] Confirm picture orientation, duration, waveform, thumbnails, and audio playback.
- [ ] Confirm transcript words correspond to the spoken audio.
- [ ] Confirm all automatic cuts are visible, understandable, and reversible.

### Edit

- [ ] Review every quiet-activity, silent-still, static-screen, loudness, and retake suggestion.
- [ ] Confirm silent product activity is not blindly removed.
- [ ] Exercise Keep/Protect and verify Auto Edit respects it.
- [ ] Correct representative transcript words and proper names.
- [ ] Make transcript deletions and manual timeline edits.
- [ ] Add only the captions, title, zooms, or chapters the real deliverable needs.
- [ ] Undo and restore at least one automatic and one manual edit.
- [ ] Check joins near the beginning, middle, and end at normal speed.

### Persistence

- [ ] Save the project.
- [ ] Close SpeechEdit completely.
- [ ] Reopen the saved project.
- [ ] Confirm media, transcript, decisions, timeline, captions, and settings are unchanged.
- [ ] Make one additional edit and save again.

### Export and acceptance

- [ ] Export an MP4 using the camera/source original, not proxy-quality media.
- [ ] Record export time and output size.
- [ ] Re-import or probe the output and confirm duration, picture, and audio streams.
- [ ] Watch the exported file completely at 1×.
- [ ] Skim it again at 1.5× to expose awkward joins and frozen tails.
- [ ] Check A/V sync near the beginning, middle, and end.
- [ ] Check every caption, title, transform, speed-up, fade, and critical cut boundary used.
- [ ] Confirm there are no black frames, frozen tails, missing media, clipped words, or unexpected silence.
- [ ] Decide whether the artifact is actually usable and record why.

**Exit gate:** The final artifact is accepted for its intended real use. “FFmpeg produced a file” is not acceptance.

## Phase 3 — Reliability hardening

Fix failures in this order:

1. **P0 — Stop testing:** crash, data loss, corrupted project, incorrect destructive edit, broken undo/restore, import failure, export failure, missing media in output, material A/V desync, or preview/export disagreement.
2. **P1 — Finish is painful:** required action is hidden, transcript timing prevents editing, severe performance stall, misleading automation, inaccessible small-screen control, or repeated workflow confusion.
3. **P2 — Quality:** visual roughness, copy improvements, minor timing polish, and optional workflow acceleration.
4. **P3 — Expansion:** new use cases, new intelligence, and nonessential formats.

- [ ] Reproduce every P0 with an exact action sequence and source fingerprint.
- [ ] Add the smallest synthetic regression test that represents each confirmed engine failure.
- [ ] Retest the original real source after the fix.
- [ ] Rerun the full automated suite.
- [ ] Complete ten consecutive baseline sessions without a P0.

**Exit gate:** Ten complete import-to-export sessions with zero data loss, zero blocking failures, and zero unexplained output defects.

## Phase 4 — Use-case dogfooding

Complete at least two real jobs in each initial wedge:

- [ ] Two client demos or progress updates
- [ ] Two software tutorials
- [ ] Two product walkthroughs

Track per job:

- [ ] Source duration and final duration
- [ ] Analysis/transcription wait time
- [ ] Active human editing time
- [ ] Number of automatic suggestions accepted, rejected, restored, or misunderstood
- [ ] Number of times the editor asked “what do I do next?”
- [ ] Number and severity of export defects
- [ ] Whether another editor was needed to finish the artifact
- [ ] Whether the output was actually sent or published

**Exit gate:** Three distinct real projects, including at least two use cases, finish without developer intervention.

## Phase 5 — Private alpha

Begin only after blockers B1–B4 are closed.

- [ ] Recruit 3–5 nontechnical testers with their own footage and a real outcome.
- [ ] Give them the installer and a one-page privacy/first-run explanation, not a developer walkthrough.
- [ ] Observe the first session without rescuing normal confusion.
- [ ] Record exact hesitation points and mistaken consequences.
- [ ] Collect the support bundle for every failure.
- [ ] Fix repeated P0/P1 problems before adding broad features.

**Exit gate:** A new tester can independently install SpeechEdit, import a recording, understand or reverse automatic edits, save/reopen, and produce a valid final MP4.

## Validation gates

The private alpha is ready to expand only when all of these hold:

- [ ] Zero corrupted projects or unrecoverable edits
- [ ] 100% import, save/reopen, and export success on the baseline corpus
- [ ] No progressive A/V drift; measured spot checks are within 100 ms
- [ ] Preview and export agree on at least 20 sampled cuts, captions, transforms, and audio transitions
- [ ] No black frames, frozen tails, missing captions, wrong crops, or proxy-quality final exports
- [ ] At least 95% of edits labeled “safe” are accepted as safe; ambiguous edits remain review decisions
- [ ] A wrong automated decision is always visible, understandable, and reversible
- [ ] The application remains spatially stable during playback
- [ ] A new user can create a valid MP4 without coaching

## Defect record template

Copy this for every material failure:

```md
### RV-YYYYMMDD-NNN — Short title

- Severity: P0 / P1 / P2 / P3
- Build/commit:
- Platform:
- Source fingerprint:
- Source metadata:
- Project path:
- Expected:
- Actual:
- Exact steps:
  1.
  2.
  3.
- Relevant source/program timestamps:
- Reproduces after restart: yes / no / unknown
- Reproduces on synthetic fixture: yes / no / not attempted
- Support bundle/log path:
- Resolution and verification:
```

## Run record template

```md
# Real-video run YYYY-MM-DD

- Tester:
- Build/commit:
- Platform and display size:
- Source fingerprint and metadata:
- Intended deliverable:
- Started:
- First playable:
- Transcript usable:
- Analysis complete:
- Proxy complete:
- Active edit time:
- Export time and size:
- Save/reopen passed: yes / no
- Full watch-through passed: yes / no
- Artifact accepted for real use: yes / no
- P0 defects:
- P1 defects:
- Confusing moments:
- What should change before the next run:
```
