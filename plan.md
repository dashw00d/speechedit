Yes. And I think there is a **very sane way to build it** without actually merging three giant codebases.

The biggest realization is that **ReScript is already Electron + React + TypeScript + Zustand**. So you’re not really replacing ReScript’s architecture. You’d be turning ReScript into a real NLE and replacing Shotcut with a modern Electron-native editing layer. ([GitHub][1])

I’d build this:

```text
┌────────────────────────────────────────────────────────────┐
│                    ELECTRON APP                            │
│                                                            │
│  Transcript       Program Monitor       Inspector          │
│  ┌─────────┐      ┌───────────────┐    ┌─────────────┐    │
│  │ ReScript│      │ Pixi/WebCodecs│    │ Transform   │    │
│  │ editing │      │ preview       │    │ Audio       │    │
│  │ words   │      │               │    │ Captions    │    │
│  │ fillers │      │               │    │ Effects     │    │
│  └─────────┘      └───────────────┘    └─────────────┘    │
│                                                            │
│  ┌──────────────── TIMELINE ────────────────────────────┐  │
│  │ V3  captions / titles                               │  │
│  │ V2  images / zooms / overlays                       │  │
│  │ V1  ██████ █████████   ████     ███████████         │  │
│  │ A1  ██████ █████████   ████     ███████████         │  │
│  │     waveform + transcript + auto-edit suggestions   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
            │                  │
            ▼                  ▼
     analysis worker       native FFmpeg
     ┌─────────────┐       ┌──────────────┐
     │ Whisper     │       │ decode       │
     │ diarization │       │ proxies      │
     │ silence     │       │ thumbnails   │
     │ motion      │       │ render       │
     │ auto edits  │       │ hw encode    │
     └─────────────┘       └──────────────┘
```

## I would NOT use MLT as the heart anymore

I was leaning MLT earlier because it's mature and is literally designed as an NLE engine. It supports tracks, filters, transitions, animated parameters, motion tracking, hardware acceleration, serialization, etc. ([MLT Framework][2])

But if your goal is:

> **modern Electron video editor + transcript editing + automation**

I'd now make **your own timeline JSON the source of truth**.

Something conceptually like:

```ts
Project {
  fps: 30,
  width: 1920,
  height: 1080,

  assets: {...},

  tracks: [
    {
      type: "video",
      clips: [...]
    },
    {
      type: "audio",
      clips: [...]
    },
    {
      type: "caption",
      clips: [...]
    }
  ],

  transcript: {...},

  editSuggestions: [...]
}
```

Then export adapters can generate:

```text
Our project
   ├── MP4
   ├── OTIO
   ├── FCPXML
   ├── Premiere XML
   ├── Shotcut MLT
   ├── Kdenlive
   └── Auto-Editor v3
```

OpenTimelineIO is specifically intended to be an interchange model for editorial timelines rather than the media/rendering engine itself, so supporting OTIO would be worthwhile too. ([GitHub][3])

That avoids painting yourself into:

> "Shotcut XML is secretly our database."

---

# The coolest part: someone is already proving this architecture

I found a tiny/new project called **WeftCut**, and its architecture is *almost exactly what I would propose for yours*:

**Electron + React 19**
**PixiJS + WebCodecs preview**
**Rust native core via napi-rs**
**FFmpeg decode/encode**
**MCP editing API**

([GitHub][4])

They've even split FFmpeg cleverly:

```text
Electron / React
       │
       ▼
PixiJS / WebCodecs
real-time preview
       │
       ▼
Rust native core
decode / audio / analysis
       │
       ▼
FFmpeg CLI
final encode / mux
```

And WeftCut itself is MIT. ([GitHub][5])

I wouldn't necessarily fork it because it's extremely young, but I would **absolutely raid its architecture for ideas**.

---

# Your app would essentially have four engines

### 1. ReScript engine: words

Keep almost everything good about ReScript:

