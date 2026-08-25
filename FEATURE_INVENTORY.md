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
| Import video/audio (probe, waveform, thumbs, ASR, suggestions) | File → Open media… | ✅ | **Descript** — drop file → instant transcript row (UI). **CapCut** — import → immediate timeline (functional speed). |
| Cancel in-flight import | Click status pill while analyzing; palette “Cancel import”; Escape (if not in palette) | ✅ | **Final Cut** — background task cancel in progress HUD (UI). |
| Import transcript only (SRT/VTT/JSON) onto existing media | File → Open transcript… | ✅ | **Subtitle Edit** — import subs without re-encoding (functional). **Premiere** — import captions track (UI: separate from media). |
| Drop transcript file onto transcript panel | Drag file onto transcript | ✅ | **Descript** — drag SRT (functional). **Google Docs** — drop-to-import affordance (UI). |
| Import external timeline (interchange) | File → Import timeline… | ✅ | **Premiere** — XML import (functional). **Resolve** — OTIO import dialog (UI). |
| Open saved `.speechedit` project | File → Open project… | ✅ | **Logic Pro** — open project bundle (functional). **VS Code** — recent files list pattern (UI). |
| Save project | File → Save; ⌘S; palette “Save” | ✅ | **Google Docs** — continuous save expectation (UI). **Figma** — save indicator in chrome (UI). |
| Save project to new path | File → Save As…; ⌘⇧S | ✅ | **Every desktop app** — Save As dialog (functional). |
| Load built-in demo project | File → Studio demo; palette “Load studio demo” | ✅ | **Descript** — sample project teaches workflow (UI). **Framer** — template gallery entry (UI). |
| Confirm abandoning unsaved work | Dialog when New/Open/Demo with dirty project | ✅ | **macOS** — standard “don’t lose work” sheet (UI). |
| Restore unsaved edits after crash | Banner → Restore | ✅ | **Word** — recovery pane (functional). **Logic** — recover autosave (UI). |
| Discard recovery, keep last save | Banner → Keep saved | ✅ | **Word** — “keep original” on conflict (UI). |
| Relink first missing media file (banner) | Missing-media banner → Relink… | ✅ | **Premiere** — offline clip relink (functional gold standard). |
| Relink specific missing asset (inspector) | Project inspector → Relink… per asset | ✅ | **Premiere** — right-click offline → relink (UI). |
| Rename project / reel | Project inspector → Reel name field | ✅ | **Descript** — composition title inline (UI). |
| View document path (read-only) | Project inspector → Document field | ✅ | **VS Code** — path in title bar (UI). |

---

## 2. Export & rendered output

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Export rendered MP4 (burned program) | Menubar Export; right-click → Export; `speechedit:export` event | ✅ | **Descript** — export with edits baked (functional). **HandBrake** — pick destination then progress (UI). |
| Cancel export | Export button while exporting; palette “Cancel export”; Escape | ✅ | **Final Cut** — stop share (UI). |
| Choose export file path | System save dialog (Electron) | ✅ | **Standard OS** — native save panel (UI). |

### Sidecar / interchange exports (no re-encode)

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Export captions SRT | Palette | ✅ | **Descript** — export subtitles (functional). **Rev** — SRT deliverable (functional). |
| Export captions VTT | Palette | ✅ | **YouTube Studio** — VTT upload path (functional). **Kapwing** — WebVTT export (UI: one click). |
| Export transcript Markdown | Palette | ✅ | **Otter** — export MD notes (functional). **Notion** — clean MD export (UI). |
| Export transcript plain text | Palette | ✅ | **Trint** — TXT export for editors (functional). |
| Export chapters JSON (from scenes) | Palette | ✅ | **Descript** — YouTube chapter markers copy (functional). **Podcast apps** — JSON chapters (functional). |
| Export OpenTimelineIO | Palette | ✅ | **Resolve** — OTIO roundtrip (functional). **OTIO tools** — pipeline interchange (functional). |
| Export Final Cut Pro XML | Palette | ✅ | **Final Cut** — XML import target (functional). |
| Export Adobe Premiere XML | Palette | ✅ | **Premiere** — XML handoff (functional). |
| Export Auto-Editor v3 JSON | Palette | ✅ | **Auto-Editor** — native timeline JSON (functional). |
| Export Shotcut MLT | Palette | ✅ | **Shotcut** — MLT project (functional). |
| Export Kdenlive project | Palette | ✅ | **Kdenlive** — native XML (functional). |

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
| Play I/O range, else selection, else from playhead | Monitor Play I/O; Edit menu; P; palette | ✅ | **Premiere** — play in-to-out (functional). |
| Play / loop selected sentence on word click | Click word (default) | ✅ | **Descript** — hear selection (functional). |
| Play / loop marquee or shift-range selection | Shift-click range; drag select words | ✅ | **Descript** — audition highlighted script (UI). |
| Play from source at scene start | Click scene chip | ✅ | **Descript** — scene marker scrub (functional). |
| Loop gap/pause on gap chip click | Click gap chip | ✅ | **Descript** — isolate pause audition (functional). |
| Park playhead at word (context menu) | Right-click word → Park playhead here | ✅ | **Premiere** — “Go to time” equivalent (functional). |
| Park playhead at clip start (context menu) | Right-click clip | ✅ | **Final Cut** — snap playhead to clip (UI). |
| Set mark In at playhead | Monitor I button; I key; I with word selection uses span start | ✅ | **Premiere** — I key (functional standard). |
| Set mark Out at playhead | Monitor O button; O key | ✅ | **Premiere** — O key (functional standard). |
| Set both marks to selected words | M with word selection | ✅ | **Premiere** — mark clip (functional). |
| Watch from beginning (suggest bar) | Suggest bar “Watch” | ✅ | **Descript** — preview full edit (functional). 🔶 label clarity planned (UX audit). |
| Drive playhead from picture clock | Automatic while primary video is ready | ✅ | **Premiere** — program time tracks the viewer, not wall-clock (functional). Audio-only / unready picture still uses rAF. |

