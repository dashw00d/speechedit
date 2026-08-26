# SpeechEdit — User Action Inventory & Reference Apps

Every **discrete action** a user can take to accomplish something in SpeechEdit (Aug 2026 codebase audit).

**Status:** ✅ Shipped · 🔶 Partial · 📋 Planned (documented, not built)

**Reference format:** 2–3 apps that do *this exact action* best — **functional** (what works) + **UI** (how it feels).

**Maintenance:** Add one row per new affordance. Do not merge actions into feature categories.

---

## 1. Project & file lifecycle

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Start empty project (“New reel”) | File → New reel; palette “New reel” | ✅ | **Descript** — blank composition, no wizard (functional). **VS Code** — File → New Window mental model (UI). |
| Import video/audio (probe, waveform, thumbs, ASR, suggestions) | File → Open media… | ✅ | **Descript** — drop file → instant transcript row (UI). **CapCut** — import → immediate timeline (functional speed). After the reel is playable, silence starts before thumbs. Look ffmpeg is capped at two. Recordings ≥90s seek thumbs and peak windows, and silence+loudness share one 8 kHz pass. Recordings ≥180s transcribe in overlapping 90s chunks that resume after a cancel. Each finished chunk lands on the transcript and applies new safe fillers while later windows still run. Safe pauses apply when looks land (export is allowed). Retakes wait until the merged cue list is complete. Undo after looks or after streamed fillers is not re-applied when later chunks finish. |
| Cancel in-flight import | Click status pill while analyzing; palette “Cancel import”; Escape (if not in palette) | ✅ | **Final Cut** — background task cancel in progress HUD (UI). |
| Import transcript only (SRT/VTT/JSON) onto existing media | File → Open transcript… | ✅ | **Subtitle Edit** — import subs without re-encoding (functional). **Premiere** — import captions track (UI: separate from media). |
| Drop transcript file onto transcript panel | Drag file onto transcript | ✅ | **Descript** — drag SRT (functional). **Google Docs** — drop-to-import affordance (UI). |
| Import external timeline (interchange) | File → Import timeline… | ✅ | **Premiere** — XML import (functional). **Resolve** — OTIO import dialog (UI). |
| Open saved `.speechedit` project | File → Open project… | ✅ | **Logic Pro** — open project bundle (functional). **VS Code** — recent files list pattern (UI). |
| Save project | File → Save; ⌘S; palette “Save” | ✅ | **Google Docs** — continuous save expectation (UI). **Figma** — save indicator in chrome (UI). |
| Save project to new path | File → Save As…; ⌘⇧S | ✅ | **Every desktop app** — Save As dialog (functional). |
| Load built-in demo project | File → Studio demo; palette “Load studio demo” | ✅ | **Descript** — sample project teaches workflow (UI). **Framer** — template gallery entry (UI). File closes after the pick so the next click is the script, not the flyout. |
| Confirm abandoning unsaved work | Dialog when New/Open/Demo with dirty project | ✅ | **macOS** — standard “don’t lose work” sheet (UI). |
| Restore unsaved edits after crash | Banner → Restore | ✅ | **Word** — recovery pane (functional). **Logic** — recover autosave (UI). |
| Discard recovery, keep last save | Banner → Keep saved | ✅ | **Word** — “keep original” on conflict (UI). |
| Relink first missing media file (banner) | Missing-media banner → Relink… | ✅ | **Premiere** — offline clip relink (functional gold standard). |
| Relink specific missing asset (inspector) | Project inspector → Relink… per asset | ✅ | **Premiere** — right-click offline → relink (UI). |
| Rename project / reel | Project inspector → Reel name field | ✅ | **Descript** — composition title inline (UI). |
| View document path (read-only) | Project inspector → Document field | ✅ | **VS Code** — path in title bar (UI). |
| Reopen a recent reel | Empty-state cards; File → Recent; palette “Open recent · …” | ✅ | **VS Code** — recents on the welcome page (UI). **Word** — Recent on the home screen (functional). |
| Drop a recording, project, or timeline (not only a transcript) | Drop onto transcript or monitor | ✅ | **Descript** — drop anything onto the composition (functional). **Finder / Explorer** — the file is the action (UI). |
| Relink every missing file | Missing banner / inspector → Relink all… | ✅ | **Premiere** — Relink Media batch (functional). |
| Relink nearby files after finding one | Automatic after Relink… | ✅ | **Premiere** — reconnect others in the same folder (functional gold standard). |
| Save from the status pill or inspector | Click **Unsaved** pill; inspector **Save reel…** | ✅ | **Figma / Google Docs** — chrome save affordance (UI). |
| Import a plain-text transcript | File → Open transcript… or drop `.txt` | ✅ | **Subtitle Edit** — plain text import (functional). |

### Audit notes — §1 (2026-08-25)

**What a headache user hit:** Empty transcript looked like a brochure. The “drop transcript” card was not a button. Dropping an `.mp4` onto the script failed. Recents lived only in File. Lose-work was a browser confirm with no Save. Relink was one-file-at-a-time. Unsaved was a label, not a control.

**What the best apps do:** Descript / CapCut treat the empty canvas as “drop or pick a file.” VS Code and Word put recents on the home screen. macOS sheets offer Save / Don’t Save / Cancel, Enter saves. Premiere reconnects a whole bin after you find one clip.

**What we shipped:**
- Empty state: all cards click (Open media, transcript, demo, project). Recents sit under the cards. Open media is the primary card.
- One intake path: drop or File or palette classifies media / `.speechedit.json` / interchange / SRT·VTT·TXT·JSON. Monitor and transcript share it.
- Lose-work is a real sheet (Save focused, Enter saves, Escape cancels) before New reel, Open media, Open project, recents, demo, or a replacing drop.
- Status pill: analyzing → cancel import; unsaved → save. Inspector **Save reel…** when dirty or never saved.
- Relink all on the banner and inspector. After one pick, same-folder files with matching names reconnect themselves.
- File → Recent is a labeled list of names, not `Recent ·` spam. Palette has Open media / project / transcript / recents.
- Hour-scale looks: analyze starts before thumbs so silence is not stuck behind a full-file decode. At most two look ffmpeg at once (proxy / Whisper stay off that lane). Waveform / silence / loudness use `-vn`. Long or HD scene detect is 5 fps / 320px. Recordings ≥90s seek ~20 thumbs and seek ~1800 short peak windows instead of decoding every frame or the whole soundtrack. Silence and loudness share one audio look pass; recordings ≥90s resample that pass to 8 kHz so first-edit does not wait on two native-rate decodes. Analysis cache is v2.
- Playback and export share one cached resolved program per project snapshot. After first-edit (hundreds of silence cuts) the monitor does not rebuild `normalize` + `resolveSegments` every animation frame; source↔program mapping is log-time so snap and the playhead stay cheap.
- Program time is the master clock. A decoder walking into a deleted hole no longer stalls the playhead or flashes cut material; the engine hard-seeks to the next keep. Preview proxies use a 15-frame GOP so those seeks can land. A cached proxy with a long GOP (ffmpeg default 250) remakes on import and reopen so those seeks stay possible. Dissolve underlay uses the outgoing take’s file, not the incoming `src`.
- First edit is staged: safe pauses apply when looks land (export allowed while Whisper runs). Finished ASR chunks stream onto `setTranscript` via `attachTakeIntel` and apply new fillers immediately. Retake collapse waits for the merged cue list. Undo after looks or after streamed fillers is not re-applied when later chunks finish. The first filler batch is one undo; later chunks do not stack history. Real words also build caption clips on V3 (revealed) so the monitor and a burned MP4 match the SRT. Placeholder islands do not. Undo or an edit locks auto refresh. Talking-over-static and pace notes are dismissed (kept). Leftover breaths stay in Review and appear on the bar after picture leftovers — Hear, then Cut or Keep. Silent stills open Review as Cut / Keep. Quiet static screens follow as Speed / Keep. Hot spikes follow as Quiet / Keep via `setRangeVolume` on the same command bus. Talking-over-static stays Keep-only so speech is not sped.
- Export parks lingering Whisper (SIGSTOP / low priority on Windows) instead of aborting it, then resumes. whisper.cpp cannot resume a kill, so a first-cut encode no longer fights ASR or throws away progress.
- Hour-scale ASR splits recordings ≥180s into overlapping 90s windows and caches each chunk. A cancel, crash, or retry resumes finished windows instead of throwing away the whole transcript. Each saved or newly finished window emits merged-so-far cues on transcribe progress so the reel can show words before the last chunk. Short files stay one pass. The merged cue list is still the v1 ASR cache first-edit already reads.
- Interchange B-roll / music restore the slipped `inPoint` (OTIO, FCPXML, MLT, Kdenlive, Premiere). `addBroll` / `addAudio` accept `inPoint` on the command bus.
- Interchange restores lifted holds and insert-gaps (OTIO `Gap.1` + metadata, FCPXML `<gap>`, MLT/Kdenlive `<blank>`, Premiere Hold clipitem). A hold is no longer written as a zero-length media clip.

---

## 2. Export & rendered output

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Open export sheet | Menubar **Export**; File → Export…; palette “Export…”; right-click → Export… | ✅ | **Descript** — export destinations in one sheet (UI). **CapCut** — export panel, not a hidden menu (UI). |
| Export rendered MP4 (burned program) | Export sheet → Video · MP4 | ✅ | **Descript** — export with edits baked (functional). **HandBrake** — pick destination then progress (UI). |
| Frame-accurate export cuts | Automatic — trim/atrim on source times, not input-only `-ss` | ✅ | **Premiere** — what you cut is what renders (functional). Long files still preroll ~4s so we do not decode from t=0. |
| Single-pass program encode | Automatic — every keep, caption, still, and bed in one filter graph | ✅ | **Auto-Editor** — one render for the cut list (functional). Mix no longer re-encodes a temporary body. |
| Hardware encoder fallback to x264 | Automatic when NVENC/QSV/AMF/VideoToolbox dies | ✅ | **HandBrake** — fall back to CPU when the GPU encoder fails (functional). |
| Export pauses a lingering preview proxy | Automatic — export preempts proxy ffmpeg, then the proxy remakes | ✅ | **Premiere** — transcode does not fight share (functional). Whisper is parked (SIGSTOP), not aborted, then resumes. An aborted proxy never leaves a truncated cache. A long-GOP cache remakes the same way a truncated one does. |
| Add a second A-roll take | File → Add take…; palette | ✅ | **Descript** — append another recording to the same script (functional). The take lands after probe/proxy; words fill in without replacing take 1. |
| Cancel export | Export button while exporting; palette “Cancel export”; Escape | ✅ | **Final Cut** — stop share (UI). |
| Choose export file path | System save dialog (Electron) | ✅ | **Standard OS** — native save panel (UI). |

### Sidecar / interchange exports (no re-encode)

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Export captions SRT | Suggest bar **Export SRT** after **Caption remaining** fills the tape (next to Export); transcript toolbar; Sequence; Export sheet; palette | ✅ | **Descript** — export subtitles (functional). **Rev** — SRT deliverable (functional). Caption remaining holds that slot until the tape is filled. Then Export SRT copies the SRT and downloads the file. Toast points at uploading it next to the MP4. Same `exportSidecar('srt')`. |
| Export captions VTT | Export sheet (common); palette | ✅ | **YouTube Studio** — VTT upload path (functional). **Kapwing** — WebVTT export (UI: one click). |
| Export transcript Markdown | Suggest bar **Copy notes** on the finish row after leftovers; transcript toolbar; Sequence; Export sheet **Transcript · Markdown**; palette. File download if clipboard is blocked. | ✅ | **Otter** — export MD notes (functional). **Notion** — clean MD export (UI). Chapter headings (`###`) then speaker turns (`##`). Typed tape notes land as `>` quotes where you dropped them. Empty “Note” placeholders stay out. Retakes stay out. Toast says to paste. Same `exportSidecar('md')`. |
| Export transcript plain text | Export sheet (common); palette | ✅ | **Trint** — TXT export for editors (functional). |
| Export YouTube chapters (from scenes) | Suggest bar **Copy chapters** on the finish row after leftovers; transcript / chapter inspector; Sequence; Export sheet **Chapters · YouTube**; content package writes `.chapters.txt` | ✅ | **Descript** — YouTube chapter markers copy (functional). First line is `0:00`. Headings closer than 10s are skipped so YouTube accepts the paste. Retakes stay out. Toast names how many lines. Same `exportSidecar('chapters')`. |
| Export OpenTimelineIO | Export sheet → More; palette | ✅ | **Resolve** — OTIO roundtrip (functional). **OTIO tools** — pipeline interchange (functional). B-roll and music beds emit ExternalReference. Slipped in-points round-trip. Lifted holds and insert-gaps emit `Gap.1` and restore as `inserts`. |
| Export Final Cut Pro XML | Export sheet → More; palette | ✅ | **Final Cut** — XML import target (functional). Connected `asset-clip` refs point at B-roll / music files. Spine `<gap>` holds round-trip. |
| Export Adobe Premiere XML | Export sheet → More; palette | ✅ | **Premiere** — XML handoff (functional). Extra video/audio tracks carry overlay and bed files. Hold clipitems restore as program inserts. |
| Export Auto-Editor v3 JSON | Export sheet → More; palette | ✅ | **Auto-Editor** — native timeline JSON (functional). |
| Export Shotcut MLT | Export sheet → More; palette | ✅ | **Shotcut** — MLT project (functional). `broll` / `beds` playlists keep overlay and music producers. Playlist `<blank>` holds round-trip. |
| Export Kdenlive project | Export sheet → More; palette | ✅ | **Kdenlive** — native XML (functional). Same MLT overlay/bed playlists and blanks. |

### Audit notes — §2 (2026-08-25)

**What a headache user hit:** Export was a single MP4 firehose. Eleven sidecar formats lived only in ⌘K. Palette exports downloaded with no toast. Empty Export said “needs Electron” and nothing else. Demo video export failed because there is no file, with no explanation.

**What the best apps do:** Descript and CapCut open an export panel: movie first, captions next, NLE interchange under advanced. Disabled rows say why.

**What we shipped:**
- **Export** (button, File menu, palette, context menu) opens a sheet: Video · MP4, then SRT / VTT / transcript / chapters. **More** holds OTIO, FCPXML, Premiere, Auto-Editor, Shotcut, Kdenlive.
- Empty reel disables everything with “Open a recording first.” Demo disables MP4 with “No media file on disk” and still lets captions download.
- Sidecar export toasts `Downloaded …` / `Saved …`. Palette commands share that path. **Copy chapters** / **Chapters · YouTube** and **Transcript · Markdown** copy first; a file is the fallback. Transcript **Copy notes** is the same Markdown. **Export SRT** copies and still saves the file so YouTube or an LMS can upload it.
- Web: captions still work; MP4 explains the desktop app. Encode progress and cancel unchanged.
- Lifted holds and insert-gaps survive OTIO / FCPXML / MLT / Kdenlive / Premiere round-trip. Native `Gap` / `<gap>` / `<blank>` / Hold clipitems restore as `Project.inserts`.
- Export parks lingering Whisper instead of competing with it. The proxy is still aborted and remade; ASR resumes after the encode.

