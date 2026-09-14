# Stable marker while the timeline scrolls

Ryan confirmed that replacement audio sounds fixed after `31cc09a`, then reported that the timeline marker still bounces visually.

Frame-by-frame Chromium geometry reproduced a separate visual issue: playback time advanced monotonically, but subtracting rounded `scrollLeft` from fractional program pixels moved the marker backwards 467 times, by up to 0.921875 CSS pixels. During automatic following, its viewport position ranged from 1144.109375 to 1145.078125 pixels.

Timeline now uses the measured lane viewport for both automatic following and drawing its marker. Within the one-pixel scroll-rounding tolerance, the playing marker stays at the fixed follow position. Paused seeking keeps its exact timeline position. This changes the Timeline component only; playback clocks and encoding are unchanged.

The same 25-second real-speech run after the fix captured 1,542 frames, zero backward marker movements, and a constant follow position of 1144.59375 pixels. Paused seeking, restarting playback, timeline following, and zoom checks passed. Typecheck and the web production build passed. The real-speech harness now checks backward visual movement on every animation frame; test windows remain muted.

A second run at a 900-pixel window width and 2x device scale passed with zero visual backsteps and zero replacement-audio seeks through seven simulated picture stalls (`marker-replacement-regression.log`).

Evidence: `/home/ryan/.paperclip/workspaces/speechedit/playback-popping-20260914/marker-before.log`, `marker-after.log`, `marker-comparison.json`, `marker-typecheck.log`, and `marker-build.log`. The real-speech media remains private and uncommitted.
