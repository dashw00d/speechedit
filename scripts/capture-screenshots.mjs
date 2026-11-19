#!/usr/bin/env node
// Regenerates the README screenshots in docs/screenshots/ from the real web build.
//
// Prerequisites
//   bun install && bun run build:web
//   OPENROUTER_API_KEY=placeholder PORT=5200 bun run start:web
//     The placeholder key only makes the status chip read "Demo AI is ready"; no AI request is ever sent.
//   npm i --no-save playwright-core && npx playwright-core install chromium   (or reuse any Playwright install)
//   A short speech recording as WebM (VP8/Opus; headless Chromium has no H.264/AAC). The README
//   images use the public-domain JFK sample from whisper.cpp:
//     curl -L -o /tmp/jfk.wav https://github.com/ggml-org/whisper.cpp/raw/master/samples/jfk.wav
//     ffmpeg -f lavfi -i "color=c=0x14323f:s=1280x720:r=25,drawtext=text='Public-domain sample (JFK, 1961)':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2" \
//            -i /tmp/jfk.wav -t 11 -c:v libvpx -b:v 400k -c:a libopus -shortest /tmp/jfk-demo.webm
//
// Usage
//   node scripts/capture-screenshots.mjs --media /tmp/jfk-demo.webm [--url http://localhost:5200] [--out docs/screenshots]
//
// The first run downloads the browser Whisper model through the server, so allow a minute or two.

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const media = args.get('media')
if (!media) {
  console.error('Missing --media <file.webm>. See the header of this script.')
  process.exit(1)
}
const url = args.get('url') ?? 'http://localhost:5200'
const out = resolve(args.get('out') ?? 'docs/screenshots')
mkdirSync(out, { recursive: true })

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const shot = (name) => page.screenshot({ path: resolve(out, `${name}.png`) })

// 1. Studio demo: built-in sample reel with suggested cuts (no media, so the preview is audio-only).
await page.goto(url)
await page.getByText('Transcript ready.').first().waitFor({ timeout: 60_000 })
// Wait for the local Whisper preparation banner to finish so the images show a settled UI.
await page.waitForFunction(() => !document.body.innerText.includes('Preparing local Whisper'), null, { timeout: 120_000 })
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Review edits' }).first().click()
await page.getByText('Issue review').first().waitFor()
await page.waitForTimeout(500)
await shot('auto-edit-review')
await page.locator('.drawer-close').click()
await page.waitForTimeout(400)

await page.getByRole('button', { name: 'Quick edit' }).first().click()
await page.getByText('Livestream cleanup').first().waitFor()
await page.waitForTimeout(400)
await shot('quick-edit')
await page.keyboard.press('Escape')

await page.keyboard.press('Control+k')
await page.waitForTimeout(500)
await page.keyboard.type('cut')
await page.waitForTimeout(500)
await shot('command-palette')
await page.keyboard.press('Escape')

// 2. Real recording: import, local Whisper transcription, then edit by selecting words.
await page.goto(url)
await page.waitForTimeout(3000)
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.evaluate(() => window.dispatchEvent(new CustomEvent('speechedit:open-media')))
])
await chooser.setFiles(resolve(media))
// Wait for the transcript (word count appears in the Transcript header).
await page.getByText(/\d+ words/).first().waitFor({ timeout: 240_000 })
await page.getByText('Nothing waiting').first().waitFor({ timeout: 240_000 })
await page.waitForTimeout(1500)

// Let transient status banners and toasts settle so they do not appear in the images.
await page.getByRole('button', { name: 'Dismiss' }).first().click({ timeout: 3000 }).catch(() => undefined)

// Select "ask not what your country" by dragging across the words.
const words = page.locator('.word-wrap')
const from = await words.filter({ hasText: /^ask$/ }).first().boundingBox()
const to = await words.filter({ hasText: /^country$/ }).first().boundingBox()
await page.mouse.move(from.x + 4, from.y + from.height / 2)
await page.mouse.down()
await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(600)
await shot('transcript-editor')

await browser.close()
console.log(`Wrote screenshots to ${out}`)
