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

`⌘K` is the command palette. `I` / `O` set marks. Delete ripples them.

## Models and agents

Inspector → Project sets transcript + intelligence endpoints (Ollama, Groq, OpenAI, or any `/v1` server). Auto Edit → Ask model… uses local heuristics if no LLM is configured, otherwise the model sees the full editorial brief and emits the same commands the UI uses.

```bash
bun run mcp
```

stdio MCP tools (`get_context`, `cut_words`, `edit_with_intent`, `run_intelligence`, …) read/write `~/.speechedit/current.speechedit.json` (or `SPEECHEDIT_PROJECT`). Point Cursor at `bun src/mcp/server.ts`. The Electron app mirrors the live reel there on every edit.

File / Sequence / Export also cover B-roll stills and video, fades, SRT captions, OpenTimelineIO, and FCPXML — so you can leave SpeechEdit only when you choose to.
