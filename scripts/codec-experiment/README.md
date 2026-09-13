# CPU codec experiment (kept out of production)

Use permissioned real recordings. Start with ordinary mono Opus 24 and 16 kbps. NoLACE runs only when an explicitly enabled, pinned native build is supplied. Lyra remains a follow-up. Production continues to use standard 24 kbps Opus.

```sh
bun scripts/codec-experiment/bench.ts /path/to/recording.mp4 /tmp/codec-results 0 25
```

To include NoLACE, download the official `opus-1.5.2.tar.gz` release from `https://downloads.xiph.org/releases/opus/`. Its SHA-256 is `65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1`. Verify the archive, extract it into a build directory, then run:

```sh
./configure --enable-osce --disable-shared --disable-doc
make -j4 opus_demo
SPEECHEDIT_OPUS_BUILD=/path/to/opus-1.5.2 bun scripts/codec-experiment/bench.ts /path/to/recording.mp4 /tmp/codec-results 0 25
```

NoLACE needs both the compile-time OSCE flag and decoder complexity 7; the harness checks the generated build configuration. It uses 20 ms wideband packets at 9 and 12 kbps. See the [official Opus 1.5 enhancement documentation](https://opus-codec.org/demo/opus-1.5/). This is decoder enhancement of ordinary Opus packets, not a WebCodecs setting.

`results.json` separates source decode, encoder, and native decoder wall time. Each subprocess includes startup overhead; one short run is not a speed guarantee. Repeat warm/cold runs on target desktops and laptops. The experimental `.packets` files contain opus_demo's eight-byte per-packet framing; compare `payloadBytes` separately from the production WebM download size. Listening WAVs are not codec payloads. NoLACE's browser/WASM startup, download and seek are explicitly unmeasured until an enhanced browser decoder exists.

Open `listen.html` locally to compare the reference and decoded candidates. Record mistakes, especially names, numbers, and overlapping speech; use blind/randomized comparisons for a release decision. Run the ordinary browser startup/seek check with `env -u ELECTRON_RUN_AS_NODE electron scripts/codec-experiment/browser.cjs /tmp/codec-results --no-sandbox`. Do not infer neural browser support from successful ordinary Opus playback, and do not promote a codec from nominal bitrate or this single sample.
