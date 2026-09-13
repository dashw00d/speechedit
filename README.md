# SpeechEdit

The local-first reel: transcript NLE + Auto Edit + native FFmpeg. One command bus. The project JSON is the source of truth.

```
Transcript / timeline / Auto Edit / shortcuts / palette
                         │
                  editor commands
                         │
                    project store
               ┌─────────┴─────────┐
               ▼                   ▼
        program monitor      FFmpeg export
        (cut-skip, zoom,     (speed, captions,
         captions)            zooms, fades)
```

## Run

Needs `ffmpeg` / `ffprobe` on PATH for development. The Windows ZIP bundles both and checks them at startup; if either binary is missing, SpeechEdit shows one recovery message and refuses import and export. Transcription is pluggable: Whisper on PATH, or any OpenAI-compatible ASR (Speaches, faster-whisper-server, Groq, OpenAI). A second local or API model can group scenes and retakes.

```bash
bun install
bun run dev        # Electron
bun run dev:web    # renderer; studio demo works
bun test
```

On WSL, if the window never appears: `NO_SANDBOX=1 bun run dev`.

The window title, Preferences, and Project → Advanced show the version and git commit. **Copy build id** pastes a diagnostic for a run record. The desktop window can shrink to 960×600 so a 1280×720 laptop still fits after the taskbar; Alt+1–4 switch Preview / Review / Script / Timeline when a pane is collapsed.

For the path from development build to real-footage dogfooding and private alpha, follow the [real-video validation roadmap](docs/real_video_validation_roadmap.md).

## Web demo deployment

The web demo is a small server application, not a static `dist/` upload. The server serves the built editor, keeps the OpenRouter credential private, forces Assistant requests through `openrouter/free`, and caches browser Whisper model files.

For a command-based Bun service:

```bash
bun install --frozen-lockfile
bun run build:web
bun run start:web
```

Set `OPENROUTER_API_KEY` as a secret in the hosting platform. Do not upload the local `.env`; `.env.example` lists the supported variables without credentials. The service listens on the platform-provided `PORT` (3000 by default), binds `0.0.0.0`, and exposes `GET /healthz`.

For a Docker service, build the included `Dockerfile`, expose port 3000, and mount `/data` if the platform supports persistent volumes. Without a volume the app still works, but the server refetches its Whisper cache after a container replacement. The first browser still downloads and locally caches the approximately 114 MiB browser Whisper model.

### WebGPU on ServerChirp

Serve the public app over **HTTPS** and deploy the full web server plus its matching `src/renderer/dist` build. WebGPU uses the visitor's device; the ServerChirp machine does not need a GPU. The browser must expose WebGPU and return a usable GPU adapter. See the [ONNX Runtime deployment requirements](https://onnxruntime.ai/docs/tutorials/web/deploy.html).

Whisper checks the adapter before loading the GPU model. If GPU initialization or transcription fails, it starts CPU compatibility mode in a fresh worker and automatically retries the recording. **View → Project settings → Whisper transcription** shows the active backend and why compatibility mode was selected. Check that message on the affected browser; HTTPS, browser graphics acceleration, and device drivers can affect GPU availability.

Recording imports start Whisper automatically, including CPU compatibility mode. Finished transcription creates missing chapters while preserving existing chapter edits. If transcription fails, the Transcript panel displays a large **TRANSCRIBE** button to retry. For older projects that already have words but no chapters, click **Find chapters** in the Transcript header. Transcription can also be rerun from **Transcript → Options**; Undo restores the previous result.

Both the ONNX runtime `.mjs` and `.wasm` files ship as versioned assets with the editor. Keep their JavaScript and WebAssembly MIME types intact through the hosting proxy. Runtime loading does not require jsDelivr. Model downloads still use the server's Hugging Face cache, with a direct Hub fallback.

To check a local production build in an isolated Electron browser profile:

```bash
bun run build:web
bun run start:web
# In another terminal; requires a graphical session:
bun run smoke:whisper http://127.0.0.1:3000
bun run smoke:transcription http://127.0.0.1:3000
```

The transcription UI smoke test uses deterministic worker responses to check automatic CPU fallback, chapter creation, and recovery through the Transcribe button.

The Whisper smoke test blocks the runtime CDN, checks that both runtime assets came from this server, initializes Whisper, and transcribes a one-second silent fixture. It reports `webgpu` or `wasm` and any fallback reason. Set `SPEECHEDIT_EXPECT_BACKEND=webgpu` to require a GPU result on a compatible test machine. Run against the same build as the local source; the script uses its worker asset filename.

## Windows validation build

Build the current Windows x64 test package from Windows or WSL:

```bash
bun run package:win
```

The command downloads checksum-pinned FFmpeg 6.1.1 and FFprobe binaries, builds Electron, and writes `release/SpeechEdit-<version>-windows-x64.zip`. Extract the ZIP on Windows and run `SpeechEdit.exe`; Bun, Node, FFmpeg, and FFprobe are not required on the test machine. `bun run package:win:dir` produces the unpacked directory directly for faster packaging diagnostics.

The package is an unsigned internal validation build. Windows may warn before first launch. Local whisper.cpp installs on first transcription; remote transcription remains configurable in Models.

## Everyday editing