---

## 5. Transcript — selection gestures

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select single word | Click word | ✅ | **Descript** — word as atom (UI). |
| Extend selection to click (range) | Shift+click word | ✅ | **Google Docs** — shift-click range (UI). |
| Toggle word in/out of selection | Ctrl/Cmd+click word | ✅ | **Figma** — additive selection (UI). |
| Select sentence containing word | Alt+click word | ✅ | **Descript** — double-click sentence (mouse equivalent). |
| Select paragraph (triple-click) | Triple-click word | ✅ | **Google Docs** — triple-click paragraph (UI). |
| Select paragraph (keyboard/menu) | A key; Edit → Select paragraph; palette | ✅ | **Descript** — paragraph as edit unit (functional). |
| Drag-select word range | Mouse down + drag across words | ✅ | **Descript** — drag in script (UI). |
| Marquee box-select words | Drag on empty script background | ✅ | **Figma** — marquee select (UI). |
| Additive marquee / drag | Shift/Ctrl during marquee or drag | ✅ | **Photoshop** — shift-add selection (UI). |
| Select all words | Transcript toolbar “Select all”; ⌘A in script | ✅ | **Google Docs** — select all (UI). |
| Grow selection one word | `]` | ✅ | **Pro tools text** — expand selection (functional). |
| Shrink selection one word | `[` | ✅ | **Same** — contract selection (functional). |
| Find phrase and select all matching words | Transcript search → Enter | ✅ | **Descript** — search jumps + highlights (UI). |
| Clear find query | Escape in search field | ✅ | **VS Code** — clear search (UI). |
| Select all words spoken by one speaker | Click speaker chip (no word selection) | ✅ | **Descript** — filter by speaker (functional). |

---

## 6. Transcript — edit actions on words

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Cut selected live word(s) (ripple) | Delete/Backspace; X; popover “Remove”; palette “Cut selection”; double-click live word | ✅ | **Descript** — delete word cuts media (functional defining feature). |
| Restore cut word(s) | U; popover “Put back”; double-click cut word | ✅ | **Descript** — restore strikethrough (UI). |
| Cut sentence at caret word | `.` or `>` key; palette “Cut this sentence” | ✅ | **Descript** — delete sentence (functional). |
| Cut previous sentence | `,` or `<` key; palette “Cut previous sentence” | ✅ | **Descript** — trim false starts (functional for retakes). |
| Tighten interior gaps in selection | T key; popover “Make shorter”; palette “Make selection shorter” | ✅ | **Auto-Editor** — margin tighten (functional). **Descript** — shorten gaps (UI). |
| Edit word text (correct typo) | Right-click → Edit text…; inline blur; inspector Text field | ✅ | **Descript** — correct transcript without cutting (functional). |
| Copy selected words as text | Right-click → Copy | ✅ | **Google Docs** — copy selection (UI). |
| Assign selected words to speaker | Click speaker chip while words selected | ✅ | **Descript** — drag speaker label (UI is drag; functional same). |
| Rename speaker | Double-click speaker chip; Project Advanced speaker fields | ✅ | **Descript** — rename speaker in sidebar (UI). |
| Add new speaker | + speaker button; palette “Add speaker”; Project Advanced | ✅ | **Descript** — add speaker track (functional). |
| Apply first contextual choice from popover | Click chip on last selected word | ✅ | **Superhuman** — inline action on selection (UI). |
| Contextual choices (dynamic, up to 4) | Popover chips: Remove, Put back, Make shorter, Keep, Use final take, Keep this take, All fillers, etc. | ✅ | **Superhuman** — consequence + action (UI). **Descript** — selection toolbar (UI). |

---

## 7. Transcript — pause / gap actions

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select pause between words | Click gap chip (>0.45s) | ✅ | **Descript** — gap as object (functional). |
| Select linked silence suggestion via gap | Click gap with pending silence suggestion | ✅ | **Descript** — AI suggestion on gap (UI). |
| Cut pause (ripple) | Double-click uncut gap chip | ✅ | **Descript** — remove silence (functional). |
| Restore cut pause | Double-click cut gap chip | ✅ | **Descript** — restore silence (functional). |
| Revert applied suggestion on gap | Double-click gap with applied suggestion | ✅ | **Descript** — undo single AI edit (functional). |

---

## 8. Transcript — scene chips

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select editorial scene | Click scene chip in transcript | ✅ | **Descript** — scene marker in script (UI). |
| Seek to scene start on select | Click scene chip (built-in) | ✅ | **Descript** — click chapter scrubs (functional). |

---

## 9. Transcript — guard painting

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Toggle guard brush tool | G; Auto Edit → Paint guards; timeline Guard button; timeline right-click | ✅ | **Photoshop** — brush tool on canvas (UI metaphor). |
| Set guard brush to Keep | Timeline Guard → Keep (when guard tool on) | ✅ | **Auto-Editor** — manual keep range (functional). |
| Set guard brush to Demo | Shift+G; timeline Guard → Demo | ✅ | **Auto-Editor** — protect silent demo (functional). |
| Paint Keep/Demo tag on word drag | Guard tool + drag across words in script | ✅ | **Photoshop** — paint selection (UI). |
| Tag selection as Keep | B key; palette “Protect selection”; popover “Keep” | ✅ | **Descript** — ignore region (conceptual). |
| Tag selection as Silent demo | Shift+B; palette “Tag selection as silent demo”; popover | ✅ | **Screen Studio** — protect demo sections (functional intent). |
| Tag I/O range as Keep | Auto Edit → Tag I/O as keep | ✅ | **Premiere** — protect range (functional). |
| Tag I/O range as Silent demo | Auto Edit → Tag I/O as silent demo | ✅ | **Same** — demo-specific guard (functional). |