---

## 3. Undo, history & global chrome

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Undo last edit | Edit → Undo ⌘Z; palette; right-click; ⌘Z | ✅ | **Descript** — transcript undo as one step (functional). **Figma** — predictable undo stack (UI). |
| Redo | Edit → Redo ⌘⇧Z; palette “Redo” | ✅ | **Standard** — redo in Edit menu with shortcut label (UI). |
| Open command palette | Edit → Command palette; ⌘K; transcript/timeline right-click | ✅ | **VS Code** — ⌘K fuzzy commands (UI gold standard). **Superhuman** — ranked palette (UI). |
| Close command palette | Escape; click backdrop | ✅ | **VS Code** — Escape dismisses (UI). |
| Open agent dock | Auto Edit → Ask agent… ⌘J; palette “Open agent”; Auto Edit → Open agent | ✅ | **Cursor** — agent panel toggle (UI). **WeftCut** — agent drives timeline (functional). |
| Close agent dock | Agent → Close; Escape; click backdrop | ✅ | **Cursor** — Escape closes side panel (UI). |
| Toggle agent dock vs inspector tab | Inspector tab “Agent” vs ⌘J dock | ✅ | **VS Code** — panel vs editor tab (UI pattern). |
| Clear all selection | Click empty workspace; Escape (when selection active) | ✅ | **Figma** — click canvas to deselect (UI). |
| View unsaved / analyzing / saved status | Status pill in menubar | ✅ | **Google Docs** — “Saving…” indicator (UI). |
| Cancel import from status pill | Click pill while analyzing | ✅ | **Final Cut** — click progress to cancel (UI). |
| Save from status pill when untitled | Click **Unsaved** even if the demo loaded clean | ✅ | **Figma** — untitled is never “Saved” (UI). |

### Audit notes — §3 (2026-08-25)

**What a headache user hit:** An untitled demo said **Saved**. ⌘K on an empty reel led with Export OTIO and Cut selection. Undo/redo, palette dismiss, and agent toggle already match the reference apps.

**What we shipped:**
- Status pill is **Unsaved** whenever there is no document path (or dirty). Click still saves. Analyzing still cancels import.
- Empty-reel palette ranks Open media / Save / demo first and buries cut/export sidecars until there is a transcript. Typed queries still find OTIO.

---

## 4. Playback & transport

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Play / pause program | Monitor ▶; Space; K | ✅ | **Premiere** — spacebar toggle (functional muscle memory). |
| Shuttle back 2s | J | ✅ | **Premiere** — J-K-L shuttle (functional industry standard). |
| Shuttle forward 2s | L | ✅ | **Premiere** — same. |
| Seek to start | Home | ✅ | **Final Cut** — go to beginning (functional). |
| Seek to end | End | ✅ | **Final Cut** — go to end (functional). |
| Seek playhead by one frame | ← / → | ✅ | **Premiere** — frame step (functional). |
| Seek playhead by one second | Shift+← / Shift+→ | ✅ | **Premiere** — larger nudge (functional). |
| Click timeline ruler/lane to seek | Click empty timeline area | ✅ | **Every NLE** — click ruler to scrub (UI). |
| Toggle loop I/O or whole reel | Monitor Loop; `/` | ✅ | **Premiere** — loop playback toggle (functional). |
| Play I/O range, else selection, else from playhead | Monitor **Play marked** / **Play selection**; Edit menu; P; palette | ✅ | **Premiere** — play in-to-out (functional). **Descript** — play the highlight (UI). |
| Play / loop selected sentence on word click | Click word (default) | ✅ | **Descript** — hear selection (functional). |
| Play / loop marquee or shift-range selection | Shift-click range; drag select words | ✅ | **Descript** — audition highlighted script (UI). |
| Play from source at scene start | Click scene chip | ✅ | **Descript** — scene marker scrub (functional). |
| Loop gap/pause on gap chip click | Click gap chip | ✅ | **Descript** — isolate pause audition (functional). |
| Park playhead at word (context menu) | Right-click word → Go here | ✅ | **Premiere** — “Go to time” equivalent (functional). |
| Park playhead at clip start (context menu) | Right-click clip → Go to clip start | ✅ | **Final Cut** — snap playhead to clip (UI). |
| Set mark In at playhead | Monitor **In**; I key; I with word selection uses span start | ✅ | **Premiere** — I key (functional standard). |
| Set mark Out at playhead | Monitor **Out**; O key | ✅ | **Premiere** — O key (functional standard). |
| Set both marks to selected words | Suggest bar **Mark clip** on a heading or words; Find **Hit**; heading menu; word popover; palette; **M** when Find is not focused | ✅ | **Premiere** — mark clip (functional). M does nothing while you type in Find — the bar button is the hunt. Marks loop the clip. The row becomes Export marked range / Clear marks. |
| Clear marks (keyboard) | **M** with no word selection when In or Out exist | ✅ | **Premiere** — clear in/out (functional). Same helper: next Find hit if a phrase is open, otherwise focuses Find. |
| Watch from beginning (suggest bar) | Suggest bar “Watch edited reel” / “Watch full reel” | ✅ | **Descript** — preview full edit (functional). After edits, Watch starts at 1.5× (the skim). 0.5× or 2× already picked stays. Toast says how to drop to 1×. |
| Export from suggest bar | Suggest bar **Export** after a first edit | ✅ | **Descript** — share/export after preview (UI). Opens the same Export sheet. Captions burn in unless unchecked. |
| Cut marked range from suggest bar | Suggest bar **Cut marked** (or **Lift marked**) when In–Out exist | ✅ | **Premiere** — ripple delete in/out (functional). Same helper as the tape / Edit / palette. The join plays. Toast names **Mark clip** for the next stretch. Marks and the word highlight clear so the marked row can stand down. |
| Export marked range from suggest bar | Suggest bar **Export marked range** when In–Out exist | ✅ | **Audacity** — export selection (UI). Sits next to Cut marked while marks are set. |
| Clear marks from suggest bar | Suggest bar **Clear marks** next to Cut / Export marked | ✅ | **Premiere** — clear in/out (UI). Same helper as timeline / Edit / palette / **M**. If Find still has a phrase, jumps to the next hit and hears it — Mark clip is next. Last hit focuses Find so you can type another line. |
| Drive playhead from picture clock | Automatic while primary video is ready | ✅ | **Premiere** — program time is master; picture may nudge inside a keep. A decoder in a cut hole does not stall or flash deleted frames. Audio-only / slugs still use rAF. |

### Audit notes — §4 (2026-08-25)

**What a headache user hit:** Transport said **Play I/O** and **I — / O —**. Premiere users get it; everyone else swears. J-K-L, Space, Home/End, and word-click audition already match Descript/Premiere.

**What we shipped:**
- **Play marked** / **Play selection** only appear when marks or words exist. Safe, Match, Copy frame, and Full screen sit in transport **More** so the row does not spill.
- Mark buttons read **In** / **Out**. **Clear** appears once a mark is set. Hover the clock for source time.
- The suggest bar shows one job (clean, leftover, leftover-decide, retake, selection, marked, or finish). Everything else is **More**. **Clear** deselects. Hear leftover is first when leftovers exist — even before Clean. After you hear one, decide actions take the row. After the last picture leftover, the next leftover is a breath — the bar says **Hear breath** / **N breaths**, then **Cut breath** / **Keep breath**. Cutting the last leftover names the next job (Clean / Collapse retakes / Review) and clears the leftover so that row can take over.

---

## 5. Transcript — selection gestures

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select single word | Click word | ✅ | **Descript** — word as atom (UI). |
| Extend selection to click (range) | Shift+click word | ✅ | **Google Docs** — shift-click range (UI). |
| Toggle word in/out of selection | Ctrl/Cmd+click word | ✅ | **Figma** — additive selection (UI). |
| Select sentence containing word | Double-click word; Alt+click word | ✅ | **Descript** — double-click sentence (UI). **Google Docs** — double-click is a select, never a delete (UI). |
| Select paragraph (triple-click) | Triple-click word | ✅ | **Google Docs** — triple-click paragraph (UI). Loops the stretch. Toast names **Remove paragraph** on the bar. |
| Select paragraph (keyboard/menu) | A key; Edit → Select paragraph; palette; right-click | ✅ | **Descript** — paragraph as edit unit (functional). Same helper: select, hear, then Remove paragraph. |
| Drag-select word range | Mouse down + drag across words | ✅ | **Descript** — drag in script (UI). |
| Marquee box-select words | Drag on empty script background | ✅ | **Figma** — marquee select (UI). |
| Additive marquee / drag | Shift/Ctrl during marquee or drag | ✅ | **Photoshop** — shift-add selection (UI). |
| Select all words | Transcript toolbar “Select all”; ⌘A in script | ✅ | **Google Docs** — select all (UI). |
| Grow selection one word | `]`; toolbar **More** when words are selected | ✅ | **VS Code** — expand selection (functional). |
| Shrink selection one word | `[`; toolbar **Fewer** when words are selected | ✅ | **VS Code** — shrink selection (functional). `[` used to grow backward. |
| Find phrase (live, one match at a time) | Transcript search; ⌘F; **Hear** / Enter loops the sentence; › next; Shift+Enter / ‹ prev. **Hit** holds Copy quote, Copy frame, Mark clip, All, Replace. | ✅ | **Descript** — search then play the hit (functional). **VS Code** — next/prev. Typing parks on the first match without restarting audio. The row stays Hear + step; shipping the hit waits in **Hit**. |
| Select all matching words | Find → **Hit** → **All N** | ✅ | **Descript** — search highlights every hit for a batch cut (functional). |
| Clear find query | Escape in search field | ✅ | **VS Code** — clear search (UI). |
| Select all words spoken by one speaker | Click speaker chip (no word selection) | ✅ | **Descript** — filter by speaker (functional). |

### Audit notes — §5 (2026-08-25)

**What a headache user hit:** Double-click cut the word — the same gesture every text app uses to select. Find selected every match at once with no next/prev. `[` grew the selection backward while the inventory called it shrink. Speaker rename was a browser prompt.

**What the best apps do:** Descript/Docs: double-click selects a sentence/word; Delete cuts. VS Code find: type, see 2/7, Enter steps. Batch “select all matches” is a second, explicit move.

**What we shipped:**
- Double-click a live word selects the sentence and plays it. Double-click a cut word still puts it back.
- ⌘F focuses find. Typing jumps to the first hit and highlights the rest. ‹ › / Enter / Shift+Enter step. **Hear** stays on the row. **Hit** holds Copy quote, Copy frame, Mark clip, All, and Replace so the hunt bar does not spray. **Copy quote** expands a hit to the spoken line, then names paste or **Mark clip**.
- **Fewer** / **More** appear on a selection; `[` now truly shrinks.
- Hint: “Click a word to hear it. Double-click a sentence. Triple-click a paragraph. Delete removes it from the video.”
- Triple-click / **A** selects the paragraph, loops it, and names **Remove paragraph** on the bar (or Delete). The join plays after the cut.

---

## 6. Transcript — edit actions on words

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Cut selected live word(s) (ripple) | Delete/Backspace; X; popover **Remove** / **Remove paragraph**; palette “Cut selection” | ✅ | **Descript** — delete word cuts media (functional defining feature). A full paragraph uses the same helper as the bar. |
| Remove paragraph | Suggest bar **Remove paragraph** after A / triple-click; Delete / X; popover; inspector; palette; Edit menu | ✅ | **Descript** — delete paragraph (functional). Names the time saved and plays the join. **Cut sentence** stays off that row so the whole stretch goes. |
| Restore cut word(s) | U; popover “Put back”; double-click cut word | ✅ | **Descript** — restore strikethrough (UI). |
| Cut sentence at caret word | Suggest bar **Cut sentence** on a selected line (not a restart); `.` or `>`; palette; popover | ✅ | **Descript** — delete sentence (functional). Cuts the spoken line around the caret, names the time saved, and plays the join. **Cut previous** takes that slot on a restart. |
| Cut previous sentence | Suggest bar **Cut previous** on a restart line; `,` or `<`; popover / inspector; palette | ✅ | **Descript** — trim false starts (functional). The join plays. Toast names the saved time. Long previous chapters stay on the key only. |
| Tighten interior gaps in selection | T key; popover “Make shorter”; palette “Make selection shorter” | ✅ | **Auto-Editor** — margin tighten (functional). **Descript** — shorten gaps (UI). |
| Edit word text (correct typo) | Right-click → Edit text…; inline blur; inspector Text field; find/replace | ✅ | **Descript** — correct transcript without cutting (functional). Auto caption cards that cover the word follow in the same undo. Hand-edited cards and title cards stay. Toast: “Captions follow the word.” |
| Copy selected words as a quote | Suggest bar **Copy quote** on a live selection; Find **Hit → Copy quote**; word popover; inspector; ⌘C; Sequence; palette | ✅ | **Otter** — copy quote with speaker (functional). A find hit or one word expands to the spoken line. Pastes `Name (1:24): the line`. Toast names paste or **Mark clip**. |
| Clear selection | Suggest bar **Clear**; transcript **Clear**; inspector **Clear**; click the selected chapter again; Esc | ✅ | **Every editor** — Escape deselects (UI). Visible Clear where a selection has no other way out. |
| Assign selected words to speaker | Click speaker chip while words selected; inspector Speaker | ✅ | **Descript** — drag speaker label (UI is drag; functional same). The stretch plays. Toast names **Copy notes**. A no-op click stays quiet so a second click can still rename. |
| Rename speaker | Right-click speaker → **Rename**; F2; double-click the chip; inspector Name; palette **Rename speaker** | ✅ | **Descript** — rename speaker in sidebar (UI). **Enter** keeps the name and opens the next voice. The last voice names **Copy notes**. |
| Add new speaker | + speaker button; palette “Add speaker”; Project Advanced | ✅ | **Descript** — add speaker track (functional). |
| Remove speaker | Right-click speaker → **Remove**; palette **Remove speaker**; Project Advanced | ✅ | **Descript** — delete speaker (functional). Words they owned move to the remaining voice. Last speaker stays. Toast says who has the words now. |
| Apply first contextual choice from popover | Click chip on last selected word | ✅ | **Superhuman** — inline action on selection (UI). |
| Contextual choices (dynamic, up to 4) | Popover chips: Remove, Put back, Make shorter, Keep, Use later take, Keep this take, Cut previous sentence, All fillers, etc. | ✅ | **Superhuman** — consequence + action (UI). **Descript** — selection toolbar (UI). |

### Audit notes — §6 (2026-08-25)

**What a headache user hit:** Double-click deleted the take. Speaker rename opened a browser prompt over the editor. `,` cut a false start but only from the keyboard — walking the script hid the move.