```text
Whisper
   ↓
word timestamps
   ↓
speaker diarization
   ↓
transcript

delete sentence
      ↓
timeline clip disappears

restore sentence
      ↓
timeline returns

remove fillers
remove silence
correct transcript
captions
```

Current ReScript already gives you word-level timestamps, diarization, timeline trimming, cut regions and live cut-skipping preview. ([GitHub][1])

So that is a **huge head start**.

---

# 2. Auto-Editor engine: mechanical intelligence

Don't think of Auto-Editor as an editor anymore.

Turn it into:

> **Analysis → suggested timeline operations**

Example:

```text
Audio analysis

00:00–00:13  active
00:13–00:16  silence 2.8 sec
00:16–00:44  active
00:44–00:46  silence 1.2 sec
00:46–01:02  active
```

It gives the app:

```json
{
  "suggestions": [
    {
      "type": "silence",
      "start": 13.1,
      "end": 15.9,
      "action": "cut"
    }
  ]
}
```

Then the UI can show:

```text
AUTOMATIC EDITS

15 silence cuts           [Apply]
8 filler words            [Apply]
3 repeated sentences      [Review]
2 static screen regions   [Speed 4×]
6 low-motion regions      [Review]
```

That's vastly better UX than:

```text
Run Auto-Editor
→ get modified video
→ import modified video
```

Auto-Editor's timeline format has already evolved into a real nonlinear v3 format with overlapping video/audio layers. ([Auto-Editor][6])

And the repository's code is released into the public domain, although its current distributed product has some separate/licensed pieces that you'd want to audit rather than blindly bundle. ([GitHub][7])

---

# 3. NLE engine: your Shotcut replacement

This is the part I'd build rather than port Shotcut.

For your use case, you don't need 900 filters.

You need:

```text
CORE
✓ multiple tracks
✓ trim
✓ split
✓ ripple delete
✓ move
✓ snapping
✓ undo/redo
✓ linked audio/video

VISUAL
✓ position
✓ scale
✓ crop
✓ opacity
✓ rotation
✓ keyframes
✓ easing
✓ picture-in-picture
✓ images
✓ titles
✓ transitions

AUDIO
✓ volume
✓ fade
✓ normalize
✓ mute
✓ basic EQ/compressor eventually

SCREENCAST
✓ zoom regions
✓ pan
✓ cursor highlight
✓ cursor follow
✓ blur/redaction

TEXT
✓ captions
✓ subtitle styling
✓ titles
✓ lower thirds
```

That gets you **95% of what you'd use Shotcut for** without writing Photoshop After Effects Premiere Resolve Studio 3000.

---

# 4. Rendering engine

Here's where I'd make a significant change to ReScript.

ReScript currently relies heavily on **ffmpeg.wasm**. ([GitHub][1])

Fine for the web version.

For Electron?

Screw that.

Bundle/use **native FFmpeg**.

```text
Electron
   │
   ├─ ffprobe
   │    └─ metadata
   │
   ├─ ffmpeg
   │    ├─ proxy generation
   │    ├─ thumbnails
   │    ├─ waveform
   │    ├─ audio extraction
   │    └─ final render
   │
   └─ hardware encoders
        ├─ QSV
        ├─ NVENC
        ├─ AMF
        └─ VideoToolbox
```

That also opens the door to much faster exports and proxies.

---

# Preview is the actually hard problem

The timeline isn't the scary part.

**Real-time composited preview is.**

You don't want to run FFmpeg every time somebody moves a title twelve pixels.

This is where:

### PixiJS + WebCodecs

becomes really attractive.

There's already an emerging class of React video editors doing this.

For example OpenVideo uses:

```text
React
Zustand
PixiJS 8
WebCodecs
multi-track timeline
interactive canvas
GPU effects
local rendering
```

([GitHub][8])

There's also **Elah**, which has a renderer-independent timeline core plus WebGL2 preview and MP4 rendering. ([GitHub][9])