---

## 10. Timeline — navigation & view

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Zoom timeline out | Toolbar −; Ctrl/Cmd+wheel down | ✅ | **Premiere** — zoom slider (UI). |
| Zoom timeline in | Toolbar +; Ctrl/Cmd+wheel up | ✅ | **Premiere** — same. |
| Zoom via slider | Drag timeline zoom range input | ✅ | **Final Cut** — zoom control (UI). |
| Fit timeline to view | Toolbar Fit | ✅ | **Premiere** — `\` fit sequence (functional). |
| Toggle snap | Toolbar Snap; timeline right-click | ✅ | **Final Cut** — magnetic snap dots (best UI feedback). |
| Toggle guard tool from timeline | Toolbar Guard | ✅ | **Premiere** — tool palette (UI). |
| Filter edits lane: All | Edits filter “All” (when >8 blocks) | ✅ | **GitHub** — timeline filter (UI pattern). |
| Filter edits lane: Open | Edits filter “Open” | ✅ | **Jira** — open items filter (UI). |
| Filter edits lane: Applied | Edits filter “Applied” | ✅ | **GitHub** — closed vs open (UI). |
| Filter edits lane: Scenes | Edits filter “Scenes” | ✅ | **Descript** — scene markers only (functional). |
| Filter edits lane: Guards | Edits filter “Guards” | ✅ | **Auto-Editor** — show keep ranges (functional). |

---

## 11. Timeline — tracks

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Reveal hidden overlay track | Toolbar + Overlay | ✅ | **Final Cut** — show connected lane (UI). |
| Add new overlay track | Toolbar + Overlay (if none empty); Sequence → Add overlay track; palette | ✅ | **Premiere** — add video track (functional). |
| Add new audio/music track | Toolbar + Audio; palette “Add music track” | ✅ | **Premiere** — add audio track (functional). |
| Reveal/add captions track | Toolbar + Captions | ✅ | **Descript** — captions lane (functional). |
| Mute track | Track M button; right-click track → Mute/Unmute | ✅ | **Every NLE** — M on track header (UI standard). |
| Hide track from timeline | Track H button; right-click | ✅ | **Premiere** — eye icon hide track (UI). |
| Lock track (prevent clip moves/trims) | Track L button; right-click | ✅ | **Premiere** — lock track (functional). |
| Rename track | Double-click track name; edit; Enter | ✅ | **Reaper** — rename tracks inline (UI). |
| Remove empty non-primary track | Track × button; right-click → Remove empty track | ✅ | **Premiere** — delete empty track (functional). |
| Hide empty V2/V3 by default | — | 📋 | **Final Cut** — collapses unused lanes (UI). UX audit P2. |

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
| Ripple-delete I/O marked range | Delete with marks set; Edit menu; timeline Ripple I/O; palette | ✅ | **Premiere** — ripple delete (functional standard). |
| Ripple trim in to playhead | Q; Edit menu | ✅ | **Premiere** — Q trim (industry standard). |
| Ripple trim out to playhead | W; Edit menu | ✅ | **Premiere** — W trim (industry standard). |

---

## 13. Timeline — edits lane blocks

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Select suggestion from edits lane | Click suggestion block | ✅ | **Descript** — click AI marker (UI). |
| Select scene from edits lane | Click scene block → selects scene words | ✅ | **Descript** — scene marker (functional). |
| Select guard from edits lane | Click guard block → opens gap inspector | ✅ | **Auto-Editor** — visualize keep ranges (functional). |
| Remove guard tag | Right-click guard block → Remove guard | ✅ | **Auto-Editor** — clear manual range (functional). |
| Paint Keep tag on edits lane | Guard tool + drag on edits lane | ✅ | **Photoshop** — paint mask (UI). |
| Paint Demo tag on edits lane | Guard tool + Demo + drag | ✅ | **Same** — demo-specific paint (UI). |
| Erase guards on edits lane | Guard tool + Alt+drag | ✅ | **Photoshop** — eraser brush (UI metaphor). |
| Shift+drag paint Demo on edits lane | Guard tool + Shift+drag | ✅ | **Same** — modifier for mode (UI). |

---

## 14. Marks & I/O editing

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Ripple delete between In and Out | See §12 | ✅ | **Premiere** — three-point editing (functional). |
| Tighten gaps inside I/O | Auto Edit → Tighten I/O gaps | ✅ | **Auto-Editor** — batch tighten range (functional). |

---

## 15. Auto Edit — suggest bar (footer)

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Set pause margin preset Natural (0.22s) | Suggest bar Natural chip (when shown) | ✅ | **Descript** — pause removal presets (UI: no dB numbers). |
| Set pause margin preset Balanced (0.12s) | Suggest bar Balanced chip | ✅ | **Descript** — Balanced/Tight tiers (UI). |
| Set pause margin preset Tight (0.04s) | Suggest bar Tight chip | ✅ | **Descript** — aggressive tighten (UI). |
| Apply all safe pending suggestions | Suggest bar primary button (“Clean N pauses”, “Apply N safe”) | ✅ | **Descript** — apply all fillers/silence (functional). **Cleanvoice** — one-shot process (UI). |
| Open review drawer | Suggest bar Review N; primary when no safe | ✅ | **Gmail** — review bulk action (UI). |
| Close review drawer | Suggest bar Hide review | ✅ | **GitHub** — collapse review panel (UI). |
| Run local scene/retake detection | Suggest bar Find retakes | ✅ | **Descript** — find retakes (functional). |
| Collapse all superseded retakes | Suggest bar Collapse retakes | ✅ | **Descript** — delete previous takes (functional). |
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
| Apply pending suggestion | Suggestion row → Apply / Speed N× / Normalize | ✅ | **Descript** — accept AI edit (functional). |
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
| Enable master normalize −16 LUFS (one-shot menu) | Auto Edit → Normalize to -16 LUFS; palette | ✅ | **Auphonic** — loudness target (functional). **Descript** — normalize toggle (UI). |

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
| Keep (protect selection) | Unguarded selection | ✅ | **Auto-Editor** — keep range (functional). |
| Use final take | Retake scene | ✅ | **Descript** — keep best take (functional). |
| Keep this take | Multi-take family | ✅ | **Descript** — pick take (functional). |
| Keep all takes | Applied retake | ✅ | **Descript** — restore attempts (functional). |
| Remove pause | Gap inspector | ✅ | **Descript** — cut silence (functional). |
| Shorten (pause) | Long pause gap | ✅ | **Descript** — shorten vs remove (UI choice). |
| Mark demo (pause) | Unguarded gap | ✅ | **Screen Studio** — protect demo (functional). |
| Protect (pause) | Unguarded gap | ✅ | **Auto-Editor** — keep (functional). |
| Apply (suggestion) | Safe pending suggestion | ✅ | **Descript** — apply AI edit (UI). |
| Speed N× (suggestion) | Static/low-motion suggestion | ✅ | **Auto-Editor** — speed up static (functional). |
| Normalize (suggestion) | Loud suggestion | ✅ | **Descript** — normalize clip (functional). |
| Keep (dismiss suggestion) | Review suggestion | ✅ | **Gmail** — dismiss (UI). |
| Skip (blocked suggestion) | Guard-blocked suggestion | ✅ | **GitHub** — skip failing check (UI). |
| Apply N similar | Multiple same-type safe | ✅ | **Descript** — apply all similar (functional). |
| Collapse all retakes | Scene with retake family | ✅ | **Descript** — batch retake collapse (functional). |
| Compare takes | Scene inspector / context menu | 🔶 | **Descript** — A/B take compare (functional leader). Loop A/B 📋 P5. |
| Review next → | Suggestion/gap inspector | ✅ | **GitHub** — next file in review (UI). |
| Next pause → | Gap inspector | ✅ | **Duolingo** — next item queue (UI pattern). |
| Trim to playhead (in/out) | Clip inspector | ✅ | **Premiere** — trim to playhead (functional). |
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
| Show trim/split without opening Advanced | — | 📋 | **iMovie** — clip selected → handles only (UI). UX audit P2. |

---

## 22. Inspector — captions pane

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Generate captions from live words | Caption tab button; Sequence menu; palette | ✅ | **CapCut** — auto captions one tap (UI leader). **Descript** — from transcript (functional). |
| Add scene lower thirds | Caption tab; Sequence menu; palette | ✅ | **Descript** — chapter titles (functional). |
| Edit selected caption text | Caption textarea | ✅ | **Kapwing** — inline caption edit (UI). |
| Change caption font size | Size slider | ✅ | **CapCut** — style size preset (UI). |
| Change caption align (left/center/right) | Align dropdown | ✅ | **Kapwing** — alignment control (UI). |
| Change caption screen position (lower/center/upper) | Position dropdown | ✅ | **CapCut** — position templates (UI). |
| Change caption fill color | Fill text field | ✅ | **Kapwing** — color picker (UI; SpeechEdit uses hex text). |
| Change caption stroke color | Stroke text field | ✅ | **Kapwing** — outline color (UI). |
| Apply caption style to all title clips | “Apply style to all titles” | ✅ | **CapCut** — apply to all captions (UI). |

---

## 23. Sequence / graphics — add at playhead

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Add title clip (3s default) | Sequence → Add title; palette | ✅ | **Final Cut** — titles browser (UI). |
| Add zoom region (1.45×, 3s) | Sequence → Add zoom; palette | ✅ | **Screen Studio** — auto zoom (functional). **Tella** — zoom blocks (UI). |
| Add lower third (3s) | Sequence → Add lower third; palette | ✅ | **Premiere** — lower third MOGRT (functional). |
| Add blur redaction (4s) | Sequence → Add redaction; palette | ✅ | **Descript** — blur face (functional). **YouTube Studio** — face blur (UI). |
| Add cross-dissolve at playhead (0.4s) | Sequence → Dissolve at playhead; palette | ✅ | **Final Cut** — default cross dissolve (UI). |
| Fade in selected clip 0.4s | Palette (clip selected) | ✅ | **Audacity** — fade in (functional). |
| Fade out selected clip 0.4s | Palette (clip selected) | ✅ | **Audacity** — fade out (functional). |
| Import B-roll still/video at playhead | Sequence → Add B-roll… | ✅ | **Descript** — B-roll lane insert (functional). |
| Import music bed at playhead | Sequence → Add music bed… | ✅ | **Descript** — music under voice (functional). |

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
| Ask model freeform (prompt) | Models → Ask model… | ✅ | **Descript** — Underlord prompt (functional). |
| Ask model: find scenes only | Models → Find scenes | ✅ | **Descript** — scene detection (functional). |
| Run local scene heuristic (no LLM) | Models → Local heuristic; Auto Edit menu; palette | ✅ | **Premiere** — scene detect (functional; different signal). |
| Rebuild intelligence from Models panel | Models → Rebuild intelligence | ✅ | **Descript** — re-analyze (functional). |

---

## 25. Agent panel — natural language actions

| Action | How to invoke | Status | Best reference apps |
|--------|---------------|--------|---------------------|
| Run quick intent: Auto-cut the reel | Agent chip | ✅ | **Descript** — remove silence/filler batch (functional). |
| Run quick intent: Auto-cut, keep tagged demo | Agent chip | ✅ | **Auto-Editor** — boolean keep (functional). |
| Run quick intent: Cut product-name fumble | Agent chip | ✅ | **Descript** — “remove ums and stumbles” (functional). |
| Run quick intent: Find scenes / retakes | Agent chip | ✅ | **Descript** — scene pass (functional). |
| Run quick intent: Collapse retakes | Agent chip | ✅ | **Descript** — retake collapse (functional). |
| Run quick intent: Put back silence | Agent chip | ✅ | **Descript** — undo silence removal (functional). |
| Type custom agent request | Agent textarea + Run tools; ⌘Enter | ✅ | **Cursor** — agent prompt (UI). **WeftCut** — NL timeline edit (functional). |
| View agent tool call log | Agent log list | ✅ | **Cursor** — tool trace (UI transparency). |
| View live editorial brief | Agent brief pre block | ✅ | **WeftCut** — context resource (functional). |
| Preview agent recipe before apply | — | 📋 | **Terraform plan** — preview diff (UI pattern). UX audit P5. |

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

---

## 26. Context menu (right-click) actions

| Surface | Actions | Status | Best reference apps |
|---------|---------|--------|---------------------|
| Word | Dynamic edit choices, Edit text, Copy, Select sentence, Select paragraph, Park playhead | ✅ | **Descript** — right-click script (UI). **macOS** — contextual menu (UI). |
| Gap / pause | Same as gap inspector actions | ✅ | **Descript** — gap menu (functional). |
| Scene | Scene inspector actions + Compare takes | ✅ | **Descript** — scene context (functional). |
| Clip | Copy caption text (if any), Trim in/out, Split, Park at clip start | ✅ | **Premiere** — clip context menu (UI standard). |
| Edit block | Park; suggestion actions; Remove guard; scene menu | ✅ | **GitHub** — timeline event menu (UI). |
| Track | Mute/Unmute, Hide/Show, Lock/Unlock, Remove empty | ✅ | **Premiere** — track header menu (functional). |
| Transcript empty area | Clear selection, Select all, Command palette | ✅ | **Standard** — pane context menu (UI). |
| Timeline empty area | Split at playhead, Snap toggle, Guard toggle, Command palette | ✅ | **Premiere** — timeline menu (functional). |
| App chrome | Undo, Redo, Command palette, Export/Cancel export | ✅ | **macOS** — universal backstop (UI). |

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
| Read keep/demo guards | `get_tags` | ✅ | **Auto-Editor** — keep ranges (functional). |
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
| Ripple delete range / I/O | `ripple_delete` / `ripple_delete_marks` | ✅ | **Premiere** — ripple (functional). |
| Set word text / speaker | `set_word_text` / `set_speaker` | ✅ | **Descript** — correct script (functional). |
| Scene/retake ops | `collapse_retakes`, `keep_take`, `infer_scenes`, … | ✅ | **WeftCut** — agent edits (functional). |
| Generate captions / titles | `generate_captions`, `add_title`, … | ✅ | **WeftCut** — tool surface (functional). |
| Run LLM intelligence pass | `run_intelligence` / `edit_with_intent` | ✅ | **OpenScene** — agent edit (functional). |

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
| See “no markers match filter” on edits lane | Filter edits when zero matches | ✅ | **GitHub** — empty filter state (UI). |
| Sync settings to Electron main on change | Models panel edits → `host.syncSettings` | ✅ | **VS Code** — settings sync (functional). |
| Check ASR binary install status | Models panel provider labels (“not installed”) | ✅ | **Homebrew** — dependency hint (UI pattern). |

---

## 29. Command-bus only (no direct UI — MCP, agent, import pipeline)

These exist in `applyCommand` or run automatically; users cannot trigger them from menus yet.

| Action | How it runs today | Status | Best reference apps |
|--------|-------------------|--------|---------------------|
| Ripple-delete arbitrary source range | MCP `ripple_delete` | 🔶 | **Premiere** — ripple delete selection (UI). |
| Replace entire transcript words | MCP `set_transcript`; import overwrites | 🔶 | **Descript** — replace transcript (functional). |
| Import caption file to V3 (command) | MCP `import_captions` | 🔶 | **Premiere** — import SRT to track (UI). |
| Apply speaker diarization assignments | Auto on import; MCP `apply_diarization` | 🔶 | **Descript** — speaker ID (functional). |
| Merge LLM scene/suggestion draft | Agent/`mergeIntelligence` internally | 🔶 | **Descript** — Underlord merge (functional). |
| Replace whole project JSON | Agent replace; import timeline | 🔶 | **WeftCut** — agent project swap (functional). |
| Set global picture transform (not clip) | `setPicture` command only | 🔶 | **Premiere** — motion on master clip (UI). |
| Mute/unmute single clip | `setMuted` command only | 🔶 | **Premiere** — clip mute (UI). |
| Set/clear proxy path on asset | `setAssetProxy` command only | 🔶 | **Premiere** — proxy toggle (UI). |
| Relink asset by id+path (command) | `relinkAsset`; UI wraps interactive | 🔶 | **Premiere** — relink (UI). |
| Paint Note guard tag | MCP `add_tag` kind `note` only | 🔶 | **Premiere** — marker comments (UI). |
| Toggle ripple vs insert mode | `setRipple` in store, no UI, always ripple | 🔶 | **Premiere** — ripple/insert toggle (UI). |
| Read source↔program cut mapping | MCP `get_mapping` | ✅ | **WeftCut** — EDL introspection (functional). |
| Read cuts with program times | MCP `get_cuts` | ✅ | **Auto-Editor** — cut list (functional). |
| Read compact project snapshot | MCP `get_snapshot` | ✅ | **WeftCut** — slim JSON (functional). |
| Read current selection + marks | MCP `get_selection` | ✅ | **Cursor** — selection context (functional). |
| Set speed on source range | MCP `set_speed` | 🔶 | **Final Cut** — retime tool (UI). |
| Add caption at time (MCP params) | MCP `add_caption` | 🔶 | **Descript** — add caption block (UI). |
| Add zoom at time (MCP params) | MCP `add_zoom` | 🔶 | **Screen Studio** — add zoom keyframe (UI). |
| Replace scenes array wholesale | MCP `set_scenes` | 🔶 | **Descript** — chapter list edit (UI). |
| Run intelligence endpoint directly | MCP `run_intelligence` | 🔶 | **Descript** — analyze pass (functional). |
| Run freeform intent string | MCP `edit_with_intent` | 🔶 | **Agent panel** — same (UI exists via Agent). |

---

## 30. Should have — core editing & timeline (standard NLE)

| Action | Why we need it | Best reference apps |
|--------|----------------|---------------------|
| Toggle Insert vs Ripple edit mode | Overwrite edits without rippling tail | **Premiere** — toggle in timeline (UI). **Avid** — insert/overwrite (functional). |
| Duplicate selected clip/segment | Fast reuse of B-roll block | **Premiere** — Alt+drag duplicate (UI). |
| Nudge clip one frame with visible shortcut hints | Discoverability for overlay moves | **Final Cut** — comma/period (UI). |
| Slip clip (move media inside trim) | Fix sync without moving position | **Premiere** — slip tool (functional). |
| Slide edit (move cut point) | Adjust edit point between clips | **Premiere** — slide tool (functional). |
| Roll trim (shared boundary) | Trim adjacent clips at once | **Premiere** — roll tool (functional). |
| Lift extract (leave gap vs ripple) | Non-destructive experimentation | **Premiere** — lift vs extract (functional). |
| Select all clips on track | Batch operations | **Premiere** — select track (UI). |
| Link / unlink audio-video | Independent audio trim | **Premiere** — chain icon (UI). |
| Nest selection into compound clip | Organize complex sections | **Final Cut** — compound clip (functional). |
| Copy/paste clip attributes | Reuse zoom/fade settings | **Final Cut** — paste attributes (UI). |
| Copy/paste clip at playhead | Standard edit workflow | **Premiere** — clipboard edit (functional). |
| Multi-select clips | Move several overlays | **Premiere** — shift-select (UI). |
| Razor tool in toolbar (visible) | Discoverability | **Premiere** — tool palette (UI). UX audit P5. |
| Split clip at playhead (overlay) from one-click UI | Without opening Advanced | **iMovie** — split button (UI). UX audit P2. |
| Delete gap / close gap manually | After lifting a clip | **Premiere** — delete ripple gap (functional). |
| Extend edit to playhead (E key) | Industry standard | **Premiere** — extend edit (functional). |
| Match frame / open clip in source | Fine trim in source monitor | **Premiere** — match frame (UI). |
| Source monitor separate from program | Two-up editing | **Premiere** — dual monitor (UI). |
| Scrub audio while dragging playhead | Hear while trimming | **Pro Tools** — scrub (functional). |
| Snapping toggle with audible/visual tick | Confidence when snapping | **Final Cut** — snap feedback (UI). |
| Markers generic (not just I/O) | Chapter points, todos | **Premiere** — markers panel (UI). |
| Clear In / Clear Out / Clear both marks | Reset I/O without re-marking | **Premiere** — clear in/out (UI). |
| Go to next / previous marker | Navigate long reels | **Premiere** — shift+M (functional). |
| Replace timeline clip media | Swap file keep timing | **Premiere** — replace footage (UI). |
| Freeze frame | Hold on still | **Final Cut** — hold frame (UI). |
| Reverse clip | Creative + debug | **Premiere** — reverse speed (functional). |
| Detach audio from video | Music-only export region | **Premiere** — unlink (UI). |
| Volume keyframes on clip | Duck manually inside clip | **Audacity** — envelope (UI). |
| Pan / stereo balance | Position voice | **Logic** — pan knob (UI). |
| Mute clip button in inspector | Obvious vs command-only | **Premiere** — mute clip (UI). |
| Solo track / solo clip | Hear one lane | **Reaper** — solo (UI). |
| Transition browser (crossfade, wipe) | More than dissolve-at-playhead | **Final Cut** — transition browser (UI). |
| Drag transition onto cut | Standard NLE UX | **Final Cut** — drag transition (UI). |
| Adjustment layer / grade track | Global color over section | **Premiere** — adjustment layer (UI). |
| Crop handles on program monitor | Visual vs sliders-only | **Final Cut** — on-screen crop (UI). |
| Safe margins / title safe overlay | Caption placement | **Premiere** — overlay guides (UI). |
| Multi-clip sequence (several sources) | Podcast + cam + screen | **Descript** — multitrack (functional). |
| Record voiceover into timeline | Add narration after edit | **Descript** — record insert (UI). |
| Record screen in-app | Capture without leaving | **Screen Studio** — record (functional). |
| Import folder / batch import | Many B-roll stills | **Premiere** — import folder (UI). |
| Media browser / bin panel | Organize assets before edit | **Premiere** — project panel (UI). |
| Search/filter project assets | Find b-roll by name | **Premiere** — search bin (UI). |
| Proxy workflow UI (toggle, status) | Edit heavy 4K on laptop | **Premiere** — proxy badges (UI). |
| Full-screen program monitor | Client review | **Final Cut** — full screen viewer (UI). |
| Playback speed control (0.5×, 2×) | Review faster | **YouTube** — speed control (UI). |
| Audio meters / loudness monitor | Mix confidence | **Premiere** — audio meters (UI). |
| Export queue (multiple jobs) | Batch deliverables | **HandBrake** — queue (UI). |
| Export preset picker (YouTube 1080p, etc.) | One-click targets | **Descript** — export presets (UI). |
| Export audio-only (MP3/WAV) | Podcast output | **Descript** — audio export (functional). |
| Export selected range only | Quick sample | **Audacity** — export selection (functional). |
| Burn-in toggle for captions on export | Optional subtitles track | **Premiere** — export captions setting (UI). |
| Recent projects list | Reopen fast | **VS Code** — recent (UI). |
| Autosave interval indicator | Trust | **Google Docs** — “Saved to Drive” (UI). |
| Project templates (tutorial, podcast, screencast) | Onboarding | **Descript** — templates (UI). |
| Keyboard shortcut cheat sheet | Discoverability | **Descript** — shortcut overlay (UI). |
| Customizable shortcuts | Power users | **Premiere** — keyboard editor (UI). |
| Touch bar / Stream Deck profile | Hardware editors | **Premiere** — control surface (functional). |

---

## 31. Should have — transcript, auto-edit & intelligence

| Action | Why we need it | Best reference apps |
|--------|----------------|---------------------|
| Record audio/video in app | Skip external recorder | **Descript** — record (functional). **Riverside** — remote record (UI). |
| Live transcript during record | Edit while capturing | **Descript** — live transcript (functional). |
| Highlight transcript while playing (auto-scroll) | Follow mode | **Descript** — follow playhead (UI). |
| Pause follow when user scrolls | Don't fight the user | **Descript** — follow toggle (UI). |
| Search & replace in transcript | Bulk typo fix | **Word** — find/replace (UI). |
| Find next / previous match | Step through hits | **VS Code** — F3 (UI). |
| Correct transcript and redistribute timing | Long word → short word sync | **Descript** — text-based retime (functional). |
| Delete silence only (not words) from selection | Less destructive | **Descript** — shorten word gaps (UI). |
| Shorten to breath vs remove entirely (explicit) | User intent clarity | **ux_helper** — Shorten vs Remove (UI). |
| Remove all fillers one click (global) | Obvious entry point | **Descript** — remove fillers (UI). |
| Remove all silence one click (global) | Obvious entry point | **Descript** — remove silence (UI). |
| Preview auto-edit before apply (A/B) | Trust automation | **Lightroom** — before/after (UI). UX P4. |
| Apply auto-edit to selection only | Partial cleanup | **Descript** — edit selection (functional). |
| Reject all pending suggestions | Reset analysis pass | **Gmail** — dismiss all (UI). |
| Adjust silence threshold (advanced dB) | Power users after presets | **Auto-Editor** — `--edit audio` (functional). |
| Per-speaker auto-edit rules | Different hosts, different pace | **Descript** — per-speaker (partial). |
| Detect crosstalk / overlap | Multi-speaker cleanup | **Descript** — studio sound (functional). |
| Studio Sound / noise reduction toggle | One-click audio polish | **Descript** — studio sound (UI). |
| Auto music ducking strength preview | Hear duck before export | **Descript** — duck slider + preview (UI). |
| Tag section as “chapter” for YouTube | Export metadata | **Descript** — chapters (UI). |
| Tag section as “hook” / “CTA” | Shorts workflow | **Opus Clip** — highlight hooks (functional). |
| Note marker on timeline (UI paint) | Editor comments | **Premiere** — marker comments (UI). |
| “Apply to similar pauses” from gap inspector | Batch with context | **ux_helper** — batch intelligence (UI). |
| “Apply to similar fillers” | Batch fillers | **Cleanvoice** — global filler (UI). |
| Compare takes side-by-side (split view) | Real take decision | **Descript** — compare (UI). UX P5. |
| Show waveform difference between takes | Visual diff | **Audacity** — diff (functional). |
| Collapse retakes with preview of saved time | Consequence before commit | **ux_helper** — consequence copy (UI). |
| Detect false starts separately from retakes | Finer semantics | **Descript** — retake types (functional). |
| “Use another take” from transcript search | Find all attempts of line | **feature_explosion** — semantic (vision). |
| Edit by transcript outline (sections tree) | Structure-first edit | **Descript** — sidebar outline (UI). |
| Drag scene boundaries | Retime chapters | **Descript** — scene edges (UI). |
| Merge scenes | Combine sections | **Descript** — merge scenes (functional). |
| Split scene at playhead | New chapter | **Descript** — split scene (UI). |
| Generate episode title from content | Metadata | **Descript** — AI titles (functional). |
| Summarize selection for description | YouTube description | **ChatGPT** — summarize (functional). |
| Detect and list “uncertain” edits only | Focus review | **Gmail** — priority inbox (UI pattern). |
| Thumbs up/down on auto-edit decision | Train preferences | **Gmail** — feedback (functional). |
| Export inspectable edit recipe (checkboxes) | LLM → rules | **feature_explosion #8** — **Auto-Editor** CLI (functional). |
| Re-run only one analysis pass (silence only) | Faster iteration | **Auto-Editor** — modular analysis (functional). |
| Import forced alignment after text edit | Sync after heavy rewrite | **Descript** — alignment (functional). |
| Multi-language transcript | Global creators | **Sonix** — languages (functional). |
| Translate captions | Localization | **CapCut** — auto translate (UI). |
| Burn highlight keywords in captions | Shorts emphasis | **CapCut** — keyword styles (UI). |
| Caption animation presets (pop, karaoke) | Social polish | **CapCut** — animation (UI). |
| Caption safe-zone preview for 9:16 | Vertical video | **CapCut** — aspect preview (UI). |
| Auto reframing for vertical export | Shorts from horizontal | **CapCut** — auto reframe (UI). |
| Detect faces for caption placement | Avoid covering face | **Descript** — smart captions (functional). |
| Blur faces automatically | Privacy | **Descript** — face blur (UI). |
| Detect and blur emails/phones (CV) | Redaction at scale | **feature_explosion** — **YouTube** face blur (partial). |
| Speed ramp UI (handles) | Beyond segment speed slider | **Final Cut** — speed ramp (UI). |
| Compress loading screens (detect + UI) | Tutorial pacing | **Screen Studio** — auto compress (functional). |
| “Make 8 minutes” duration compiler | Constraint edit | **feature_explosion #7**. |
| Failure/success attempt picker | Debug montage vs solution only | **feature_explosion #11**. |
| Cross-modal search UI | Speech + screen | **Rewind.ai** (functional). |
| Semantic event list panel | Edit events not frames | **feature_explosion #1**. |
| Post-export QA lint panel | Jump-cut warnings | **feature_explosion #20**. |
| Style learning from undos | Personal auto-edit | **feature_explosion #17**. |
| Branching versions (Detailed / Short / TikTok) | Repurpose | **feature_explosion #18**. |
| One-click content package export | Long + shorts + SRT + chapters | **feature_explosion #19**. |

---

## 32. Should have — screencast & tutorial polish

| Action | Why we need it | Best reference apps |
|--------|----------------|---------------------|
| Auto zoom on click | Screencast staple | **Screen Studio** — click zoom (functional). |
| Auto zoom on cursor movement | Follow mouse | **Tella** — cursor follow (UI). |
| Smooth cursor path | Remove jitter | **FocuSee** — smooth cursor (functional). |
| Cursor highlight ring on click | Viewer attention | **Screen Studio** — click ring (UI). |
| Hide idle cursor | Cleaner frame | **Tella** — idle hide (functional). |
| Custom cursor size/color | Branding | **Screen Studio** — cursor styles (UI). |
| Reconstruct cursor from imported MP4 | Post-hoc polish | **FocuSee** (functional). **feature_explosion #4**. |
| Zoom to active window/control (OCR) | UI-aware framing | **Screen Studio** (functional). |
| Highlight keystrokes on screen | Tutorial clarity | **ScreenFlow** — keystroke overlay (UI). |
| Show click ripple at coordinates | Emphasize clicks | **Screen Studio** (UI). |
| Auto jump-cut camouflage (punch-in) | Hide hard cuts | **Descript** — speaker zoom (emerging). |
| Picture-in-picture webcam layout presets | Talking head + screen | **Loom** — layouts (UI). |
| Teleprompter while recording | Scripted delivery | **Descript** — teleprompter (UI). |
| Code-aware lower thirds (file:line) | Dev tutorials | **feature_explosion #15**. |
| VS Code extension for exact file/line metadata | Precision | **feature_explosion #15**. |
| Terminal command overlay | Show command text | **ScreenFlow** — text actions (UI). |
| Mouse trail / spotlight | Focus | **DemoCreator** — spotlight (UI). |
| Blur specific window/title bar | Privacy | **Descript** — blur region (UI). |
| Track window focus changes as events | Semantic timeline | **feature_explosion** — event graph (vision). |

---

## 33. Should have — UX, onboarding & agent

| Action | Why we need it | Best reference apps |
|--------|----------------|---------------------|
| Empty transcript: Open media card | Guided start | **Descript** — empty CTA (UI). UX P3. |
| Empty transcript: Drop transcript card | Second path | **Descript** (UI). UX P3. |
| Empty transcript: Try demo card | Zero friction | **Framer** — templates (UI). UX P3. |
| Empty project inspector guidance | What to do first | **Descript** — checklist (UI). UX P3. |
| Workflow breadcrumb (Import→Analyze→Polish) | Orientation without wizard | **ux_helper** — **TurboTax** steps (UI). |
| MCP setup wizard in inspector | Agent discoverability | **Cursor** — MCP config (UI). UX P3. |
| Agent recipe preview (checkboxes) before apply | Trust NL edits | **Terraform plan** (UI). UX P5. |
| “Why not safe?” on every blocked suggestion row | Already in inspector; need in drawer | **Descript** — explain AI (UI). |
| Consequence line on every destructive button | ux_helper mandate | **Superhuman** — action copy (UI). |
| Next-step chip after every batch apply | Guided flow | **ux_helper** — breadcrumbs (UI). |
| Context menu on suggest bar | Power without menus | **macOS** — contextual (UI). |
| Drag-and-drop media on timeline | Not just menu import | **Premiere** — drop to timeline (UI). |
| Drag-and-drop media on empty monitor | Import affordance | **iMovie** — drop zone (UI). |
| Drag clip between tracks | Move lane | **Premiere** — drag track (UI). |
| Undo history panel (list) | Selective undo | **Photoshop** — history panel (UI). |
| Pin favorite palette commands | Personal workflow | **VS Code** — pin commands (UI). |
| Command palette recent commands | Faster repeat | **Raycast** — recents (UI). |
| In-app keyboard shortcut overlay | ? key | **Descript** — shortcuts (UI). |
| Tooltip tour for first run | Onboarding | **CapCut** — first-run tour (UI). |
| “What's new” after update | Feature discovery | **Slack** — what's new (UI). |
| Redaction button when overlay clip selected | Obvious blur | **Descript** (UI). UX P5. |
| Edits lane summary when crowded (>10) | Reduce noise | **Jira** — collapse (UI). UX P4. |
| Monitor layout for audio-only projects | Podcast mode | **Audacity** — waveform hero (UI). UX P6. |
| Consistent theme tokens (no hardcoded colors) | Polish | **VS Code** — theme (functional). UX P6. |
| Share read-only review link | Client approval | **Frame.io** — review link (functional). |
| Comments on timeline for collaborators | Team edit | **Frame.io** — comments (UI). |
| Version history / named snapshots | Experiment safely | **Google Docs** — version history (UI). |
| Plugin / extension marketplace | Community tools | **VS Code** — extensions (functional). |

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
| Insert silence / gap clip | ReScript roadmap |
| Regenerated speech / Overdub | ReScript roadmap |
| Multi-clip projects | ReScript roadmap |
| Forced alignment / Parakeet ASR | ReScript / Auto-Editor ecosystem |
| Voice clone word replace | ReScript roadmap |
| Hide empty tracks by default | UX P2 |
| Clip basics without Advanced | UX P2 |
| Original/Edited preview toggle | UX P4 |
| Compare takes A/B loop | UX P5 |

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

*Last audited: Aug 25, 2026 — codebase + docs. **~235 shipped** user actions · **~20 command-bus-only** · **~120 should-have gaps** (§30–33).*