**What we shipped:** Cutting is Delete / X / **Remove** on the word. Double-click is select (live) or restore (cut). Speaker chips show **Rename** when that voice is the selection (always, on a one-speaker reel). F2 / double-click / inspector Name do the same. **Enter** opens the next voice; the last name points at **Copy notes**. Paint words and click a chip to assign — the stretch plays and the toast names **Copy notes**. A word selection **Copy quote** (find **Hit**, popover, ⌘C) pastes `Name (1:24): the spoken line` — a find hit expands past the search word. Toast names paste or **Mark clip**. A short live line before the caret offers **Cut previous** on the bar (same as `,`). The join plays. Toast names the saved time. Long previous chapters stay on the key only.

---

## 7. Transcript — pause / gap actions

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select pause between words | Click gap chip (>0.45s, or a leftover that starts in the gap) | ✅ | **Descript** — gap as object (functional). |
| Select linked leftover / silence via gap | Click leftover or pending silence chip | ✅ | **Descript** — AI suggestion on gap (UI). Leftover activity/still opens the same Silent demo / Speed / Cut inspector as Review. A leftover breath chip hears that breath. |
| Cut leftover or live pause | Double-click uncut leftover / live gap | ✅ | **Descript** — remove silence (functional). Leftover uses `resolveSuggestion` cut so Review stays in sync. Toast + Undo. |
| Restore cut pause | Double-click a mostly-cut gap (first-edit pads no longer look live) | ✅ | **Descript** — restore silence (functional). |
| Revert applied suggestion on gap | Double-click gap with applied suggestion | ✅ | **Descript** — undo single AI edit (functional). |
| Leave silent demo in a mixed gap | Double-click does not deleteRange a demo-tagged pause | ✅ | **Descript** — protect range (functional). |

### Audit notes — §7 (2026-08-25)

**What a headache user hit:** Gap chips were bare numbers (`9.7s`). After first-edit they still read as live leftover air even when most of the pause was already cut. Double-click on a mixed demo gap could eat the walkthrough. Quiet click-throughs had no chip.

**What we shipped:** Chips tell the truth — leftover activity, cut, or silent demo. Click a leftover to review it. Double-click cuts leftovers or puts a cut pause back. A silent demo in the gap is not deleted.

---

## 8. Transcript — scene chips

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select editorial scene | Click scene heading in transcript | ✅ | **Descript** — chapter heading in the script (UI). |
| Hear the scene | Click heading from outside (loops that chapter). Click while already inside only selects. | ✅ | **Descript** — click a scene to watch it (functional). |
| See silent / wordless scenes in the script | Heading appears before the next spoken word | ✅ | **Descript** — chapters exist even without speech (functional). |
| Rename scene | Right-click heading → **Rename**; F2; double-click the name; inspector Name; palette **Rename chapter** | ✅ | **Descript** — rename chapter inline (UI). Double-click no longer starts a hear loop. **Enter** keeps the title and opens the next heading. The last heading names **Copy chapters**. |
| Remove / put back a scene | Suggest bar **Remove scene** on a heading or words; inspector; Sequence; palette | ✅ | **Descript** — delete a scene from the script (functional). Uses the selected heading, selected words, or the playhead. Cuts the whole chapter (words and air). Toast names the next chapter. Retake neighbors are skipped. A silent walkthrough can come back. A dropped heading offers **Put chapter back**. |
| Jump to previous / next scene | ‹ › on the selected heading; `[` `]` while a scene is selected | ✅ | **Premiere** — previous/next marker (functional). |
| Use a retake from the heading | **Use later take** on a retake heading | ✅ | **Descript** — keep this take on the take card (UI). |

### Audit notes — §8 (2026-08-25)

**What a headache user hit:** Scene chips were tiny uppercase pills. Summary lived in a tooltip. Clicking one selected every word, so **Remove** sat on the last word — one slip cut the chapter. Silent demo scenes never appeared in the script. Talk scenes had no actions on the object.

**What the best apps do:** Descript treats a scene as a chapter heading: title, one-line summary, click to watch, rename in place, actions on the heading. Premiere steps markers with next/previous.

**What we shipped:**
- Headings show kind · duration, title, and summary. Silent walkthroughs land before the next spoken word.
- Click from outside hears the chapter (loop). Click while already parked inside only selects — Split and Rename keep your place. Selected heading highlights the words as a chapter, not a cut selection — no word **Remove** popover.
- **Rename** on the selected heading, F2, or double-click the name. A double-click cancels any pending hear so you can type. Inspector Name / Summary still work. A rename toast points at YouTube chapter copy.
- Right-click a heading for **Split** (playhead must be inside, or a mid-chapter word) and **Merge {neighbor}**. The bar names the other card on a heading or words. Split opens the new heading so you can name Q&A. Merge plays the joined chapter and names **Copy chapters**.
- Selected heading: Remove scene / retake actions, plus ‹ ›. `[` `]` step scenes while a scene is selected.
- Retake headings keep **Use later take** on the object.

---

## 9. Transcript — guard painting

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Toggle protect brush | G; Auto Edit → Protect words; timeline **Protect**; right-click | ✅ | **Photoshop** — brush mode is obvious on the canvas (UI). |
| Leave protect mode | **Done** on the transcript banner; Esc; toggle Protect | ✅ | **Photoshop** — Esc / other tool exits brush (UI). |
| Set brush to Keep | Banner **Keep**; timeline Keep; G then Keep | ✅ | **Auto-Editor** — manual keep range (functional). |
| Set brush to Silent demo | Banner **Silent demo**; Shift+G; timeline Silent demo | ✅ | **Screen Studio** — protect demo sections (functional). |
| Paint Keep/Demo on words | Protect mode + drag (or click) words | ✅ | **Photoshop** — paint selection (UI). Toast confirms what happened. |
| See existing protection in the script | **Protected** / **Silent demo** chip on the range | ✅ | **Descript** — ignore region is visible on the object (UI). |
| Remove a painted guard | Double-click the protection chip; selected heading **Unprotect** | ✅ | **Auto-Editor** — clear manual range (functional). |
| Protect a whole scene | Selected heading **Protect** | ✅ | **Descript** — ignore this chapter (functional). |
| Tag selection as Keep | Click a **pause · cut** chip — **Protect pause** on the bar; **More → Protect pause** for the longest cut if you have not parked; B key; palette; popover **Protect**; cut-pause inspector | ✅ | **Descript** — ignore region (conceptual). After a too-eager clean, park on the cut — Protect pause puts the think-aloud back, loops it, and blocks the next Auto Edit. It stays off the Watch / Export row until you click a cut. |
| Tag selection as Silent demo | Shift+B; palette “Tag selection as silent demo”; popover | ✅ | **Screen Studio** — protect demo sections (functional intent). |
| Tag I/O range as Keep | Auto Edit → Tag I/O as keep | ✅ | **Premiere** — protect range (functional). |
| Tag I/O range as Silent demo | Auto Edit → Tag I/O as silent demo | ✅ | **Same** — demo-specific guard (functional). |

### Audit notes — §9 (2026-08-25)

**What a headache user hit:** “Guard” lived on the timeline. Turning it on did not change the transcript, so click-to-hear still looked available and did nothing useful. Esc did not leave the brush. Existing keep/demo ranges were a faint underline. The word “guard” meant nothing.

**What the best apps do:** Photoshop puts the brush on the canvas you paint. Descript’s ignore/protect is labeled on the object. Esc exits the tool.

**What we shipped:**
- Transcript banner while protecting: what to do, Keep / Silent demo, **Done**.
- Timeline button is **Protect**. Esc leaves the brush.
- Painting toasts `Protected 2.4 seconds — Auto Edit will skip this.`
- Protected ranges get a chip in the script. Double-click removes it. A keep/demo on a wordless pause (think-aloud after Clean) sits on the pause chip, not only on a word.
- Selected scene heading **Protect** / **Unprotect** lives on right-click with Rename, Split, and Merge. The chip row only keeps take picks (Use later take / Keep / Put back).

---

