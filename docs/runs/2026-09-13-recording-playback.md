# Replacement playback at the end of a take

## Reproduction and fix

After an owner records a passage and a collaborator replaces the same passage, the owner's recording asset remains available for Undo but no longer has a timeline clip. The legacy source-media fallback classified this unused asset as a primary take, so the monitor could use a short replacement recording as its main source. Microphone replacement assets without an explicit source offset are now excluded from primary takes, including when opening existing projects.

The playback engine also called `play()` repeatedly on ended audio while its timeline slot remained active. Ended media now stays silent until an intentional rewind or source change. Pending seeks finish before a paused element plays, decoder drift cannot move program time backwards, and an exhausted primary source uses the program clock through the final partial frame. Replacement slots and original-voice muting retain the entire selected duration.

## Verification

- 756 tests passed across 100 files; typecheck, theme guard, web build, and desktop build passed.
- `bun run smoke:recording-playback --no-sandbox` uses the actual Monitor, playback engine, and Chromium media elements. Two consecutive takes replace the same 1.5-second slot. A 0.25-second decoded take leaves a silent remainder; a 1.49-second take exercises end-time rounding. Playback reaches program end without moving backwards, and deliberate replay works.
- The same browser probe fails against deployed baseline `ca65941`: the monitor selects the unused 1.5-second take and playback fails to finish.
- Shared-editor smoke now stops the collaborator recording early and verifies the original source remains the monitor input with exactly one replacement clip.

## Hosting

Production requires `Permissions-Policy: camera=(), microphone=(self), geolocation=()` (or an equivalent policy allowing same-origin microphone access). ServerChirp's generated Nginx configuration originally used `microphone=()`; the SpeechEdit vhost was corrected during the previous deployment. Verify this header after proxy configuration is regenerated. Shared media persists on the application's named `/data` Docker volume.