So your preview can be:

```text
                  PROJECT
                     │
              Timeline Resolver
                     │
        ┌────────────┴─────────────┐
        ▼                          ▼
    WebCodecs                  WebAudio
 decode frames                decode audio
        │                          │
        ▼                          │
     PixiJS                        │
        │                          │
        └──────────┬───────────────┘
                   ▼
              Program Monitor
```

Then your final export converts those exact timeline operations into FFmpeg operations.

---

# I'd use Rust eventually

Not because Electron/JS can't do it.

Because the gross stuff eventually becomes:

```text
decode indexes
frame seeking
waveform generation
motion detection
scene detection
proxy management
thumbnail generation
audio analysis
cursor detection
optical flow
```

Those things belong in:

```text
/native
    media-probe
    waveform
    thumbnails
    silence
    motion
    frame-index
```

compiled with Rust and exposed through `napi-rs`.

Exactly the pattern WeftCut is using. ([GitHub][4])

But **I would not start there**.

Start by spawning FFmpeg and Auto-Editor-style workers.

Only native-ize something when profiling proves JS/process overhead is actually hurting you.

---

# And I'd make one architectural decision from DAY ONE

Everything that edits the video invokes the **same command system**.

Not:

```text
Transcript has its own edits
Timeline has its own edits
AI has its own edits
Auto Editor has its own edits
```

Instead:

```ts
splitClip()
trimClip()
deleteRange()
rippleDelete()
moveClip()
setSpeed()
setTransform()
addCaption()
addKeyframe()
```

The mouse calls them.

The transcript calls them.

Auto-Editor calls them.

An AI agent calls them.

Keyboard shortcuts call them.

For example:

```text
USER deletes transcript sentence
              │
              ▼
       deleteRange(42.1, 45.8)
              │
              ▼
         project store
              │
              ▼
         timeline updates
```

and:

```text
AUTO EDITOR
detects silence
              │
              ▼
       deleteRange(42.1, 45.8)
              │
              ▼
         SAME PATH
```

Then later:

```text
AI:
"Remove dead air, tighten the intro,
zoom into VS Code whenever I'm typing,
and caption everything."

                    ↓

              editor commands
```

That architecture is **absurdly powerful**.

---

# The UI I'd make

I wouldn't copy Shotcut.

I'd basically make:

```text
┌───────────────────────────────────────────────────────┐
│ File   Edit   Auto Edit                     Export    │
├──────────────┬─────────────────────┬──────────────────┤
│              │                     │                  │
│ TRANSCRIPT   │       VIDEO         │    INSPECTOR     │
│              │                     │                  │
│ So today     │                     │ Transform        │
│ we're going  │                     │ X       0        │
│ to build...  │                     │ Y       0        │
│              │                     │ Scale   100%     │
│ [um]         │                     │                  │
│              │                     │ Zoom             │
│ First I'll.. │                     │ Caption          │
│              │                     │ Audio            │
├──────────────┴─────────────────────┴──────────────────┤
│ V3  CAPTIONS ════════╪═══════════════                 │
│ V2  OVERLAY          │     ███████                    │
│ V1  █████████ ███████│████████ █████████████          │
│ A1  ▂▃▄▆██▄▃▂ ▃▆█████│█▆▄▂▃▅██████▅▂                  │
│     ────────────────┼──────────────────────────────   │
│                    01:42                              │
├───────────────────────────────────────────────────────┤
│ ✨ 23 suggested edits  [Review] [Apply safe edits]    │
└───────────────────────────────────────────────────────┘
```

That feels like **ReScript grew up into a video editor**, rather than three applications glued together.

---

## One thing that changes what I'd fork

There is a licensing issue.

**Current ReScript is PolyForm Noncommercial**, not MIT. You can modify/use/share it noncommercially, but you can't just turn the current codebase into a commercial distributed product without permission. ([GitHub][1])

