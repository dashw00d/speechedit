# RYA-433 — Astra microphone recovery checkpoint

Product commit: c07ae38 on astra/rya433-microphone-recovery, base e9b6590.
Workspace: /home/ryan/.paperclip/workspaces/speechedit/astra-rya433.
Implementation attribution: Astra, scheduled RYA-459 run. Independent GLM acceptance remains required.

## Verified scope correction
The baseline already awaits getUserMedia before the countdown. Real Electron permission-handler denial without use-fake-ui-for-media-stream produces Permission denied, no transient countdown/audio take, and zero onUse calls. Granting permission and retrying works. The original QA335 probe globally sets the auto-grant flag; its claimed denial must be independently rechecked. This pass does not establish the deployed build's behavior or claim to have fixed silent replacement.

The prepared plain-language recovery requirement genuinely fails on baseline: raw Permission denied, normal introductory instructions, Start recording button. baseline-copy/trace.json records the intentional failed assertion. baseline/trace.json records baseline safety and successful retry.

## Changed behavior
recording.ts maps permission/security, missing device and busy/unreadable device errors to specific microphone explanations with a recovery step and Nothing was recorded. Missing mediaDevices has actionable window guidance. RecordReplacementSheet hides normal start instructions after failure and offers one Retry recording button. Capture scheduling, saving, slot eligibility, Undo and collaboration code are unchanged.

## Verification
- QA_EXPECT_COPY=1 QA_OUTPUT=final python .lab-rya433/run-browser.py: PASS. Actual component and recorder mounted in an isolated browser fixture; real denied permission, no transient countdown/take, zero writes, granting permission then successful capture/use; injected legacy permission/security/not-found/not-readable/missing-API cases; stop-early then cancel; cancel during countdown.
- Final trace and denied screenshot: .lab-rya433/final/. Initial extended harness failed because executeJavaScript tried to clone an assigned function; harness fixed to return void, then controls-fixed and final passed.
- bunx tsc -p tsconfig.web.json --noEmit: PASS.
- bun run build:web: PASS (existing bundle-size/dynamic-import warnings).
- git diff --check: PASS.
- Test runner owns and terminates its loopback Vite process. Fake audio device; no physical microphone, project data, production writes or network AI calls.

## Independent next steps
GLM Reviewer: reproduce baseline/candidate denial without global fake permission grant; validate explanatory copy and Retry, then original host/guest editor path including selection eligibility, successful replacement, Undo and sync on exact integrated candidate. Fixture checks alone do not satisfy full campaign acceptance. Investigate original QA335 denial assertion before retaining the data-loss claim.
Dispatcher/Builder: merge this product commit into RYA-458 only through the existing integration/review path after acceptance; retain separate branch/integrated/deployed status. ServerChirp commit remains unconfirmed. No deployment authorized here.
