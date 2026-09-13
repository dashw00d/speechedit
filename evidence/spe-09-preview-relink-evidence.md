# SPE-09 evidence: blocked final-render recovery for shared preview-only media

Task: RYA-180 (SPE-09). Bounded usability repair on the existing relink flow.

## Snapshot

- Repo: `/home/ryan/dev/speechedit`
- Original base: `spe-05/first-session-polish` @ `fb7d84a` (clean, 0 dirty paths)
- Accepted base after the SPE-10 merge hold: `spe-05/first-session-polish` @ `080c874`
  (SPE-10 / RYA-182 accepted at `080c874`, so SPE-09 was resumed and integrated)
- Working branch: `spe-09/preview-relink-recovery` @ `3cf7033` (merge of `080c874` with the SPE-09 commit `10de317`; no conflicts, no file overlap)

## Friction reproduction (before)

A shared project whose A-roll only has a preview (`proxyOnly: true`) is asked to render.

```
$ bun scripts/spe09-preview-relink-probe.ts
buildExportJob returned a job: true
validateExportJob: Relink shared previews to original media before rendering the final video.
videoExportCopy: {"ready":false,"summary":"00:46 · 1 clip · 2 captions","problem":"Relink shared previews to original media before rendering the final video."}
exportPrimaryCopy(electron=true): {"label":"Download the words",...,"kind":"pack"}
exportPrimaryCopy(electron=false): {"label":"Download the words",...,"kind":"pack"}
exportVideoAction messages: ["Relink shared previews to original media before rendering the final video."]
```

Observed: the blocked export returned only a dismiss-only string, using internal language, and
the Export sheet silently fell back to "Download the words" with no way to relink. Raw output is in
`evidence/spe09-preview-relink-before.output.txt`.

## Fix and verification (after)

```
$ bun scripts/spe09-preview-relink-probe.ts
buildExportJob returned a job: true
validateExportJob: Relink the original recording to render the final video.
videoExportCopy: {"ready":false,...,"problem":"Relink the original recording to render the final video."}
exportPrimaryCopy(electron=true): {"label":"Relink original media","detail":"The shared copy can preview but not render. Relink the original recording.","kind":"relink"}
exportPrimaryCopy(electron=false): {"label":"Relink original media",...,"kind":"relink"}
exportVideoAction message: {"message":"Relink the original recording to render the final video.","action":{"label":"Relink original media","ariaLabel":"Relink the original recording"}}
originals still needing relink: 0
export resumed after relink: true
relink follow-up message: null
```

Raw output is in `evidence/spe09-preview-relink-probe.output.txt`.

The recovery reuses the existing `relinkAssetInteractive` flow (`documentIo.ts`); no parallel
implementation. The toast action, the Export sheet primary action, and the banner/Undo chips are all
the same `button.chip` control inside the existing live region, so the action is Tab/Enter reachable
and consistent with the existing controls.

## Checks

- `bun test src/renderer/src/lib` -> 738 pass / 0 fail on the merged accepted base (fb7d84a baseline 730; SPE-09 adds 4 in `exportRelinkRecovery.test.ts`; SPE-10 adds the rest).
- `bun run typecheck` -> clean (`tsc -p tsconfig.web.json --noEmit && tsc -p tsconfig.node.json --noEmit`).
- New regression tests in `src/renderer/src/lib/exportRelinkRecovery.test.ts`:
  1. blocked render offers one plain-language relink action (no "proxy" language)
  2. relinking clears the block and resumes export on the same path
  3. more than one original names the remaining count and keeps the action
  4. cancelling the picker keeps a no-dead-end message with the action

## Limitations

- No GUI automation was run for this task (no headless browser harness in the repo); the journey is
  proven at the action layer by the probe and regression tests above. Human visual/keyboard QA on a
  live Electron window remains available for the reviewer.