So:

**Personal/internal project:**
Fork ReScript. Absolutely.

**Potential product/commercial app:**
I'd probably start from an **MIT Electron NLE skeleton such as OpenScene or architectural pieces from WeftCut**, then reproduce/import the ReScript transcript-editing concepts. OpenScene is already Electron + React + FFmpeg and MIT. ([GitHub][10])

The transcript portion is not some impossible secret sauce. The core abstraction is just:

```text
Word {
  text
  start
  end
  speaker
  deleted
}
```

plus range edits.

---

# My build order would be surprisingly aggressive

**Phase 1**

```text
ReScript fork
+
native FFmpeg
+
real multi-track project model
```

Get:

**transcript editing + proper NLE timeline**

working together.

**Phase 2**

Add:

```text
video/image tracks
drag/drop
split
ripple
transforms
titles
captions
undo/redo
native render
```

At that point you can stop opening Shotcut.

**Phase 3**

Integrate Auto-Editor logic:

```text
silence
motion
loudness
static-screen
pace
margins
automatic speed-up
```

**Phase 4**

The fun stuff:

```text
automatic cursor detection
automatic zoom targets
click detection
screen-change detection
AI bad-take detection
AI chapter detection
automatic B-roll suggestions
caption templates
cursor smoothing
```

And then you've basically built:

> **Descript + Auto-Editor + Shotcut + Tella, local-first.**

The most interesting discovery from looking at the 2026 ecosystem is that you **wouldn't actually be inventing the difficult rendering architecture anymore**. Projects like WeftCut, OpenVideo, Elah and OpenScene are already demonstrating the Electron/React/WebCodecs/Pixi/Rust/FFmpeg pieces individually. ([GitHub][4])

So I think this is much less insane than “fork Shotcut and somehow shove ReScript into it.”

[1]: https://github.com/wassgha/rescript?utm_source=chatgpt.com "GitHub - wassgha/rescript: 🎬 Open source, transcript-based video/audio editor that lives in the browser. · GitHub"
[2]: https://www.mltframework.org/features/?utm_source=chatgpt.com "MLT - Features"
[3]: https://github.com/OpenTimelineIO?utm_source=chatgpt.com "OpenTimelineIO · GitHub"
[4]: https://github.com/UncleChair/WeftCut?utm_source=chatgpt.com "GitHub - UncleChair/WeftCut: Free, open-source AI video editor for macOS, Windows and Linux — drive the whole timeline from Claude, Cursor, or any MCP client. · GitHub"
[5]: https://github.com/UncleChair/WeftCut/blob/main/THIRD-PARTY-NOTICES.md?utm_source=chatgpt.com "WeftCut/THIRD-PARTY-NOTICES.md at main · UncleChair/WeftCut · GitHub"
[6]: https://auto-editor.com/docs/v3?utm_source=chatgpt.com "The v3 format"
[7]: https://github.com/WyattBlue/auto-editor/blob/master/LICENSE?utm_source=chatgpt.com "auto-editor/LICENSE at master · WyattBlue/auto-editor · GitHub"
[8]: https://github.com/openvideodev/react-video-editor?utm_source=chatgpt.com "GitHub - openvideodev/react-video-editor: Online react video editor using remotion. Capcut and canva clone. · GitHub"
[9]: https://github.com/elahlabs/elah?utm_source=chatgpt.com "GitHub - elahlabs/elah: Elah is a browser-native video editing framework and toolkit for building high-performance editing experiences on the web. It provides modular editor infrastructure, timeline systems, playback architecture, and developer-focused APIs designed for modern video applications. · GitHub"
[10]: https://github.com/Theorvane/openscene?utm_source=chatgpt.com "GitHub - Theorvane/openscene: A local-first desktop video editor with an AI agent that can drive it — timeline editing, voice and video generation, and local FFmpeg export. · GitHub"