- Click a word or drag across several to select them. **Preview** plays the selection; **Remove** cuts it from the recording. Separate word selections leave the speech between them alone.
- Use **Correct word** to fix a transcription mistake. Select crossed-out words and choose **Restore words** to bring them back. **Undo** and **Redo** stay in the top bar.
- Click a pause or chapter to select it without starting playback. Use its explicit preview and editing controls. Double-clicking a pause does not remove it.
- **Trim** on the timeline explains how to remove a clip's beginning or end. Sliders also accept exact numbers. Smaller windows use **Transcript / Preview / Review / Timeline** tabs and preserve your selection as you switch.
- **Save** keeps an editable project; **Export** creates the finished output. **Help** includes a short walkthrough and keyboard shortcuts. **Ctrl+K** (Mac: **⌘K**) finds editing actions.

## What it does that used to take three apps

**ReScript**
- Word-level transcript, fillers, restore
- Drop SRT / VTT / JSON
- Caption remaining words onto V3
- Whisper if installed; speech islands if not

**Shotcut**
- Multi-track tape (V3 captions, V2 overlays, V1 picture, A1 voice)
- Razor, ripple I/O, snap, trim, move, zoom, titles
- Transform / speed / volume / fades / keyframes
- Export burns the program, not a cut list of the source

**Auto-Editor**
- Silence, fillers, static-screen 4×, loudness, pace
- Review or apply safe cuts
- Same `deleteRange` / `setSpeed` as the mouse

`⌘K` is the command palette. `⌘J` opens Assistant in the Inspector (activity and tool results stay there; successful edits are undoable with `⌘Z`). `I` / `O` set marks. Delete ripples them.

## Models and agents

View → Project settings sets transcript + intelligence providers: Ollama, any OpenAI-compatible `/v1` server, Codex CLI, or Grok CLI. **Refresh models / Check CLI** verifies discovery; **Test real reply** runs a structured completion. Model work is serialized through one visible FIFO queue so Assistant, scene analysis, and health checks cannot overload the provider. Edit → Ask assistant… uses local heuristics if no model is configured; otherwise the provider sees the editorial brief and emits the same reversible commands the UI uses.

The CLI providers use the account already signed into each tool. Codex runs its supported headless `codex exec` mode with a read-only sandbox and ephemeral session (`-p` is a profile flag in current Codex versions). Grok runs its single-turn `grok -p` mode with tools/web/subagents disabled. On Windows, SpeechEdit uses the Windows Codex installation and can reach a WSL Grok installation through `wsl.exe`.

```bash
bun run mcp
```

The stdio MCP server exposes the complete editing tool catalog plus project/context/status resources, reusable edit/review/retake prompts, argument completion, structured tool results, and read/write safety annotations. When Electron is running, a local user-only bridge executes tools against the in-memory reel and updates the UI. Otherwise the server uses atomic writes against `~/.speechedit/current.speechedit.json` (or `SPEECHEDIT_PROJECT`). Under WSL it automatically finds the Windows SpeechEdit workspace. Point an MCP client at `bun src/mcp/server.ts`.

Menus follow the scope of the action:

- **File** groups opening, importing, saving, and exporting. **Edit** contains history, command search, review, and Assistant. **View** opens workspace panels, project settings, preferences, and help.
- **Preview or Timeline → + Add** adds titles, labels, captions, zooms, blur, B-roll, and music. Select words or a chapter first to place effects on that range. The first title is an opening title; subsequent titles use the playhead.
- **Selected words → More** contains sentence/paragraph selection, splitting, protection, quote copying, and other word actions. **Selected chapter → Chapter options** contains rename, split, merge, and protection. **Transcript → Options / Copy** contains speakers, captions, chapter labels, notes, chapter text, and SRT export.
- **Timeline** keeps splitting, trimming, gaps, notes, track settings, and dissolves beside the clips. **Clip actions** appears for a selected clip or a copied clip. **Protect marked** appears only when both In and Out are set.
- **Review edits → Review tools** finds and refreshes suggestions, applies available safe or AI cuts, and puts back applied edits by type. Decisions about an individual pause or retake stay beside that selection and in its inspector.
- **Inspector** holds selected-item adjustments and title styles. **View → Project settings → Picture, sound, and export** holds whole-project loudness normalization. **Export** holds output settings and interchange formats, including OpenTimelineIO and FCPXML.

The command palette remains an additional searchable route to advanced actions.


### One-click quick edits

Open **Quick edit** above the transcript (also under **Edit → Quick edit presets**), then click a recipe:

- **Livestream cleanup:** safe dead-air/filler cleanup, natural spacing, and level sound; repeated remarks stay.
- **Feature presentation:** tighter speech, detected retakes removed, an opening title, and level sound.
- **Tutorial:** wider speech padding, only long dead-air cuts, and detected demonstrations preserved.
- **Short highlight:** one spoken chapter, aiming for 60 seconds, tighter speech, and a vertical frame. Existing protected moments stay even when the result is longer. Check framing before export.

Captions are on by default; manual caption/title cards are preserved. Optional **Use AI** sends the transcript to the configured Assistant provider for additional cut suggestions (and a chapter choice for highlights). Local mode makes no AI calls. Only bounded, high-confidence AI cuts are applied; other suggestions remain available for review. AI errors or a 45-second timeout fall back to the local recipe. Cancel or a project change during analysis discards the pending result.

Recipes compose existing commands on a temporary project and commit once. The result shows duration and changes, with Play, Inspect edits, Export, and **Undo this preset**. Export remains a separate action.
