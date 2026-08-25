# SpeechEdit UX audit — persistent todo

Source: docs (`README.md`, `ux_helper.md`, `plan.md`, `feature_explosion.md`) vs live app review, Aug 2026.

**Principles:** actions on the object · progressive disclosure · minimal global chrome · verify in browser after each chunk.

---

## P0 — Quick wins

- [x] **Menubar diet** — remove duplicate Snap/Ripple from top bar; single Export entry
- [x] **Suggest bar states** — when safe=0 & review>0, primary = "Review N" (not disabled "Nothing safe")
- [x] **Transcript footer** — one-line hint + ⌘K, not hotkey dump
- [x] **Undo/Redo visible** — menubar or File menu with shortcuts
- [x] **Desktop context menus** — right-click words, pauses, scenes, clips, tracks, panes

## P1 — Contextual flows

- [x] **Scene retake path** — scene chip → inspector with Use final take / Compare / Keep all first
- [x] **Collapse retakes surfaced** — suggest bar or scene helper, not menu-only
- [x] **Review next →** — suggestion & pause inspectors
- [x] **Why not safe** — blocked/static explanation in suggestion inspector

## P2 — Timeline & tracks

- [x] **Hide empty tracks** by default (V3/V2)
- [x] **M/H/L labels** — tooltips or icons; optional track rename
- [x] **Edits lane filters** — applied / pending / scenes / guards
- [x] **Clip basics in inspector** — trim/split without Advanced
- [x] **Dedupe menubar Snap** vs timeline Snap

## P3 — Empty states & disclosure

- [x] **Empty transcript** — guided cards (Open media · Drop transcript · Demo)
- [x] **Empty project inspector**
- [x] **Pace presets** under Project Advanced (Natural/Balanced/Tight)
- [x] **MCP + Agent hints** in Project inspector when relevant

## P4 — Preview & batch

- [x] **Original / Edited preview** toggle or A/B loop before batch apply
- [x] **Watch** label clarity (edited vs source)
- [x] **Edits lane summary** when crowded (>10 blocks)

## P5 — Discoverability

- [x] **Cross-modal find** (suggestions/scenes)
- [x] **Compare takes** — loop A vs B from scene inspector
- [x] **Redaction affordance** on overlay selection
- [x] **Split at playhead** visible in UI
- [x] **Agent edit recipe** preview before apply

## P6 — Polish

- [x] **Monitor states** (audio-only vs no video)
- [x] **Now-word optional** — hidden when captions show; toggle in Project Advanced
- [x] **Theme token migration** — remaining hardcoded colors → `theme.css`

---

## Verify each chunk

```bash
bun run dev:web   # http://127.0.0.1:5173/
bun run typecheck
bun test src/renderer/src/lib/contextActions.test.ts
```

Browser: word/gap/scene select · suggest bar before/after safe apply · timeline zoom · click-off deselect · inspector helpers · right-click context menus · empty project cards · Original/With cuts preview · cross-modal find.

**Last verified:** Aug 2026 — typecheck green, contextActions + transcriptFind tests pass, browser spot-check on studio demo.

---

## Out of scope (see `feature_explosion.md`)

Semantic event panel · cursor reconstruction · target duration · QA lint · branching timelines · style learning
