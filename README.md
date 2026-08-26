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

Needs system `ffmpeg` / `ffprobe`. Transcription is pluggable: Whisper on PATH, or any OpenAI-compatible ASR (Speaches, faster-whisper-server, Groq, OpenAI). A second local or API model can group scenes and retakes.

```bash
bun install
bun run dev        # Electron
bun run dev:web    # renderer; studio demo works
bun test
```

On WSL, if the window never appears: `NO_SANDBOX=1 bun run dev`.

For the path from development build to real-footage dogfooding and private alpha, follow the [real-video validation roadmap](docs/real_video_validation_roadmap.md).

## Windows validation build

Build the current Windows x64 test package from Windows or WSL:

```bash
bun run package:win
```

The command downloads checksum-pinned FFmpeg 6.1.1 and FFprobe binaries, builds Electron, and writes `release/SpeechEdit-<version>-windows-x64.zip`. Extract the ZIP on Windows and run `SpeechEdit.exe`; Bun, Node, FFmpeg, and FFprobe are not required on the test machine. `bun run package:win:dir` produces the unpacked directory directly for faster packaging diagnostics.

The package is an unsigned internal validation build. Windows may warn before first launch. Local whisper.cpp installs on first transcription; remote transcription remains configurable in Models.

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

Inspector → Project sets transcript + intelligence providers: Ollama, any OpenAI-compatible `/v1` server, Codex CLI, or Grok CLI. **Refresh models / Check CLI** verifies discovery; **Test real reply** runs a structured completion. Model work is serialized through one visible FIFO queue so Assistant, scene analysis, and health checks cannot overload the provider. Auto Edit → Ask model… uses local heuristics if no model is configured; otherwise the provider sees the editorial brief and emits the same reversible commands the UI uses.

The CLI providers use the account already signed into each tool. Codex runs its supported headless `codex exec` mode with a read-only sandbox and ephemeral session (`-p` is a profile flag in current Codex versions). Grok runs its single-turn `grok -p` mode with tools/web/subagents disabled. On Windows, SpeechEdit uses the Windows Codex installation and can reach a WSL Grok installation through `wsl.exe`.

```bash
bun run mcp
```

The stdio MCP server exposes the complete editing tool catalog plus project/context/status resources, reusable edit/review/retake prompts, argument completion, structured tool results, and read/write safety annotations. When Electron is running, a local user-only bridge executes tools against the in-memory reel and updates the UI. Otherwise the server uses atomic writes against `~/.speechedit/current.speechedit.json` (or `SPEECHEDIT_PROJECT`). Under WSL it automatically finds the Windows SpeechEdit workspace. Point an MCP client at `bun src/mcp/server.ts`.

File / Sequence / Export also cover B-roll stills and video, fades, SRT captions, OpenTimelineIO, and FCPXML — so you can leave SpeechEdit only when you choose to.