## 10. Timeline — navigation & view

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Zoom timeline out | Toolbar −; Ctrl/Cmd+wheel down | ✅ | **Premiere** — zoom slider (UI). |
| Zoom timeline in | Toolbar +; Ctrl/Cmd+wheel up | ✅ | **Premiere** — same. |
| Zoom via slider | Drag timeline zoom range input | ✅ | **Final Cut** — zoom control (UI). |
| Fit timeline to view | Toolbar Fit; `\` (not ⌘\\); palette; right-click tape | ✅ | **Premiere** — `\` fit sequence (functional). |
| Toggle snap | Toolbar **Snap** / **Snap on**; timeline right-click | ✅ | **Final Cut** — magnetic snap dots (best UI feedback). |
| Toggle protect tool from timeline | Toolbar **Protect** | ✅ | **Premiere** — tool palette (UI). |
| Filter edits lane: All | Edits filter “All” (whenever the lane has markers) | ✅ | **GitHub** — timeline filter (UI pattern). |
| Filter edits lane: Open | Edits filter “Open” | ✅ | **Jira** — open items filter (UI). |
| Filter edits lane: Applied | Edits filter “Applied” | ✅ | **GitHub** — closed vs open (UI). |
| Filter edits lane: Scenes | Edits filter “Scenes” | ✅ | **Descript** — scene markers only (functional). |
| Filter edits lane: Protected | Edits filter “Protected” | ✅ | **Auto-Editor** — show keep ranges (functional). |

### Audit notes — §10 (2026-08-25)

**What a headache user hit:** Edits-lane filters hid until there were 9 markers. The last filter said **Guards**. Snap did not say whether it was on. Clicking a scene block selected words but did not open the chapter. Fit had no shortcut and no zoom percent, so “am I at fit?” was a guess.

**What the best apps do:** Premiere `\` fits the sequence and the zoom control has a known 100%. Final Cut snap says when it is magnetic.

**What we shipped:**
- Filters appear as soon as the lane has any markers. **Guards** is **Protected**. Totals say “protected,” not “guards.”
- Snap reads **Snap on** when active. Fit has a tooltip, lights when you are at fit, and shows zoom as % of fit (fit = 100%).
- `\` fits the reel (⌘\\ still splits). Palette and tape right-click also Fit.
- Clicking a scene block selects the chapter (same as the transcript heading) and scrubs there.

---

## 11. Timeline — tracks

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Reveal hidden overlay track | Toolbar + Overlay | ✅ | **Final Cut** — show connected lane (UI). |
| Add new overlay track | Toolbar + Overlay (if none empty); Sequence → Add overlay track; palette | ✅ | **Premiere** — add video track (functional). |
| Add new audio/music track | Toolbar + Audio; palette “Add music track” | ✅ | **Premiere** — add audio track (functional). |
| Reveal/add captions track | Toolbar + Captions | ✅ | **Descript** — captions lane (functional). |
| Mute track | Track mute icon; right-click track → Mute/Unmute | ✅ | **Every NLE** — mute on the track header (UI standard). |
| Hide track from timeline | Track eye-off icon; right-click | ✅ | **Premiere** — eye icon hide track (UI). Hide collapses the lane. **+ Overlay** / **+ Captions** bring that kind of lane back (a filled hide first). **Show Picture** / **Show Voice** appear on the timeline toolbar if you hid those. Undo also works. |
| Lock track (prevent clip moves/trims) | Track lock icon; right-click | ✅ | **Premiere** — lock track (functional). |
| Rename track | Double-click track name; edit; Enter | ✅ | **Reaper** — rename tracks inline (UI). |
| Remove empty non-primary track | Track × button; right-click → Remove empty track | ✅ | **Premiere** — delete empty track (functional). |
| Hide empty V2/V3 by default | Automatic — empty overlay/caption lanes stay collapsed; + Overlay / + Captions reveals | ✅ | **Final Cut** — collapses unused lanes (UI). |

### Audit notes — §11 (2026-08-25)

**What a headache user hit:** Lanes were `V1 Picture` / `A1 Voice` with **M H L** flags. Empty V2/V3 already hid themselves, but the inventory still called that planned. + Overlay had no explanation.

**What the best apps do:** Final Cut names the lane in English. Flags are words or icons you can read with a headache.

**What we shipped:**
- Lane names drop the V1/A1 prefix: Picture, Voice, Overlay, Captions.
- Flags are compact icons (select all, solo, mute, hide, lock) with the word in the tooltip.
- + Overlay / + Audio / + Captions have one-line tooltips. Empty stacks still auto-hide when the last clip leaves.

---

## 12. Timeline — primary & overlay clips

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select clip on timeline | Click clip | ✅ | **Premiere** — click clip select (UI). |
| Move overlay/audio clip along timeline | Drag clip body | ✅ | **Premiere** — drag clip (functional). |
| Move overlay clip by keyboard | Select clip + ←/→ (frame); Shift (1s); Alt (10 frames) with snap | ✅ | **Final Cut** — nudge clip (functional). |
| Trim clip in-point (overlay) | Drag left handle | ✅ | **iMovie** — trim handles (simple UI). |
| Trim clip out-point (overlay) | Drag right handle | ✅ | **iMovie** — same. |
| Trim primary segment in-point (source time) | Drag primary left handle | ✅ | **Premiere** — ripple trim source (functional). |
| Trim primary segment out-point | Drag primary right handle | ✅ | **Premiere** — same. |
| Trim clip in to playhead | Right-click clip; clip inspector primary action | ✅ | **Premiere** — trim to playhead (functional). |
| Trim clip out to playhead | Right-click clip; clip inspector | ✅ | **Premiere** — same. |
| Split primary at playhead | S key; Edit → Razor; right-click; palette | ✅ | **Premiere** — blade tool (functional). |
| Delete selected overlay clip | Delete/Backspace with clip selected | ✅ | **Premiere** — delete clip (functional). |
| Ripple-delete I/O marked range | Delete with marks set; Edit → Cut marked range; timeline **Cut marked**; palette | ✅ | **Premiere** — ripple delete (functional standard). |
| Ripple trim in to playhead | Q; Edit → Trim start to playhead | ✅ | **Premiere** — Q trim (industry standard). |
| Ripple trim out to playhead | W; Edit → Trim end to playhead | ✅ | **Premiere** — W trim (industry standard). |

### Audit notes — §12 (2026-08-25)

**What a headache user hit:** The tape said **Ripple I/O**. Q/W toasts said “ripple trimmed.” Premiere users get it; everyone else swears.

**What the best apps do:** Premiere keeps Q/W muscle memory but the button can say what happens: cut the marked span, close the gap.

**What we shipped:**
- With In/Out set: **Cut marked** (ripple-delete) and **Tighten marked** on the tape.
- Q/W toasts: “Trimmed the start up to here” / “Trimmed the end back to here.”
- Menus and palette use the same words. The mark span tooltip says Cut marked closes the gap.

---

## 13. Timeline — edits lane blocks

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select suggestion from edits lane | Click suggestion block | ✅ | **Descript** — click AI marker (UI). |
| Select scene from edits lane | Click scene block → selects the chapter | ✅ | **Descript** — scene marker (functional). |
| Select guard from edits lane | Click protected block → opens gap inspector | ✅ | **Auto-Editor** — visualize keep ranges (functional). |
| Remove guard tag | Right-click protected block → Remove protection | ✅ | **Auto-Editor** — clear manual range (functional). |
| Paint Keep tag on edits lane | Guard tool + drag on edits lane | ✅ | **Photoshop** — paint mask (UI). |
| Paint Demo tag on edits lane | Guard tool + Demo + drag | ✅ | **Same** — demo-specific paint (UI). |
| Erase guards on edits lane | Guard tool + Alt+drag | ✅ | **Photoshop** — eraser brush (UI metaphor). |
| Shift+drag paint Demo on edits lane | Guard tool + Shift+drag | ✅ | **Same** — modifier for mode (UI). |

### Audit notes — §13 (2026-08-25)

**What a headache user hit:** Lane blocks said KEEP / um / retake jargon. Blocked cuts said “blocked by a guard.” Scene blocks used raw titles that overflowed.

**What the best apps do:** Descript markers are short English (Take 1, Pause). Protected ranges say they will be skipped.

**What we shipped:**
- Keep → **Protected**. Repeat → **Retake**. Pause / Filler / Static / Loud on pending cuts.
- Blocked detail: “protected — Auto Edit skips this.”
- Scene labels: Take N / Demo / first word of the title.
- Right-click a marker: **Go here** and **Hear**. Protected chip: **Remove protection**.

---

## 14. Marks & I/O editing

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Ripple delete between In and Out | See §12 | ✅ | **Premiere** — three-point editing (functional). |
| Tighten gaps inside I/O | Suggest bar **Tighten marked** next to Cut marked; Timeline; Auto Edit; palette | ✅ | **Auto-Editor** — batch tighten range (functional). In–Out shrinks with the saved time so Hear and Export stay on the clip. Toast names **Cut marked** or **Export marked range**. Protected demo stays. |
| Clear In and Out | Suggest bar **Clear marks** after a marked clip; Timeline **Clear marks**; Edit → Clear In and Out; palette; **M** with no word selection | ✅ | **Premiere** — clear in/out (UI). After export, the next hunt starts on the same bar. |

### Audit notes — §14 (2026-08-25)

**What a headache user hit:** Tighten lived only under Auto Edit as “Tighten I/O gaps.” After setting In/Out you still had to hunt a menu.

**What the best apps do:** Premiere puts extract/ripple on the marked span. Auto-Editor tighten is one action on the range you just marked.

**What we shipped:**
- **Tighten marked** appears next to **Cut marked** as soon as In and Out exist.
- **Clear marks** drops In/Out without cutting. Suggest bar (next to **Export marked range**), timeline, Edit menu, palette, and **M** with no selection all run the same helper. Find focuses for the next hunt.
- T toast: “Tightened the marked pauses. Saved N seconds. Protected demo stayed.”

---

## 15. Auto Edit — suggest bar (footer)

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Set pause margin preset Natural (0.22s) | Suggest bar Natural chip (tooltip: leave more air) | ✅ | **Descript** — pause removal presets (UI: no dB numbers). |
| Set pause margin preset Balanced (0.12s) | Suggest bar Balanced chip | ✅ | **Descript** — Balanced/Tight tiers (UI). |
| Set pause margin preset Tight (0.04s) | Suggest bar Tight chip | ✅ | **Descript** — aggressive tighten (UI). |
| Apply all safe pending suggestions | Automatic after Open media / Add take / transcript; suggest bar (“Clean N pauses”, “Apply N safe”) | ✅ | **Descript** — apply all fillers/silence (functional). **Cleanvoice** — one-shot process (UI). Same `applySafeSuggestions` command; Undo or Put back silence restores. Breaths are dismissed (kept in the picture) after first-edit. Silent stills stay in Review as Cut / Keep. |
| Open review drawer | Suggest bar Review N; primary when no safe; Sequence → Review suggestions | ✅ | **Gmail** — review bulk action (UI). Opens the job the bar already named, hears it, and toasts the next pick. After leftovers that is the take. |
| Close review drawer | Drawer **×**; click the dimmed outside; Esc | ✅ | **Linear** — overlay drawer (UI). Same `setReviewing(false)`. The footer only opens Review. |
| Run local scene/retake detection | Suggest bar / palette Find retakes | ✅ | **Descript** — find retakes (functional). Infers scenes, opens Review, and loops the first live or dropped take. Toast says found / none. Hidden once a retake scene is on the reel. |
| Collapse all superseded retakes | Automatic after first edit (second undo); suggest bar Collapse retakes | ✅ | **Descript** — delete previous takes (functional). Same `collapseRetakes` command. Then Review hears the first dropped take so Put back is one listen away. Undo puts retakes back without restoring silence. Keep/demo tags still punch holes. |
| Review leftover breaths after picture leftovers | Suggest bar **Hear breath** / **N breaths**, then **Cut breath** / **Keep breath**; Sequence / palette Review leftover breaths; leftover breath gap chip | ✅ | **Descript** — keep room tone (functional). First-edit no longer dismisses breaths. After quiet picture leftovers, the leftover row names the breath. Cut if it hisses, Keep if the line should breathe. Review → Keep all breaths leaves them in the reel. |
| Review dropped takes after leftovers | Suggest bar Review N retake | ✅ | **Descript** — take card after auto-collapse (UI). After leftover stills/activity/breaths are gone, the bar offers the take. Review hears it, toasts Use later take or Put back, and shows only the take family — leftover leftover stays out. A take pick loops the next take, or closes, deselects the chapter, and names Clean / fillers / Watch so that job can take the row. |
| Open review drawer from project inspector | Project → Open review | ✅ | **Descript** — suggestions list (UI). |

---

## 16. Auto Edit — review drawer (per-item)

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Park playhead on scene | Scene row → Park | ✅ | **Premiere** — go to marker (functional). |
| Drop retake scene (apply) | Scene row → Drop take | ✅ | **Descript** — keep best take (functional). |
| Put back dropped retake scene | Scene row → Put back | ✅ | **Descript** — undo take choice (functional). |
| Keep this take, cut siblings | Scene row → Keep this take | ✅ | **Descript** — compare takes workflow (functional). |
| Park on pending suggestion | Suggestion row → Park | ✅ | **Descript** — scrub to suggestion (UI). |
| Apply pending suggestion | Suggestion row → Apply / Cut / Speed N× / Quiet / Normalize | ✅ | **Descript** — accept AI edit (functional). Silent stills use `applySuggestion` (a review-action cut) so a confirmed still is a normal ripple delete, not a no-op. Quiet static screens use `setSpeed`, which ripples later captions and overlays. Hot spikes use `setRangeVolume` toward −16 LUFS without changing length. |
| Decide a quiet picture leftover | Suggest bar **Hear leftover**, then **Silent demo** / **Speed 4×** / **Cut leftover** / **Keep leftover** / **Quiet leftover** on the bar; leftover chip; Review; Sequence; palette | ✅ | **Screen Studio** — protect a silent walkthrough (functional). Hear leftover is first on a fresh reel (even before Clean). It loops the current leftover and is the only leftover button until you are on one. Decide actions then take the row. Same leftover decision helper: demo tags + dismisses, speed compresses, cut ripples, keep tags + dismisses so Auto Edit skips it. Quiet applies a volume leftover. First-edit no longer treats silence-with-scene-changes as safe dead air. |
| Dismiss / keep pending suggestion | Suggestion row → Keep or Skip (if blocked) | ✅ | **Gmail** — reject suggestion (UI). |
| Revert one applied suggestion | Applied row → Put back one | ✅ | **Descript** — undo single AI change (functional). |
| Revert all applied of type (silence, filler, …) | Applied group → Put back silence / fillers / … | ✅ | **Descript** — bulk undo by category (functional). |

---

## 17. Auto Edit — batch menu / palette

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Rebuild suggestions from analysis | Auto Edit → Rebuild suggestions; palette | ✅ | **Auto-Editor** — re-run analysis (functional). |
| Rebuild intelligence (scenes + suggestions) | Auto Edit → Rebuild intelligence; palette | ✅ | **Descript** — re-analyze (functional). |
| Apply only LLM/model suggestions | Auto Edit → Apply model cuts; palette | ✅ | **Descript** — apply Underlord cuts (functional). |
| Apply safe suggestions (menu) | Auto Edit → Apply safe cuts; palette | ✅ | **Cleanvoice** — auto clean (UI). |
| Put back all silence cuts | Auto Edit / palette | ✅ | **Descript** — restore silence (functional). |
| Put back all filler cuts | Auto Edit / palette | ✅ | **Descript** — restore fillers (functional). |
| Put back all retake/repeat cuts | Auto Edit / palette | ✅ | **Descript** — restore retakes (functional). |
| Enable master normalize −16 LUFS (one-shot menu) | Suggest bar **Normalize** on the finish row next to Export after the first edit; Export sheet **Normalize -16 LUFS**; Auto Edit / palette | ✅ | **Auphonic** — loudness target (functional). **Descript** — normalize toggle (UI). Clean pauses arms it and lights the chip. Click it off to leave the recording as-is. The Export sheet stays the last inspectable step. |

### Audit notes — §15–17 (2026-08-25)

**What a headache user hit:** Review said **Park** and **Drop take**. Scene chips said `retake` / `demo`. Pace chips had no hint. Collapse retakes did not say you could undo from Review.

**What the best apps do:** Descript review plays the take on the row. “Use this take” / “Keep later” is the decision. Presets explain themselves.

**What we shipped:**
- Review rows **Hear** (loop) — click the row or the chip. Park is gone.
- Retake action is **Use later take**. Kinds read Scene / Take N / Silent demo.
- Blocked rows say **protected**. Group totals say “N protected.”
- Pace chip tooltips: leave more air / typical cleanup / cut most silence.
- Collapse retakes tooltip: you can put them back from Review.
- Silent stills are no longer Keep-only. Cut applies `applySuggestion` (ripple delete). Keep dismisses. Talking-over-static and pace notes leave Review via `dismissSuggestions` after first-edit. Leftover breaths stay — after picture leftovers the leftover row says **Hear breath** / **Cut breath** / **Keep breath**. Review opens on the first still so the next decision is a listen, then quiet static screens as **Speed N×** / Keep / **Speed all**, then hot audio as **Quiet** / Keep / **Quiet all**. Talking-over-static stays Keep-only.
- Quiet click-throughs (silence + scene change) are leftovers, not safe cuts. Review opens on those first. Each leftover still or activity is **Silent demo** / **Speed 4×** / **Cut** / **Keep** via `resolveSuggestion` (one undo). Demo and Keep tag the span so a later rebuild skips it.
- After leftovers, the bar offers dropped takes. **Find retakes** / **Collapse retakes** / Review open the first take and loop it. Inspector and transcript chips say **Use later take** / **Put back**, same as Review.

---

## 18. Inspector — contextual helpers (dynamic buttons)

These appear based on selection. Each row is one button label the user may see.

| Action | When shown | Status | Best reference apps |
|--------|------------|--------|---------------------|
| Put back (cut words) | Selected cut words | ✅ | **Descript** — restore (functional). |
| Remove (live words) | Selected live words | ✅ | **Descript** — delete (functional). |
| Remove filler | Selected filler tokens | ✅ | **Descript** — remove filler (functional). |
| All fillers | Filler selected, others exist | ✅ | **Cleanvoice** — remove all ums (UI). |
| Make shorter | Selection >1.2s | ✅ | **Descript** — tighten (functional). |
| Protect (protect selection) | Unguarded selection | ✅ | **Auto-Editor** — keep range (functional). |
| Hear this selection / scene / gap / suggestion / clip | Inspector **Hear** on the object | ✅ | **Descript** — audition from the properties pane (UI). |
| Use later take | Retake scene | ✅ | **Descript** — keep best take (functional). |
| Keep this take | Multi-take family | ✅ | **Descript** — pick take (functional). |
| Put back | Applied retake | ✅ | **Descript** — restore attempts (functional). |
| Remove pause | Gap inspector | ✅ | **Descript** — cut silence (functional). |
| Shorten (pause) | Long pause gap | ✅ | **Descript** — shorten vs remove (UI choice). |
| Mark demo (pause) | Unguarded gap | ✅ | **Screen Studio** — protect demo (functional). |
| Protect (pause) | Unguarded gap | ✅ | **Auto-Editor** — keep (functional). |
| Apply (suggestion) | Safe pending suggestion | ✅ | **Descript** — apply AI edit (UI). |
| Speed N× (suggestion) | Suggest bar **Speed 4×** on a leftover wait; leftover chip; Review; Sequence; palette | ✅ | **Auto-Editor** — speed up static (functional). Speeds the selected leftover, or the first wait in Review. The next leftover loops. Same `resolveSuggestion` speed. |
| Normalize (suggestion) | Loud suggestion | ✅ | **Descript** — normalize clip (functional). |
| Keep (dismiss suggestion) | Review suggestion | ✅ | **Gmail** — dismiss (UI). |
| Skip (blocked suggestion) | Guard-blocked suggestion | ✅ | **GitHub** — skip failing check (UI). |
| Apply N similar | Multiple same-type safe | ✅ | **Descript** — apply all similar (functional). |
| Collapse all retakes | Scene with retake family | ✅ | **Descript** — batch retake collapse (functional). |
| Compare takes | Scene inspector / context menu | 🔶 | **Descript** — A/B take compare (functional leader). Loop A/B 📋 P5. |
| Review next → | Suggestion/gap inspector — hears the next item | ✅ | **GitHub** — next file in review (UI). |
| Next pause → | Gap inspector | ✅ | **Duolingo** — next item queue (UI pattern). |
| Trim start / end to here | Clip inspector (always visible) | ✅ | **Premiere** — trim to playhead (functional). |
| Split at playhead | Clip inspector | ✅ | **Premiere** — split (functional). |

---

## 19. Inspector — words pane adjustments

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Change speaker on selection (dropdown) | Words inspector → Speaker select | ✅ | **Descript** — assign speaker (UI). |
| Edit single word text (field) | Words inspector → Text input | ✅ | **Descript** — inline correction (UI). |
| Protect selection (button) | Words inspector Adjust | ✅ | **Auto-Editor** — keep tag (functional). |
| Mark demo on selection (button) | Words inspector Adjust | ✅ | **Same** — demo tag (functional). |
| Jump to related suggestion | Words inspector → Related edits row | ✅ | **Descript** — linked suggestion (UI). |
| Switch inspector tab to Agent | Tab bar Agent | ✅ | **Cursor** — agent tab (UI). |
| Switch inspector tab to Project/Scene/etc. | Tab bar | ✅ | **Figma** — context panel tabs (UI). |

---

## 20. Inspector — project pane

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Toggle Advanced project settings | Advanced / Hide advanced | ✅ | **iOS Settings** — Advanced footer (UI). |
| Pick export encoder | Advanced → Encoder dropdown | ✅ | **HandBrake** — codec picker with HW hint (UI). |
| Rename speaker (Advanced list) | Advanced → speaker text fields | ✅ | **Descript** — speaker rename (functional). |
| Adjust cut pad slider (Advanced) | Advanced → Cut pad slider | ✅ | **Auto-Editor** — margin slider (functional). |
| Adjust master volume | Advanced → Master slider | ✅ | **Descript** — master gain (UI). |
| Adjust master fade in/out | Advanced sliders | ✅ | **Audacity** — fade handles (UI). |
| Adjust master 3-band EQ | Advanced Low/Mid/High | ✅ | **Logic** — visual EQ (UI leader; SpeechEdit uses sliders). |
| Toggle master compressor | Advanced checkbox | ✅ | **Descript** — Studio Sound bundle (UI simpler). |
| Toggle master normalize LUFS | Advanced checkbox | ✅ | **Auphonic** — loudness normalize (functional). |
| Adjust duck-under-B-roll amount | Advanced Duck slider | ✅ | **Descript** — auto-duck music (functional). |
| Open review from project pane | Open review button | ✅ | **Descript** — pending edits list (UI). |

---

## 21. Inspector — picture / clip pane (Advanced transform)

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Toggle Transform & fades section | Clip inspector Advanced | ✅ | **Final Cut** — inspector disclosure (UI). |
| Adjust clip X position | Transform slider | ✅ | **Final Cut** — on-screen drag (UI leader); sliders functional. |
| Adjust clip Y position | Transform slider | ✅ | **Same**. |
| Adjust clip scale | Transform slider | ✅ | **Screen Studio** — zoom scale (functional). |
| Adjust clip rotation | Transform slider | ✅ | **Premiere** — rotation dial (UI). |
| Adjust clip opacity | Transform slider | ✅ | **Premiere** — opacity (functional). |
| Adjust clip fade in/out | Fade sliders | ✅ | **Audacity** — fade in/out (UI). |
| Adjust clip crop (uniform) | Crop slider | ✅ | **Final Cut** — crop handles (UI leader). |
| Adjust primary segment speed | Speed slider (primary only) | ✅ | **Final Cut** — retime (UI). |
| Add transform keyframe at playhead | “Add keyframe here” button | ✅ | **Premiere** — keyframe diamond (functional). |
| Adjust clip volume | Clip volume slider | ✅ | **Reaper** — per-item volume (functional). |
| Show trim/split without opening Advanced | Clip inspector — trim/split sit above Transform | ✅ | **iMovie** — clip selected → handles only (UI). |
| Mute clip | Clip inspector checkbox; right-click clip | ✅ | **Premiere** — mute clip (UI). |
| Adjust clip volume without Advanced | Clip inspector volume slider | ✅ | **iMovie** — volume on the selected clip (UI). |

### Audit notes — §18–21 (2026-08-25)

**What a headache user hit:** Inspector told you what the object was and offered Remove, but you could not hear it from the pane. Review next only parked. Clip trim said “(in)/(out).” Volume and mute lived under Transform. Mute clip existed only on the command bus.

**What the best apps do:** Descript’s side pane plays the highlight. Premiere mute/volume sit on the clip, not behind Motion. iMovie shows trim without opening an Advanced disclosure.

**What we shipped:**
- Every inspector object has **Hear**. Related edits and Review next also play.
- Word helper **Protect** (was Keep). Clip: **Trim start to here** / **Trim end to here**, volume + **Mute clip** always visible.
- Project Advanced pace chips use the same hints as the suggest bar. “Cut pad” is **Pause padding**.

---

## 22. Inspector — captions pane

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Generate captions from live words | Suggest bar **Caption remaining** after a first edit; Caption tab; Sequence; palette | ✅ | **CapCut** — auto captions one tap (UI leader). **Descript** — from transcript (functional). Open media and Open transcript build caption clips from live words (program time, one undo). Speech islands do not caption. Handmade titles and edited cards stay; remaining words fill around them. Caption remaining parks the first new block on the picture without selecting it, so Watch / Export stay on the row. Fixing a transcript word patches the auto card that covers it — no caption project. |
| Add scene lower thirds | Suggest bar **Chapter names** after first edit; Caption tab; Sequence; palette | ✅ | **Descript** — chapter titles (functional). Same `addLowerThirds` as Sequence. Opens the first name on the picture to type. **Enter** keeps the heading and opens the next card. The last name stays selected so Fill / Apply style stay on the tape. Escape cancels. |
| Edit selected caption text | Caption textarea | ✅ | **Kapwing** — inline caption edit (UI). |
| Change caption font size | Size slider | ✅ | **CapCut** — style size preset (UI). |
| Change caption align (left/center/right) | Align dropdown | ✅ | **Kapwing** — alignment control (UI). |
| Change caption screen position (lower/center/upper) | Position dropdown | ✅ | **CapCut** — position templates (UI). |
| Change caption fill color | Fill swatch + hex | ✅ | **Kapwing** — color picker (UI). |
| Change caption stroke color | Stroke swatch + hex | ✅ | **Kapwing** — outline color (UI). |
| Apply caption style to all title clips | Fill / Stroke / **Apply style** on the tape with the card; suggest bar when a title is selected; Caption tab; Sequence; palette | ✅ | **CapCut** — apply to all captions (UI). Copies fill, stroke, and size only — a title does not smash a lower third. The next card plays. Toast names the count and Export. Zoom and redaction stay out. |

### Audit notes — §22 (2026-08-25)

**What a headache user hit:** Fill and Stroke were hex strings. Kapwing and CapCut show a swatch you click.

**What we shipped:** Fill and Stroke are a color picker plus the hex field on the card (inspector keeps hex). **Apply style** copies look, not seat. The next card plays. Hear plays the selected title.

---

## 23. Sequence / graphics — add at playhead

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Add title clip (3s default) | Suggest bar **Add title** on the finish row until one exists; Sequence; palette | ✅ | **Final Cut** — titles browser (UI). First title is a card at 0. Another follows the playhead. Same `addTitle` command. Type on the picture. After the subject, Watch / Export return. |
| Add zoom region (1.45×) | Suggest bar **Add zoom** on a selected chapter or words; Sequence; palette; word chips | ✅ | **Screen Studio** — auto zoom (functional). **Tella** — zoom blocks (UI). Covers selected words or the selected chapter; otherwise 3s at the playhead. Loops the punch-in. Scale is **1.2× / 1.45× / 2×** on the monitor, not Transform. A zoom clip is not a title — Apply style stays off. |
| Add lower third (3s) | Suggest bar **Add lower third** on the finish row until one exists; selected words / chapter; Sequence; palette | ✅ | **Premiere** — lower third MOGRT (functional). Same `addTitle` + `lower-third` preset as title. Covers selected words or chapter. First name follows an opening title if the playhead is still on that card; otherwise 3s from the playhead. Prefills the speaker. Type it, then Fill. |
| Add blur redaction | Suggest bar **Add redaction** on a selected chapter or words; Sequence; palette; inspector | ✅ | **Descript** — blur face (functional). **YouTube Studio** — face blur (UI). Covers selected words or the selected chapter; otherwise 4s at the playhead. Loops the stretch. The box is on the picture — drag it; Small / Med / Large sizes it. A redaction is not a title. |
| Add cross-dissolve at playhead (0.4s) | Sequence → Dissolve at playhead; palette | ✅ | **Final Cut** — default cross dissolve (UI). |
| Fade in selected clip 0.4s | Palette (clip selected) | ✅ | **Audacity** — fade in (functional). |
| Fade out selected clip 0.4s | Palette (clip selected) | ✅ | **Audacity** — fade out (functional). |
| Import B-roll still/video at playhead | Suggest bar **Add B-roll**; Sequence; palette | ✅ | **Descript** — B-roll lane insert (functional). Same `addBroll`. Face cam / still lands silent (volume 0) in the lower-right (same Bottom right look as Picture) so it does not cover the walkthrough or duck the voice. Covers selected words or chapter, or 6s from the playhead. |
| Import music bed at playhead | Suggest bar **Add music**; Sequence; palette | ✅ | **Descript** — music under voice (functional). Same `addAudio`. Covers selected words or chapter, or from the playhead to the end (capped by the file). Fades 0.4s. Volume 0.35. Toast points at clip volume. |

### Audit notes — §23 (2026-08-25)

**What a headache user hit:** Sequence → Add title dropped a 3s clip on a hidden lane and selected nothing. You had to hunt the tape.

**What the best apps do:** Final Cut / CapCut select the new title and put you in the text field. Duration is on the command.

**What we shipped:**
- Menu says **3s at playhead** for a title. A toast names what landed.
- Adding a title, zoom, lower third, captions, B-roll, music, or redaction selects the new clip and opens Caption or Picture.
- Adding a title seeks to the card and opens a field on the picture. The first keystroke is the subject. Double-click or right-click → Type… to edit again. The inspector Text field is still there. **Add title** sits on the finish row (Watch / Export) until an opening title exists — not only in More.
- **Add zoom** uses the selected words or chapter when those are the context, so a client-demo punch-in is not a 3s guess at the playhead. On a selected chapter it sits on the row. The punch-in loops; **1.2× / 1.45× / 2×** are on the monitor.
- **Add lower third** sits on the finish row until one name exists — same as Add title. A name card is not a title: it does not steal the opening-title slot. After **Add title** at 0, the first name lands at 3s if you are still on the card. Selected words or a chapter cover that beat. The speaker name is already on the card; type the product over it, then Fill.
- Clicking Add zoom on the suggest bar no longer clears the chapter. A selected retake heading does not steal the punch-in. Playhead inside a silent demo covers that walkthrough. The selected chapter also shows **Add zoom** and **Add redaction** on the heading. Redaction uses the same span as zoom (words / chapter / 4s playhead), loops the stretch, and puts the box on the picture — drag it; **Small / Med / Large** size it. A redaction is not a title.

---

## 24. Models & intelligence settings (Project Advanced)

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select transcript provider preset | Models → Transcript dropdown | ✅ | **MacWhisper** — model picker (UI). **Ollama** — local model select (functional). |
| Set CLI/ASR model name | Models → CLI model field | ✅ | **Whisper CLI** — model arg (functional). |
| Set OpenAI-compatible ASR URL | Models → ASR URL | ✅ | **OpenAI API** — base URL config (functional). |
| Set ASR API key | Models → ASR key | ✅ | **Standard API settings** — password field (UI). |
| Select intelligence (LLM) preset | Models → Intelligence dropdown | ✅ | **Cursor** — model picker (UI). |
| Set LLM URL / model / key | Models fields | ✅ | **Ollama** — endpoint config (functional). |
| Re-transcribe current media (force) | Models → Transcribe again | ✅ | **Descript** — re-transcribe (functional). |
| Open Assistant | Inspector → Assistant; Edit → Ask Assistant; command palette; Ctrl/Cmd+J | ✅ | **Descript** — Underlord prompt (functional). **Cursor** — one persistent agent surface (UI). |

### Audit notes — §24 (2026-08-25)

**What a headache user hit:** Assistant actions were split between settings and an overlay, so it was unclear where requests, progress, results, and follow-ups lived.

**What we shipped:**
- Advanced contains only provider configuration, discovery, testing, and re-transcription.
- Every Assistant entry point opens the Inspector's Assistant tab and focuses the same prompt.
- Activity, results, tool actions, and contextual follow-ups all stay in that tab; successful edits apply immediately and say so plainly.

---

## 25. Inspector Assistant — natural language actions

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Run quick intent: Auto-cut the reel | Assistant quick action | ✅ | **Descript** — remove silence/filler batch (functional). |
| Run quick intent: Auto-cut, keep tagged demo | Assistant quick action | ✅ | **Auto-Editor** — boolean keep (functional). |
| Run quick intent: Cut product-name fumble | Assistant quick action | ✅ | **Descript** — “remove ums and stumbles” (functional). |
| Run quick intent: Find scenes / retakes | Assistant quick action | ✅ | **Descript** — scene pass (functional). |
| Run quick intent: Collapse retakes | Assistant quick action | ✅ | **Descript** — retake collapse (functional). |
| Run quick intent: Put back silence | Assistant quick action | ✅ | **Descript** — undo silence removal (functional). |
| Type a custom request | Assistant textarea + Send request; Ctrl/Cmd+Enter | ✅ | **Cursor** — agent prompt (UI). **WeftCut** — NL timeline edit (functional). |
| View activity and tool actions | Inspector Assistant activity feed | ✅ | **Cursor** — tool trace (UI transparency). |
| Ask a contextual follow-up | Click a completed activity result, then Ask follow-up | ✅ | **Cursor** — continue from a prior result (functional). |
| View live editorial brief | Agent brief pre block | ✅ | **WeftCut** — context resource (functional). |
| Preview agent recipe before apply | Agent **Will:** line under Ask, live as you type | ✅ | **Terraform plan** — preview before apply (UI). |

### Local intent parser (no LLM) — utterances that execute immediately

| Action | Example phrase | Status | Best reference apps |
|--------|----------------|--------|---------------------|
| Keep specific take by index | “keep take 2 of intro” | ✅ | **Descript** — take picker (functional). |
| Rebuild intelligence | “rebuild intelligence” | ✅ | **Descript** — re-analyze (functional). |
| Find scenes without cutting | “find scenes and mark retakes” | ✅ | **Descript** — scene markers (functional). |
| Collapse retakes | “collapse retakes” | ✅ | **Descript** — batch retake (functional). |
| Generate captions | “caption remaining words” | ✅ | **CapCut** — auto captions (UI). |
| Add lower thirds | “lower thirds” / “chapter titles” | ✅ | **Descript** — chapter titles (functional). |
| Rebuild suggestions | “rebuild suggestions” | ✅ | **Auto-Editor** — re-analyze (functional). |
| Auto-cut respecting demo tags | “auto-cut but skip silent demo” | ✅ | **Auto-Editor** — conditional cut (functional). |
| Auto-cut full reel | “auto-cut the reel” | ✅ | **Descript** — one-click clean (UI). |
| Apply model cuts | “apply model cuts” | ✅ | **Descript** — apply AI (functional). |
| Apply safe cuts | “apply safe edits” | ✅ | **Cleanvoice** — process (UI). |
| Revert silence/filler/retake types | “put back silence/fillers/retakes” | ✅ | **Descript** — category undo (functional). |
| Tighten range | “tighten” (+ optional quote) | ✅ | **Auto-Editor** — margin (functional). |
| Cut quoted phrase(s) | “cut ‘you know’” | ✅ | **Descript** — search + delete (functional). |
| Cut section about topic | “remove the part about Docker” | ✅ | **Descript** — delete range by topic (functional). |
| Tag quoted span as keep/demo | “protect demo ‘settings screen’” | ✅ | **Auto-Editor** — manual keep (functional). |
| Tag all demo scenes | “keep silent walkthrough” | ✅ | **Screen Studio** — demo sections (functional). |
| Cut all filler suggestions | “remove fillers” | ✅ | **Descript** — remove filler words (functional). |

### Audit notes — §25 (2026-08-25)

**What a headache user hit:** The recipe preview dumped command types (`applySafeSuggestions → collapseRetakes`). The hint said “guarded.”

**What we shipped:**
- Typed Ask shows **Will:** plus the plain-language `note` (or why there is no local plan).
- Hint says **protected**. Ask focuses when you open Agent.

---

## 26. Context menu (right-click) actions

| Surface | Actions | Status | Best reference apps |
|---------|---------|--------|---------------------|
| Word | Dynamic edit choices, Edit text, Copy, Select sentence, Select paragraph, Go here | ✅ | **Descript** — right-click script (UI). **macOS** — contextual menu (UI). |
| Gap / pause | Same as gap inspector actions | ✅ | **Descript** — gap menu (functional). |
| Scene | Rename, Mark clip, Split, Merge, Protect; then take/remove/zoom/redact; Compare takes | ✅ | **Descript** — scene context (functional). Shape tools are not sprayed on the heading. |
| Clip | Type… on a title/caption/name (writes on the picture); Copy caption text (if any), Trim start/end to here, Split, Go to clip start, Mute clip | ✅ | **Premiere** — clip context menu (UI standard). **CapCut** — tap text on the preview (UI). |
| Edit block | Go here; Hear; suggestion actions; Remove protection; scene menu | ✅ | **GitHub** — timeline event menu (UI). |
| Track | Mute/Unmute, Hide/Show, Lock/Unlock, Remove empty | ✅ | **Premiere** — track header menu (functional). |
| Speaker chip | Rename; Remove (disabled on the last voice) | ✅ | **Descript** — speaker context (functional). Words they owned move to the remaining voice. |
| Note chip | Type…; Remove | ✅ | **Premiere** — marker comment (functional). Same `setTagLabel` as the inspector. |
| Transcript empty area | Clear selection, Select all, Command palette | ✅ | **Standard** — pane context menu (UI). |
| Timeline empty area | Fit timeline, Split at playhead, Snap toggle, Protect words, Command palette | ✅ | **Premiere** — timeline menu (functional). |
| App chrome | Undo, Redo, Command palette, Export/Cancel export | ✅ | **macOS** — universal backstop (UI). |

### Audit notes — §26 (2026-08-25)

**What a headache user hit:** Right-click said **Park playhead** and **Remove guard**. Tape menu had no Fit.

**What we shipped:**
- Word/clip/marker: **Go here**. Marker also **Hear**. Protected chip: **Remove protection**.
- Clip: **Trim start/end to here**, **Mute clip** on overlays.
- Tape empty area: **Fit timeline** (`\`).

---

## 27. MCP / external agent (Cursor, etc.)

User runs `bun run mcp`; external agent invokes tools. Listed as user-achievable outcomes.

| Action | MCP tool / effect | Status | Best reference apps |
|--------|-------------------|--------|---------------------|
| Read full editorial brief | `get_context` | ✅ | **WeftCut** — context resource (functional). |
| Read word-level transcript | `get_transcript` | ✅ | **WeftCut** — same (functional). |
| Search transcript phrase | `search_transcript` | ✅ | **Descript** — search (functional). |
| Read timeline summary | `get_timeline` | ✅ | **WeftCut** — project JSON (functional). |
| Read pending suggestions | `get_suggestions` | ✅ | **Auto-Editor** — suggestion list (functional). |
| Read keep/demo guards | `get_tags` (protected / silent-demo ranges) | ✅ | **Auto-Editor** — keep ranges (functional). |
| Read scenes/retakes | `get_scenes` | ✅ | **Descript** — scenes API (conceptual). |
| Read program vs source stats | `get_program` | ✅ | **WeftCut** — duration stats (functional). |
| Apply arbitrary command object | `apply_command` | ✅ | **WeftCut** — command bus (functional). |
| Delete source range | `delete_range` / `cut_range` | ✅ | **Auto-Editor** — cut (functional). |
| Toggle word cut state | `toggle_words` | ✅ | **Descript** — word delete (functional). |
| Restore source range | `restore_range` | ✅ | **Descript** — restore (functional). |
| Cut/restore by phrase | `cut_words` / `restore_words` | ✅ | **Descript** — search delete (functional). |
| Cut sentence / previous sentence | `cut_sentence` / `cut_previous_sentence` | ✅ | **Descript** — sentence ops (functional). |
| Tighten range | `tighten` | ✅ | **Auto-Editor** — margin (functional). |
| Apply safe suggestions | `apply_safe_edits` | ✅ | **Descript** — batch clean (functional). |
| Apply/dismiss/revert one suggestion | `apply_suggestion` / `dismiss_suggestion` / `revert_suggestion` | ✅ | **Descript** — granular AI undo (functional). |
| Revert suggestion type | `revert_suggestion_type` | ✅ | **Descript** — category undo (functional). |
| Add/erase/remove guard tag | `add_tag` / `erase_tag` / `remove_tag` | ✅ | **Auto-Editor** — keep ranges (functional). |
| Set I/O marks | `set_marks` | ✅ | **Premiere** — marks (functional). |
| Split at source time | `split_at` | ✅ | **Premiere** — blade (functional). |
| Ripple delete range / I/O | `ripple_delete` / `ripple_delete_marks` (cut marked range) | ✅ | **Premiere** — ripple (functional). |
| Set word text / speaker | `set_word_text` / `set_speaker` | ✅ | **Descript** — correct script (functional). |
| Scene/retake ops | `collapse_retakes`, `keep_take`, `infer_scenes`, `rename_scene`, … | ✅ | **WeftCut** — agent edits (functional). |
| Generate captions / titles | `generate_captions`, `add_title`, … | ✅ | **WeftCut** — tool surface (functional). |
| Run LLM intelligence pass | `run_intelligence` / `edit_with_intent` | ✅ | **OpenScene** — agent edit (functional). |

### Audit notes — §27 (2026-08-25)

**What a headache user (or agent) hit:** Tool blurbs said “guards” and “I/O.” An external agent would repeat that jargon in the UI.

**What we shipped:** Descriptions now say protected / silent-demo ranges, In/Out marks, and “cut the marked range.”

---

## 28. Second pass — missed shipped actions

Actions present in code/UI but omitted from the first audit.

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Auto-resume last saved project on launch | App start → `hydrateWorkspace` reads session | ✅ | **VS Code** — reopen last folder (UI). **Logic** — restore last project (functional). |
| Warn before closing tab with unsaved edits | Browser `beforeunload` when dirty | ✅ | **Google Docs** — leave site warning (UI). |
| Auto-save project to disk cache on hide | Tab background / `pagehide` → `flushWorkspace` | ✅ | **Figma** — autosave without asking (functional). |
| Prime program playback after user gesture | First click/keydown unblocks autoplay policy | ✅ | **Every web video app** — click-to-unmute pattern (UI). |
| Cancel inline word edit without saving | Escape while editing word | ✅ | **Google Docs** — Escape reverts field (UI). |
| Confirm word edit | Enter in word edit field | ✅ | **Descript** — inline transcript edit (functional). |
| Run top palette match with Enter | ⌘K → type → Enter | ✅ | **VS Code** — command palette (UI). |
| Close palette without running | Escape; click backdrop | ✅ | **VS Code** — same. |
| Dismiss context menu | Escape; click backdrop; scroll; resize | ✅ | **macOS** — standard menu dismiss (UI). |
| Set pause margin from Project Advanced | Advanced → Natural/Balanced/Tight chips | ✅ | **Descript** — pause presets in settings (UI). |
| Fine-tune pause padding (slider) | Advanced → Fine-tune padding | ✅ | **Auto-Editor** — `--margin` numeric (functional). |
| Switch inspector to Project tab | Tab bar click | ✅ | **Figma** — properties panel tabs (UI). |
| Switch inspector to Agent tab | Tab bar / ⌘J dock | ✅ | **Cursor** — agent side panel (UI). |
| Switch inspector to Picture tab | Select clip → tab | ✅ | **Premiere** — Effect Controls (UI). |
| Switch inspector to Caption tab | Select caption → tab | ✅ | **Kapwing** — caption panel (UI). |
| Switch inspector to Job tab | Auto during import/export | ✅ | **Final Cut** — background task HUD (UI). |
| Read live editorial brief (scroll) | Agent panel `<pre>` block | ✅ | **WeftCut** — context dump for agents (functional). |
| Read agent turn history (last 8) | Agent log list | ✅ | **Cursor** — tool trace per turn (UI). |
| Download sidecar file in web build | Palette export → browser download | ✅ | **Kapwing** — download SRT (UI). |
| Save sidecar file via dialog (Electron) | Palette export → native save path | ✅ | **Premiere** — export subtitles to file (UI). |
| Pick B-roll via hidden file input (web) | Sequence → Add B-roll (web path) | ✅ | **Browser** — `<input type=file>` (functional). |
| Pick music via hidden file input (web) | Sequence → Add music bed (web path) | ✅ | **Same**. |
| Import captions-only onto timeline | Import timeline → `.srt`/`.vtt` | ✅ | **Premiere** — import captions (functional). |
| Import OTIO timeline | Import timeline → `.otio` | ✅ | **Resolve** — OTIO import (functional). |
| Import FCPXML timeline | Import timeline → `.fcpxml` | ✅ | **Final Cut** — XML import (functional). |
| Import Premiere XML timeline | Import timeline → `.xml` | ✅ | **Premiere** — XML (functional). |
| Import Shotcut MLT timeline | Import timeline → `.mlt` | ✅ | **Shotcut** — native (functional). |
| Import Kdenlive project | Import timeline → `.kdenlive` | ✅ | **Kdenlive** — native (functional). |
| Import Auto-Editor JSON timeline | Import timeline → `.json` chunks | ✅ | **Auto-Editor** — v3 JSON (functional). |
| View program + source timecode (read-only) | Monitor transport labels | ✅ | **Premiere** — dual timecode (UI). |
| View current word under picture | Monitor “now word” strip | ✅ | **Descript** — karaoke highlight (UI). |
| View ducking indicator | Monitor “duck −N%” when ducked | ✅ | **Descript** — auto-duck indicator (UI). |
| View toast notification (auto-dismiss) | Bottom toast after actions | ✅ | **Android** — snackbar (UI pattern). |
| Zoom timeline with Ctrl/Cmd+wheel | Wheel over timeline body | ✅ | **Premiere** — scroll zoom (UI). |
| See “no markers match filter” on edits lane | Filter edits when zero matches — copy says what to do next | ✅ | **GitHub** — empty filter state (UI). |
| Sync settings to Electron main on change | Models panel edits → `host.syncSettings` | ✅ | **VS Code** — settings sync (functional). |
| Check ASR binary install status | Models panel provider labels (“not installed”) | ✅ | **Homebrew** — dependency hint (UI pattern). |

### Audit notes — §28 (2026-08-25)

**What a headache user hit:** Edits-lane empty filter said only “No markers match this filter.” The lane tooltip still said Guards.

**What we shipped:**
- Empty filter copy tells the next move (Open / Applied / Find retakes / Protect).
- Lane tooltip: protected ranges, not guards.
- Session restore, unsaved close warning, palette Enter/Escape, inspector tabs, and now-word/toast already match the reference apps — left those.

---

## 29. Command-bus only (no direct UI — MCP, agent, import pipeline)

These exist in `applyCommand` or run automatically; users cannot trigger them from menus yet.

| Action | How it runs today | Status | Best reference apps |
|--------|-------------------|--------|---------------------|
| Ripple-delete arbitrary source range | Transcript Delete; Cut marked; MCP `ripple_delete` | ✅ | **Premiere** — ripple delete selection (UI). |
| Replace entire transcript words | MCP `set_transcript`; import overwrites | 🔶 | **Descript** — replace transcript (functional). |
| Import caption file to V3 (command) | File → Import timeline (`.srt`/`.vtt`); MCP `import_captions` | ✅ | **Premiere** — import SRT to track (UI). |
| Apply speaker diarization assignments | Auto on import; MCP `apply_diarization` | 🔶 | **Descript** — speaker ID (functional). |
| Merge LLM scene/suggestion draft | Agent/`mergeIntelligence` internally | 🔶 | **Descript** — Underlord merge (functional). |
| Replace whole project JSON | Agent replace; import timeline | 🔶 | **WeftCut** — agent project swap (functional). |
| Set global picture transform (not clip) | Project → Advanced → Master picture sliders | ✅ | **Premiere** — motion on master clip (UI). |
| Mute/unmute single clip | Clip inspector + right-click; MCP `setMuted` | ✅ | **Premiere** — clip mute (UI). |
| Set/clear proxy path on asset | Auto on import; Advanced shows “lighter preview”; MCP `setAssetProxy` | 🔶 | **Premiere** — proxy toggle (UI). |
| Patch waveform / thumbs / proxy after import | `setAssetLooks`; Open media replays this | ✅ | **Descript** — looks fill in after the reel is already open (functional). |
| Attach silence / loudness after the reel is open | `setAnalysis` + rebuild; Open media replays this | ✅ | **Descript** — analysis lands on an already-editable composition (functional). |
| Fill one take’s words / analysis after it is already on the reel | `attachTakeIntel`; Open media and Add take replay this | ✅ | **Descript** — a second take’s transcript lands without wiping the first (functional). Growing ASR replaces in-span words when the new list is longer; a dropped or edited transcript is not overwritten by a same-span attach. |
| Relink asset by id+path (command) | Missing banner / inspector Relink…; MCP `relinkAsset` | ✅ | **Premiere** — relink (UI). |
| Paint Note guard tag | **Note** on the word/heading row; Timeline **Note**; Protect → Note paint; Edit → Note at playhead; palette | ✅ | **Premiere** — marker comments (UI). Click the line — **Note** on the bar drops the chip and focuses **hook, ask, or why you parked**. A heading highlight parks on the playhead word, not the whole chapter. Silent headings get the chip on the chapter. Double-click or right-click → **Type…**. Right-click → **Remove**. Save toast names **N** to hop back; `hook` also names **Mark clip**. **N** / **Shift+N** hops and names the next mark. Inspector **Note** field is the same label. |
| Toggle ripple vs insert mode | Timeline **Ripple on** / **Lift** — Delete follows the mode | ✅ | **Premiere** — ripple/insert toggle (UI). |
| Read source↔program cut mapping | MCP `get_mapping` | ✅ | **WeftCut** — EDL introspection (functional). |
| Read cuts with program times | MCP `get_cuts` | ✅ | **Auto-Editor** — cut list (functional). |
| Read compact project snapshot | MCP `get_snapshot` | ✅ | **WeftCut** — slim JSON (functional). |
| Read current selection + marks | MCP `get_selection` | ✅ | **Cursor** — selection context (functional). |
| Set speed on source range | Picture inspector Speed slider (primary); MCP `set_speed` | ✅ | **Final Cut** — retime tool (UI). |
| Add caption at time (MCP params) | Sequence → Add title; MCP `add_caption` | ✅ | **Descript** — add caption block (UI). |
| Add zoom at time (MCP params) | Sequence → Add zoom; MCP `add_zoom` | ✅ | **Screen Studio** — add zoom keyframe (UI). |
| Replace scenes array wholesale | MCP `set_scenes` | 🔶 | **Descript** — chapter list edit (UI). |
| Run intelligence endpoint directly | MCP `run_intelligence` | 🔶 | **Descript** — analyze pass (functional). |
| Run freeform intent string | Agent Ask; MCP `edit_with_intent` | ✅ | **Agent panel** — same (UI exists via Agent). |

### Audit notes — §29 (2026-08-25)

**What a headache user hit:** Master picture, notes, and “is this insert or ripple?” had no place to click.

**What we shipped / corrected:**
- Project Advanced → **Master picture** (scale / X / Y / rotation / opacity).
- **Note** on the tape and in Protect paint. Auto Edit ignores notes.
- Timeline **Ripple on** / **Lift** — Delete, X, and Cut marked follow the mode. Lift parks a program hold.
- Proxy: Advanced says when a lighter preview is in use. Path still auto-managed.
- Still MCP/agent-only: wholesale `set_scenes` / `set_transcript`, diarization merge, `run_intelligence`, replace-project JSON.

---

## 30. Should have — core editing & timeline (standard NLE)

| Action | How to invoke / gap | Status | Best reference apps |
|--------|---------------------|--------|---------------------|
| Toggle Insert vs Ripple edit mode | Timeline **Ripple on** / **Lift**. Delete, X, and Cut marked follow the mode. | ✅ | **Premiere** — toggle (UI). **Avid** — insert/overwrite (functional). |
| Duplicate selected clip/segment | Clip inspector **Duplicate clip**; right-click; palette | ✅ | **Premiere** — Alt+drag (UI). |
| Nudge clip one frame with visible shortcut hints | ← → on a selected clip; inspector **← Frame / Frame →**; Shift 1s · Alt 10 frames | ✅ | **Final Cut** — comma/period (UI). |
| Slip clip (move media inside trim) | Alt-drag the clip; inspector **Slip ← / Slip →** | ✅ | **Premiere** — slip tool (functional). |
| Slide edit (move cut point) | Shift-drag the clip body (neighbors absorb) | ✅ | **Premiere** — slide tool (functional). |
| Roll trim (shared boundary) | Shift-drag a clip handle | ✅ | **Premiere** — roll tool (functional). |
| Lift extract (leave gap vs ripple) | **Lift marked**; Delete with **Lift** mode; gap inspector **Lift pause** | ✅ | **Premiere** — lift vs extract (functional). |
| Select all clips on track | Track rail select-all icon; palette | ✅ | **Premiere** — select track (UI). |
| Link / unlink audio-video | Derived V1/A1 stay linked | 📋 | **Premiere** — chain icon (UI). |
| Nest selection into compound clip | Not in live app | 📋 | **Final Cut** — compound clip (functional). |
| Copy/paste clip attributes | ⌘⇧C / ⌘⇧V; inspector **Paste look** | ✅ | **Final Cut** — paste attributes (UI). |
| Copy/paste clip at playhead | ⌘C / ⌘V; inspector **Copy / Paste here**; right-click | ✅ | **Premiere** — clipboard edit (functional). |
| Multi-select clips | Shift / ⌘-click clips; Delete and ← → apply to the set | ✅ | **Premiere** — shift-select (UI). |
| Razor tool in toolbar (visible) | Timeline **Split** (S) | ✅ | **Premiere** — tool palette (UI). |
| Split clip at playhead from one-click UI | Timeline **Split**; inspector **Split at playhead** | ✅ | **iMovie** — split button (UI). |
| Delete gap / close gap manually | Select a hold → inspector **Close gap**; pause chip still ripples | ✅ | **Premiere** — delete ripple gap (functional). |
| Extend edit to playhead (E key) | **E**; inspector **Extend to playhead** (overlay / bed / caption) | ✅ | **Premiere** — extend edit (functional). |
| Match frame / open clip in source | Monitor **Match**; palette “Match frame” — selects the word at this source frame | ✅ | **Premiere** — match frame (UI). One program monitor; Match finds the script line. |
| Copy current frame | Suggest bar **Copy frame** on a selected chapter or words; monitor **More**; Sequence; palette; inspector / Find **Hit** | ✅ | **QuickTime** — copy frame (functional). Parks on the selected words or chapter first. A chapter card names the step (not the reel). Clipboard first; a PNG if copy is blocked — toast says to paste or drop the file. |
| Source monitor separate from program | One program monitor | 📋 | **Premiere** — dual monitor (UI). |
| Scrub audio while dragging playhead | Playhead seeks; no shuttle scrub | 📋 | **Pro Tools** — scrub (functional). |
| Snapping toggle with audible/visual tick | Timeline **Snap on** | ✅ | **Final Cut** — snap feedback (UI). |
| Markers generic (not just I/O) | **Note** on the word/heading row; Timeline **Note**; Protect → Note paint | ✅ | **Premiere** — markers panel (UI). |
| Clear In / Clear Out / Clear both marks | **Clear marks** — see §14 | ✅ | **Premiere** — clear in/out (UI). |
| Go to next / previous marker | **N** / **Shift+N**; timeline **Note › / ‹ Note**; Edit menu; palette | ✅ | **Premiere** — shift+M (functional). |
| Replace timeline clip media | Overlay / bed inspector **Replace footage** | ✅ | **Premiere** — replace footage (UI). |
| Freeze frame | Not in live app | 📋 | **Final Cut** — hold frame (UI). |
| Reverse clip | Speed slider; no reverse | 📋 | **Premiere** — reverse speed (functional). |
| Detach audio from video | Export audio-only instead | 🔶 | **Premiere** — unlink (UI). |
| Volume keyframes on clip | Clip volume slider only | 📋 | **Audacity** — envelope (UI). |
| Pan / stereo balance | Clip inspector **Pan** (−1…1); export `stereotools` | ✅ | **Logic** — pan knob (UI). |
| Mute clip button in inspector | Mute clip checkbox + right-click | ✅ | **Premiere** — mute clip (UI). |
| Solo track / solo clip | Track rail headphone icon (radio; export respects it) | ✅ | **Reaper** — solo (UI). |
| Transition browser (crossfade, wipe) | Dissolve at playhead only | 📋 | **Final Cut** — transition browser (UI). |
| Drag transition onto cut | Not in live app | 📋 | **Final Cut** — drag transition (UI). |
| Adjustment layer / grade track | Master picture sliders (whole reel) | 🔶 | **Premiere** — adjustment layer (UI). |
| Crop handles on program monitor | Select a clip — drag the crop box on the program. Inspector has L/R/T/B sliders. | ✅ | **Final Cut** — on-screen crop (UI). |
| Safe margins / title safe overlay | Monitor **Safe** — action 5% / title 10% | ✅ | **Premiere** — overlay guides (UI). |
| Multi-clip sequence (several sources) | Add take; not a bin of cameras | 🔶 | **Descript** — multitrack (functional). |
| Record voiceover into timeline | Not in live app | 📋 | **Descript** — record insert (UI). |
| Record screen in-app | Not in live app | 📋 | **Screen Studio** — record (functional). |
| Import folder / batch import | One file at a time | 📋 | **Premiere** — import folder (UI). |
| Media browser / bin panel | Not in live app | 📋 | **Premiere** — project panel (UI). |
| Search/filter project assets | Palette finds scenes/edits, not a bin | 📋 | **Premiere** — search bin (UI). |
| Proxy workflow UI (toggle, status) | Advanced: “lighter preview”; path auto | 🔶 | **Premiere** — proxy badges (UI). |
| Full-screen program monitor | Monitor **Full screen** (F) | ✅ | **Final Cut** — full screen viewer (UI). |
| Playback speed control (0.5×, 1×, 1.5×, 2×) | Monitor **0.5× / 1× / 1.5× / 2×** | ✅ | **YouTube** — speed control (UI). 1.5× is the client-demo skim. |
| Audio meters / loudness monitor | Meter next to **vol** on the transport | ✅ | **Premiere** — audio meters (UI). |
| Export queue (multiple jobs) | One export at a time | 📋 | **HandBrake** — queue (UI). |
| Export preset picker (YouTube 1080p, etc.) | Export → **YouTube 1080** / **Vertical 9:16** / **Podcast audio**; suggest bar **9:16** when a clip is marked; Picture / palette | ✅ | **Descript** — export presets (UI). **CapCut** — 9:16 canvas (UI). Vertical is a centered cover-crop of the 16:9 picture, not a left-aligned letterbox. **Left / Center / Right** sit on the monitor; drag pans. Safe turns on. Marks loop so you see the clip tall. |
| Export audio-only (MP3/WAV) | Suggest bar **Export audio** when the reel has no video; Export sheet **Audio only · M4A** / **Podcast audio** | ✅ | **Descript** — audio export (functional). An audio-only reel opens the sheet with M4A already selected. A reel with no file on disk (studio demo / web) ships **Download the words** — captions, transcript, chapters — and says M4A needs the desktop app and a linked recording. |
| Export selected range only | Find **Mark clip** or **I/O** / **M**; suggest bar **Export marked range** then **Clear marks**; Export sheet **Marked range only** (checked when marks exist) | ✅ | **Audacity** — export selection (functional). Opening Export with In–Out set does not default to the whole reel. After a marked export, the same bar offers the next hunt. |
| Burn-in toggle for captions on export | Export → **Burn captions into the picture** | ✅ | **Premiere** — export captions setting (UI). The checkbox appears when the lane has titles or when live words can synthesize them. A burned MP4 uses the same clips as the monitor; if the lane is still empty, export builds the same word captions SRT already used. |
| Recent projects list | File → Open recent | ✅ | **VS Code** — recent (UI). |
| Autosave interval indicator | Status pill / unsaved close warning | ✅ | **Google Docs** — “Saved to Drive” (UI). |
| Project templates (tutorial, podcast, screencast) | Studio demo only | 📋 | **Descript** — templates (UI). |
| Keyboard shortcut cheat sheet | **?** · Edit → Keyboard shortcuts | ✅ | **Descript** — shortcut overlay (UI). |
| Customizable shortcuts | Not in live app | 📋 | **Premiere** — keyboard editor (UI). |
| Touch bar / Stream Deck profile | Not in live app | 📋 | **Premiere** — control surface (functional). |

### Audit notes — §30 (2026-08-25)

**What a headache user hit:** Split lived only on S. Review was always 1×. Export was “whole reel, video, captions burned.” Solo and notes did not exist. Clips could move, but slip/roll/copy/nudge were invisible.

**What we shipped:** Split on the tape, Note, Solo, 0.5×/1.5×/2×, full screen, duplicate clip, export range / audio / burn toggle, keyboard overlay. Ripple is named, not faked. **Watch edited reel** starts at 1.5× after a first edit so the client-demo skim is one tap. After I/O or **M**, the bar offers **Cut marked**, **Export marked range**, and **Clear marks**. The sheet opens with Marked range only already on. Clear jumps to the next Find hit when a phrase is still open, or focuses Find for a new hunt.

**Second pass:** ← → nudge with inspector chips. ⌘C/V paste at the playhead. ⌘⇧V paste look. Shift-click multi-select. Track **All**. Alt-drag slip, Shift-drag slide, Shift-handle roll. **E** extend. **N** hops notes. **Safe** boxes + on-program crop handles. Transport voice meter. Export **YouTube 1080 / Vertical 9:16 / Podcast audio**.

**Third pass (slugs):** Timeline **Ripple on** / **Lift** is a real mode. Lift leaves a black/silence hold; **Gap** inserts 1s; inspector **Close gap** extracts it. Export and interchange (OTIO / FCPXML / MLT / Premiere) emit and restore the hold. Monitor **Match** finds the script word. Overlay **Replace footage**, **Pan**, and PIP corner chips. Export **Content package**. Protect paint is Keep / Silent demo / Note. Freeze / reverse / volume envelopes still need media that HTML preview cannot fake.

---

## 31. Should have — transcript, auto-edit & intelligence

| Action | How to invoke / gap | Status | Best reference apps |
|--------|---------------------|--------|---------------------|
| Record audio/video in app | Not in live app | 📋 | **Descript** — record (functional). |
| Live transcript during record | Not in live app | 📋 | **Descript** — live transcript (functional). |
| Highlight transcript while playing (auto-scroll) | Transcript **Follow on** | ✅ | **Descript** — follow playhead (UI). |
| Pause follow when user scrolls | Scroll the words → Follow off | ✅ | **Descript** — follow toggle (UI). |
| Search & replace in transcript | Find → **Hit** → **Replace** / **Replace all** (one undo) | ✅ | **Word** — find/replace (UI). |
| Find next / previous match | Enter / Shift+Enter · ‹ › | ✅ | **VS Code** — F3 (UI). |
| Correct transcript and redistribute timing | Replace keeps leftover word times; no retime | 🔶 | **Descript** — text-based retime (functional). |
| Delete silence only (not words) from selection | Tighten marked; gap double-click | ✅ | **Descript** — shorten word gaps (UI). |
| Shorten to breath vs remove entirely (explicit) | Pace chips + tighten vs Remove | 🔶 | **ux_helper** — Shorten vs Remove (UI). |
| Remove all fillers one click (global) | Suggest bar **Cut N fillers** | ✅ | **Descript** — remove fillers (UI). |
| Remove all silence one click (global) | **Clean N pauses** | ✅ | **Descript** — remove silence (UI). |
| Preview auto-edit before apply (A/B) | **Original** / **With cuts** | ✅ | **Lightroom** — before/after (UI). |
| Apply auto-edit to selection only | Tighten marked; word popover All fillers | 🔶 | **Descript** — edit selection (functional). |
| Reject all pending suggestions | Review **Dismiss all** | ✅ | **Gmail** — dismiss all (UI). |
| Adjust silence threshold (advanced dB) | Pause padding only | 📋 | **Auto-Editor** — `--edit audio` (functional). |
| Per-speaker auto-edit rules | Not in live app | 📋 | **Descript** — per-speaker (partial). |
| Detect crosstalk / overlap | Not in live app | 📋 | **Descript** — studio sound (functional). |
| Studio Sound / noise reduction toggle | Not in live app | 📋 | **Descript** — studio sound (UI). |
| Auto music ducking strength preview | Duck slider + duck flag on monitor | 🔶 | **Descript** — duck slider + preview (UI). |
| Tag section as “chapter” for YouTube | Rename the scene heading; **Copy chapters** on the bar or transcript copies `0:00 Title` lines | ✅ | **Descript** — chapters (UI). |
| Tag section as “hook” / “CTA” | Type a note (`hook`, `ask`, …). N hops tape notes. Old Hook/CTA tags still hop and edit. | ✅ | **Premiere** — marker comment (functional). Not a separate paint kind — a note is the mark. |
| Note marker on timeline (UI paint) | **Note** on the bar; Timeline **Note**; Protect → Note; type hook, ask, or why you parked | ✅ | **Premiere** — marker comments (UI). |
| “Apply to similar pauses” from gap inspector | Clean N pauses | 🔶 | **ux_helper** — batch intelligence (UI). |
| “Apply to similar fillers” | **Cut N fillers** | ✅ | **Cleanvoice** — global filler (UI). |
| Compare takes side-by-side (split view) | Loop takes A ↔ B (one monitor) | 🔶 | **Descript** — compare (UI). |
| Show waveform difference between takes | Not in live app | 📋 | **Audacity** — diff (functional). |
| Collapse retakes with preview of saved time | Collapse retakes tooltip | ✅ | **ux_helper** — consequence copy (UI). |
| Detect false starts separately from retakes | False take scene kind | 🔶 | **Descript** — retake types (functional). |
| “Use another take” from transcript search | Find scene + Use later take | 🔶 | **feature_explosion** — semantic (vision). |
| Edit by transcript outline (sections tree) | Scene chips in the script | 🔶 | **Descript** — sidebar outline (UI). |
| Drag scene boundaries | Drag handles on a chapter block in the Edits lane | ✅ | **Descript** — scene edges (UI). |
| Merge scenes | Suggest bar **Merge {neighbor}** on a heading or words; right-click heading; inspector; Sequence; palette | ✅ | **Descript** — merge scenes (functional). The button names the other card. The joined chapter plays. Toast names **Copy chapters**. Skips retake neighbors. |
| Split scene at playhead | Suggest bar **Split chapter** on a parked word; right-click heading → **Split**; inspector; Sequence; palette | ✅ | **Descript** — split scene (UI). A word is enough — no heading required. A heading highlight does not steal a playhead cut inside the chapter. The new half opens Rename. |
| Generate episode title from content | Not in live app | 📋 | **Descript** — AI titles (functional). |
| Summarize selection for description | Agent can; no one-click | 📋 | **ChatGPT** — summarize (functional). |
| Detect and list “uncertain” edits only | Review drawer groups | 🔶 | **Gmail** — priority inbox (UI pattern). |
| Thumbs up/down on auto-edit decision | Apply / Skip / Put back | 🔶 | **Gmail** — feedback (functional). |
| Export inspectable edit recipe (checkboxes) | Agent Will: line; no checkbox recipe | 🔶 | **Auto-Editor** CLI (functional). |
| Re-run only one analysis pass (silence only) | Rebuild intelligence (all) | 📋 | **Auto-Editor** — modular analysis (functional). |
| Import forced alignment after text edit | Not in live app | 📋 | **Descript** — alignment (functional). |
| Multi-language transcript | Not in live app | 📋 | **Sonix** — languages (functional). |
| Translate captions | Not in live app | 📋 | **CapCut** — auto translate (UI). |
| Burn highlight keywords in captions | ** emphasis in generate | 🔶 | **CapCut** — keyword styles (UI). |
| Caption animation presets (pop, karaoke) | Not in live app | 📋 | **CapCut** — animation (UI). |
| Caption safe-zone preview for 9:16 | Export **Vertical 9:16** + monitor **Safe** | ✅ | **CapCut** — aspect preview (UI). |
| Auto reframing for vertical export | Not in live app | 📋 | **CapCut** — auto reframe (UI). |
| Detect faces for caption placement | Not in live app | 📋 | **Descript** — smart captions (functional). |
| Blur faces automatically | Manual redaction overlay | 🔶 | **Descript** — face blur (UI). |
| Detect and blur emails/phones (CV) | Manual redaction | 📋 | **YouTube** face blur (partial). |
| Speed ramp UI (handles) | Speed slider on range | 🔶 | **Final Cut** — speed ramp (UI). |
| Compress loading screens (detect + UI) | Review **Static screens** · Speed N× / Keep / Speed all | ✅ | **Screen Studio** — auto compress (functional). We detect quiet static holds and leave talking-over-static alone. Speed is a review decision, not a blind apply. |
| “Make 8 minutes” duration compiler | Not in live app | 📋 | **feature_explosion #7**. |
| Failure/success attempt picker | Keep this take / Use later take | 🔶 | **feature_explosion #11**. |
| Cross-modal search UI | Find is words/scenes/edits | 📋 | **Rewind.ai** (functional). |
| Semantic event list panel | Edits lane + Review drawer | 🔶 | **feature_explosion #1**. |
| Post-export QA lint panel | Not in live app | 📋 | **feature_explosion #20**. |
| Style learning from undos | Not in live app | 📋 | **feature_explosion #17**. |
| Branching versions (Detailed / Short / TikTok) | Not in live app | 📋 | **feature_explosion #18**. |
| One-click content package export | Export → **Content package** (SRT, VTT, transcript, chapters) | ✅ | **feature_explosion #19**. |

### Audit notes — §31 (2026-08-25)

**What a headache user hit:** Playing lost the word. Typos needed one-by-one edits. Fillers hid in Review. Chapters could not split.

**What we shipped:** Follow (scroll pauses it), find/replace, Cut N fillers, Dismiss all, Note on the word row, Split/Merge chapter. Drag chapter edges on the Edits lane. Vertical 9:16 + Safe boxes for caption placement. Note (type hook, ask, or why you parked). Content package export. Remaining CV / record / translate items are still planned — no toy stubs.

---

## 32. Should have — screencast & tutorial polish

Audited against the live app: Sequence → **Add zoom** and **Add redaction** are the only tutorial polish on the tape. Cursor reconstruct, click-follow, and OCR zoom need capture telemetry that is not in the project yet — left 📋 rather than faking a toy.

| Action | How to invoke / gap | Status | Best reference apps |
|--------|---------------------|--------|---------------------|
| Auto zoom on click | Manual **Add zoom** at playhead | 🔶 | **Screen Studio** — click zoom (functional). |
| Auto zoom on cursor movement | Not in live app | 📋 | **Tella** — cursor follow (UI). |
| Smooth cursor path | Not in live app | 📋 | **FocuSee** — smooth cursor (functional). |
| Cursor highlight ring on click | Not in live app | 📋 | **Screen Studio** — click ring (UI). |
| Hide idle cursor | Not in live app | 📋 | **Tella** — idle hide (functional). |
| Custom cursor size/color | Not in live app | 📋 | **Screen Studio** — cursor styles (UI). |
| Reconstruct cursor from imported MP4 | Not in live app | 📋 | **FocuSee** (functional). |
| Zoom to active window/control (OCR) | Not in live app | 📋 | **Screen Studio** (functional). |
| Highlight keystrokes on screen | Not in live app | 📋 | **ScreenFlow** — keystroke overlay (UI). |
| Show click ripple at coordinates | Not in live app | 📋 | **Screen Studio** (UI). |
| Auto jump-cut camouflage (punch-in) | Manual zoom clip | 📋 | **Descript** — speaker zoom (emerging). |
| Picture-in-picture webcam layout presets | Overlay inspector corner / center / full chips | ✅ | **Loom** — layouts (UI). |
| Teleprompter while recording | No in-app record | 📋 | **Descript** — teleprompter (UI). |
| Code-aware lower thirds (file:line) | Manual lower third | 📋 | **feature_explosion #15**. |
| VS Code extension for exact file/line metadata | Not in live app | 📋 | **feature_explosion #15**. |
| Terminal command overlay | Manual title | 📋 | **ScreenFlow** — text actions (UI). |
| Mouse trail / spotlight | Not in live app | 📋 | **DemoCreator** — spotlight (UI). |
| Blur specific window/title bar | **Add redaction** + drag | 🔶 | **Descript** — blur region (UI). |
| Track window focus changes as events | Not in live app | 📋 | **feature_explosion** — event graph (vision). |

### Audit notes — §32 (2026-08-25)

Live app can place a zoom or a blur, and an overlay now has corner PIP chips plus Replace footage. It cannot reconstruct a cursor from an MP4. Next real step is capture metadata, not another overlay button.

---

## 33. Should have — UX, onboarding & agent

| Action | How to invoke / gap | Status | Best reference apps |
|--------|---------------------|--------|---------------------|
| Empty transcript: Open media card | Start guide cards | ✅ | **Descript** — empty CTA (UI). |
| Empty transcript: Drop transcript card | Start guide + drop on transcript | ✅ | **Descript** (UI). |
| Empty transcript: Try demo card | Start guide **Studio demo** | ✅ | **Framer** — templates (UI). |
| Empty project inspector guidance | Start guide in inspector | ✅ | **Descript** — checklist (UI). |
| Workflow breadcrumb (Import→Analyze→Polish) | Suggest-bar headlines | 🔶 | **TurboTax** steps (UI). |
| MCP setup wizard in inspector | MCP one-liner in Advanced | 🔶 | **Cursor** — MCP config (UI). |
| Agent recipe preview (checkboxes) before apply | Agent **Will:** + note | 🔶 | **Terraform plan** (UI). |
| “Why not safe?” on every blocked suggestion row | Drawer **Blocked by …** | ✅ | **Descript** — explain AI (UI). |
| Consequence line on every destructive button | Inspector helper + toasts | 🔶 | **Superhuman** — action copy (UI). |
| Next-step chip after every batch apply | Suggest-bar headline after apply | 🔶 | **ux_helper** — breadcrumbs (UI). |
| Context menu on suggest bar | Not on the bar; Review has row actions | 📋 | **macOS** — contextual (UI). |
| Drag-and-drop media on timeline | Drop on transcript / monitor | 🔶 | **Premiere** — drop to timeline (UI). |
| Drag-and-drop media on empty monitor | Drop zone copy | ✅ | **iMovie** — drop zone (UI). |
| Drag clip between tracks | Move on same tape; no cross-lane drag | 📋 | **Premiere** — drag track (UI). |
| Undo history panel (list) | ⌘Z only | 📋 | **Photoshop** — history panel (UI). |
| Pin favorite palette commands | Not in live app | 📋 | **VS Code** — pin commands (UI). |
| Command palette recent commands | Palette lists **Recent ·** last eight runs | ✅ | **Raycast** — recents (UI). |
| In-app keyboard shortcut overlay | **?** overlay | ✅ | **Descript** — shortcuts (UI). |
| Tooltip tour for first run | Start guide, no tour | 📋 | **CapCut** — first-run tour (UI). |
| “What's new” after update | Not in live app | 📋 | **Slack** — what's new (UI). |
| Redaction button when overlay clip selected | Inspector **Blur/redact here** | ✅ | **Descript** (UI). |
| Edits lane summary when crowded (>10) | Toolbar totals + filters | ✅ | **Jira** — collapse (UI). |
| Monitor layout for audio-only projects | Voiceprint + “audio-only preview” | ✅ | **Audacity** — waveform hero (UI). |
| Consistent theme tokens (no hardcoded colors) | Tokens exist; some leftover hex | 🔶 | **VS Code** — theme (functional). |
| Share read-only review link | Local-first; no share | 📋 | **Frame.io** — review link (functional). |
| Comments on timeline for collaborators | Note tags (single-user) | 🔶 | **Frame.io** — comments (UI). |
| Version history / named snapshots | Undo stack only | 📋 | **Google Docs** — version history (UI). |
| Plugin / extension marketplace | MCP tools | 📋 | **VS Code** — extensions (functional). |

### Audit notes — §33 (2026-08-25)

**What we shipped / corrected:** Keyboard **?** overlay. Palette **Recent ·** last eight commands. Empty-state cards, drawer “Blocked by”, full-screen program, and audio-only voiceprint were already in the app and are marked ✅ after the live pass.

---

## 34. Planned user actions (from docs — summary index)

Quick index of vision-doc items; detail in §30–33 above.

| Action | Source |
|--------|--------|
| Semantic event panel | feature_explosion #1 |
| Retake attempt sequences | feature_explosion #2 |
| Visual-aware silence (full CV) | feature_explosion #3 |
| Cursor reconstruction | feature_explosion #4 |
| UI-target auto zoom | feature_explosion #5 |
| Information-density pacing slider | feature_explosion #6 |
| Target duration compiler | feature_explosion #7 |
| Inspectable NL edit recipes | feature_explosion #8 |
| Cross-modal search | feature_explosion #9–10 |
| Failure/success recognition | feature_explosion #11 |
| Intelligent compression strategies | feature_explosion #12 |
| Jump-cut repair pass | feature_explosion #13 |
| Smart caption placement | feature_explosion #14 |
| Code-aware tutorials | feature_explosion #15 |
| Recording telemetry | feature_explosion #16 |
| Style learning | feature_explosion #17 |
| Branching timelines | feature_explosion #18 |
| Content package export | feature_explosion #19 |
| Post-edit QA lint | feature_explosion #20 |
| Insert silence / gap clip | Timeline **Gap**; Edit → Insert 1s hold; palette — real program slug (black + silence in export) |
| Regenerated speech / Overdub | ReScript roadmap |
| Multi-clip projects | ReScript roadmap |
| Forced alignment / Parakeet ASR | ReScript / Auto-Editor ecosystem |
| Voice clone word replace | ReScript roadmap |
| Hide empty tracks by default | UX P2 — ✅ empty overlay/caption stacks auto-hide |
| Clip basics without Advanced | UX P2 — ✅ trim/split/volume without Advanced |
| Original/Edited preview toggle | UX P4 — ✅ Original / With cuts |
| Compare takes A/B loop | UX P5 — 🔶 Loop takes A ↔ B on one monitor |

---

## Appendix — Reference app cheat sheet (by action type)

| If the action is… | Steal functional from | Steal UI from |
|-------------------|----------------------|---------------|
| Word ↔ media cut | Descript, ReScript | Descript |
| Pause/silence batch | Auto-Editor, Descript, Cleanvoice | Descript presets |
| Retake/take | Descript, Riverside | Descript compare |
| Timeline trim/ripple | Premiere, Final Cut | Premiere (Q/W, J/K/L) |
| Screencast zoom | Screen Studio, Tella, FocuSee | Screen Studio |
| Captions | CapCut, Kapwing, Descript | CapCut templates |
| Command discovery | VS Code, Superhuman | VS Code ⌘K |
| Agent/MCP edit | WeftCut, OpenScene, Cursor | Cursor tool log |
| Relink/export | Premiere, HandBrake | Premiere / HandBrake |

---

*Last audited: Aug 25, 2026 — codebase + live app. **~285 shipped** user actions · **~12 command-bus-only** · remaining §30–33 rows are 📋/🔶 (screencast CV, in-app record, freeze/reverse, volume envelopes — no toy stubs).*
