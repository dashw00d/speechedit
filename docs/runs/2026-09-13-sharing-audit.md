# Video sharing and collaboration audit

Audited local base: `357e719` on `spe-09/preview-relink-recovery`, plus the working-tree fixes described below. Fetched `origin/main` was `35ee973`, 13 commits behind this branch. This audit does not establish that the local fixes are deployed.

## Outcome

The account-free link flow works for both proposal-based review and direct collaborative editing. It is suitable for a friend reviewing a short video in the tested Chromium environment. The lightweight Audit view is the better default for that task.

## Findings fixed

- **Sharing blocker:** the merged timestamp safety fix deliberately preserves some words with `start === end`, but the review snapshot parser rejected them. Both Audit and Full editing creation use that parser. Snapshots now preserve zero-duration words, while cut validation still requires a real audio interval.
- **Missing transcript correction proposals:** Audit previously offered comments, cuts, and chapter renames only. A reviewer can now select a word and suggest replacement text without granting direct editing access. Acceptance uses `setWordText`, preserving normal caption synchronization and history. Changed/missing source words conflict rather than silently overwriting the owner's work.
- **Phone passage selection:** an explicit first-word/last-word selection action complements Shift-click. A nearby “Suggest an edit” button reaches the feedback form without hunting down the page.
- **Unnecessary submission friction:** a reason is optional for a concrete edit, and successful submission is acknowledged. Comments still require text.
- **Sharing defaults and owner feedback:** new links default to Audit; existing editing projects retain their editing choice. Technical preview details are collapsed. The owner's open Share dialog checks for feedback every 15 seconds. Older poll responses cannot replace a newer review revision.
- **Review context:** playback highlights transcript words; correction proposals show original and replacement text and can be previewed. Accepted corrections display in the shared transcript while Original source retains the immutable wording.

## Validation

- Baseline: 738 tests passed.
- Updated suite: **741 passed, 0 failed** across 97 files.
- Typecheck, production web build, theme guard, and whitespace checks passed. The existing large-bundle build warning remains.
- Review browser smoke: real 10-second video/audio fixture compressed, uploaded, and played in an independent recipient session. Verified correction suggestion without a reason, no owner mutation before acceptance, acceptance and Undo, automatic owner feedback refresh, passage selection without Shift at 390 px, proposed cut acceptance/Undo, original media preservation, and revocation.
- Full-editor browser smoke: real compressed video, remote correction/save/reload, second-editor synchronization, conflict recovery, new media contribution, separate local storage, merge back onto originals, Undo, and revocation all passed.
- Preview measured 640×360 at 8 fps with Opus audio; container duration was 10.125 seconds for the 10-second fixture.

Commands use a local production server on port 3099 with separate temporary review storage. Electron required `--no-sandbox` because this development machine's sandbox helper is not configured. This does not change application sandbox settings.

```sh
bun test src/renderer/src/lib
bun run typecheck
bun run lint:theme
bun run build:web
SPEECHEDIT_REVIEW_VIDEO=1 bun run smoke:review http://127.0.0.1:3099 --no-sandbox
SPEECHEDIT_REVIEW_VIDEO=1 bun run smoke:edit http://127.0.0.1:3099 --no-sandbox
git diff --check
```

Transcription responses in these UI tests are deterministic. They verify the collaboration journey, not ASR accuracy. Small-screen checks use Chromium at phone width, not physical iOS/Android devices. Long-video upload, interrupted uploads, mobile backgrounding, and production concurrency were not benchmarked here.

## Next product priorities

1. **Share this moment:** a selected transcript passage produces a link that cues the video, highlights the words, and carries the sender's question. Keep whole-video sharing equally accessible. Compose this from existing source ranges and review comments.
2. **A review inbox:** surface pending-feedback counts outside the Share dialog; show original → proposed text, bounded playback around the edit, Accept/Reject/Reply, and Next. Save unfinished feedback drafts across reloads.
3. **A complete return loop:** “Done reviewing” gives the owner a concise activity summary and a direct route to pending suggestions. Add opt-in notifications only when a delivery channel exists.
4. **Immediate link, progressive readiness:** create a stable recipient destination early and show upload/transcription progress until playable media is available. Interrupted uploads should resume. Avoid showing “ready” before another browser can actually play the clip.
5. **Make your own version:** fork the shared project using the existing editable document and preview assets; share the derivative with a visible link to its source. Make the recipient-to-creator transition one obvious action.

Before broad public promotion, verify long recordings and real mobile browsers, durable hosting storage, and a recoverable owner-management path. Current links expire after 30 days, and clearing the creating browser's storage loses owner management access. These are material limits for treating links as durable references.

Measure the journey: drop-to-playable-link time, recipient-open-to-first-suggestion time, suggestion-to-owner-decision time, and the fraction of recipients who create a new shared clip. These are proposed success metrics, not measured results.
