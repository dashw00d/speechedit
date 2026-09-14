/*
 * RYA-340 — Regression harness: selected-sentence Re-record from the selection.
 *
 * Encodes the RYA-334 acceptance on the REAL SpeechEdit web editor UI with two
 * independent Electron browser contexts (host/owner + guest via a full edit link):
 *
 *   1. Selecting a sentence exposes the existing "Re-record audio" action in the
 *      selection's right-click (context) menu, with keyboard access.
 *   2. Invoking it targets the correct sentence/range and replaces it.
 *   3. Microphone-denied and cancel paths leave the sentence intact.
 *   4. Undo restores the prior sentence.
 *   5. The existing upper action-panel "Re-record audio" still works.
 *   6. The other client observes the replacement after sync.
 *
 * Baseline expectation (origin/main @ e9b6590): checks 1/2/3/4 via the context
 * menu FAIL because the word context menu has no Re-record item. The panel path
 * (5) and the shared recording/sync machinery are exercised so the baseline
 * capture distinguishes "action missing from the menu" from "action broken".
 *
 * This is a QA harness only — it does not modify product source. Point it at an
 * isolated service started by ../.lab-rya336/start-service.sh.
 *
 * Usage:
 *   QA336_OUT=<dir> electron scripts/qa336-sentence-rerecord.cjs <url> --no-sandbox
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')

const outDir = process.env.QA336_OUT || join(tmpdir(), 'speechedit-qa336')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'speechedit-qa336-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find((arg) => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:3364'
const RUN_MS = Number(process.env.QA336_RUN_MS || 420000)
const WAIT_MS = Number(process.env.QA336_WAIT_MS || 90000)
const timer = setTimeout(() => { console.error('QA336 journey timed out'); finish(1) }, RUN_MS)

const traces = {}
const results = {
  journey: 'RYA-340 selected-sentence Re-record regression',
  url,
  baseline: process.env.QA336_BASELINE || 'origin/main @ e9b6590 (deployment-approximate)',
  checks: {},
  details: {},
  failures: []
}
const startedAt = new Date().toISOString()
let finished = false
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  try {
    results.finishedAt = new Date().toISOString()
    results.startedAt = startedAt
    writeFileSync(join(outDir, 'qa336-trace.json'), JSON.stringify({ ...results, traces }, null, 2))
  } catch (error) { console.error('trace write failed', error) }
  app.exit(code)
}
function check(name, value, detail, failure) {
  results.checks[name] = Boolean(value)
  if (detail !== undefined) results.details[name] = detail
  if (!value) results.failures.push(failure || name)
  return Boolean(value)
}
function skip(name, detail) {
  results.checks[name] = 'skipped'
  results.details[name] = detail
}
function note(name, detail) {
  results.details[name] = detail
}

async function waitFor(win, expression, budgetMs = WAIT_MS) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (await win.webContents.executeJavaScript(expression)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  throw Error(`Timed out after ${elapsed}s waiting for ${expression}\n` + await win.webContents.executeJavaScript('document.body.innerText.slice(0, 2000)'))
}
async function waitSoft(win, expression, budgetMs = 8000) {
  try { await waitFor(win, expression, budgetMs); return true } catch { return false }
}
const js = (win, expression) => win.webContents.executeJavaScript(expression)
const click = (win, text) => js(win, `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw Error('Button unavailable: ' + ${JSON.stringify(text)}); b.click(); return true })()`)
const clickSoft = async (win, text) => {
  try { await click(win, text); return true } catch { return false }
}
async function field(win, selector, value) {
  await js(win, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('Missing field ${selector}'); const proto = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
}

/* ------------------------------------------------------------------ mocks -- */
// Deterministic ASR + a synthetic microphone. The recording chain in
// lib/recording.ts is AudioWorklet-based, so the mock emits fixed-length PCM
// frames exactly when the app would receive them from the audio thread.
const MOCK_SCRIPT = `
  (() => {
    const qa = window.__qa336 = { denyMic: false, records: 0 };
    const NativeWorker = window.Worker;
    window.Worker = class extends EventTarget {
      constructor(url, options) { super(); if (!String(url).includes('browserWhisper.worker')) return new NativeWorker(url, options); }
      terminate() { this.stopped = true; }
      emit(data) { setTimeout(() => { if (!this.stopped) this.onmessage?.({ data }); }, 10); }
      postMessage(message) {
        if (message.type === 'load') this.emit({ type: 'ready', backend: 'wasm' });
        else this.emit({ type: 'result', id: message.id, cues: [
          { text: 'Welcome to this recording.', start: 0, end: 2 },
          { text: 'Now a different chapter.', start: 6, end: 8 }
        ] });
      }
    };
    class FakeAudioContext {
      constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      decodeAudioData() {
        const length = 32000;
        const data = new Float32Array(length);
        return Promise.resolve({ length, numberOfChannels: 1, sampleRate: 16000, duration: 2, getChannelData: () => data });
      }
    }
    class FakeAudioWorkletNode {
      constructor(context, name, options) {
        this.port = { onmessage: null, postMessage() {} };
        this.onprocessorerror = null;
        const frames = (options && options.processorOptions && options.processorOptions.frames) || 0;
        setTimeout(() => {
          const samples = new Float32Array(frames);
          if (this.port.onmessage) this.port.onmessage({ data: { samples, written: frames } });
        }, 60);
      }
      connect() {}
      disconnect() {}
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    window.AudioWorkletNode = FakeAudioWorkletNode;
    Object.defineProperty(Navigator.prototype, 'mediaDevices', {
      configurable: true,
      get() {
        return {
          getUserMedia: () => {
            if (window.__qa336.denyMic) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
            window.__qa336.records += 1;
            return Promise.resolve({ getTracks: () => [] });
          }
        };
      }
    });
  })();
`

function windowFor(partition) {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  const trace = { partition, console: [], network: [], gone: [] }
  traces[partition] = trace
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { trace.console.push({ level, message: String(message).slice(0, 600) }) })
  win.webContents.on('render-process-gone', (_e, details) => { trace.gone.push(details) })
  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, (d) => { if (d.statusCode >= 400) trace.network.push({ url: d.url, status: d.statusCode, method: d.method }) })
  win.webContents.session.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (d) => { if (!/fonts\.(googleapis|gstatic)\.com/.test(d.url)) trace.network.push({ url: d.url, error: d.error }) })
  return win
}
async function attachCdp(win) {
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_SCRIPT })
}
const shot = async (win, name) => { try { writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG()) } catch (e) { console.error('shot failed', name, e) } }

/* ------------------------------------------------------------- CDP input -- */
async function cdpMouse(win, type, params) { await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...params }) }
async function cdpClickAt(win, x, y, { button = 'left', clickCount = 1 } = {}) {
  const buttons = button === 'right' ? 2 : 1
  await cdpMouse(win, 'mousePressed', { x, y, button, clickCount, buttons })
  await cdpMouse(win, 'mouseReleased', { x, y, button, clickCount, buttons: 0 })
}
async function cdpDoubleClickAt(win, x, y) {
  await cdpClickAt(win, x, y, { clickCount: 1 })
  await new Promise((r) => setTimeout(r, 80))
  await cdpClickAt(win, x, y, { clickCount: 2 })
}
async function cdpKey(win, key, code, modifiers = 0, windowsVirtualKeyCode) {
  const base = { key, code, modifiers }
  if (windowsVirtualKeyCode) base.windowsVirtualKeyCode = windowsVirtualKeyCode
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}
const wordCenter = (win, index = 0) => js(win, `(() => { const w = document.querySelectorAll('.word')[${index}]; if (!w) return null; const r = w.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: w.textContent } })()`)

/* --------------------------------------------------------- app inspection -- */
const PROJECT_KEY = 'speechedit:project'
function replacementSummary(win) {
  return js(win, `(() => {
    const p = JSON.parse(localStorage.getItem(${JSON.stringify(PROJECT_KEY)}) || 'null');
    if (!p) return null;
    const track = (p.tracks || []).find(t => t.id === 'voice_replacements');
    return {
      recordings: Object.values(p.assets || {}).filter(a => a.isRecording).map(a => ({ id: a.id, name: a.name, duration: +Number(a.duration).toFixed(3), kind: a.kind })),
      clips: (track ? track.clips : []).map(c => ({ start: +Number(c.start).toFixed(3), duration: +Number(c.duration).toFixed(3), end: +Number(c.start + c.duration).toFixed(3), assetId: c.assetId, text: c.text })),
      assetCount: Object.keys(p.assets || {}).length,
      wordCount: (p.transcript ? p.transcript.words.length : 0)
    }
  })()`)
}
function selectedSummary(win) {
  return js(win, `(() => {
    const ids = [...document.querySelectorAll('.word[data-sel="true"]')].map(w => w.getAttribute('data-word-id'));
    const p = JSON.parse(localStorage.getItem(${JSON.stringify(PROJECT_KEY)}) || 'null');
    const words = p && p.transcript ? p.transcript.words.filter(w => ids.includes(w.id)) : [];
    return { ids, text: words.map(w => w.text).join(' '), start: words.length ? Math.min(...words.map(w => w.start)) : null, end: words.length ? Math.max(...words.map(w => w.end)) : null }
  })()`)
}
function menuItems(win) {
  return js(win, `(() => {
    const m = document.querySelector('.context-menu'); if (!m) return null;
    return {
      title: m.querySelector('.context-menu-title')?.textContent ?? null,
      items: [...m.querySelectorAll('.context-menu-item')].map(b => ({ label: b.querySelector('.context-menu-label')?.textContent.trim() ?? '', disabled: b.disabled }))
    }
  })()`)
}
const hasReRecordItem = (menu) => Boolean(menu && menu.items.some((i) => /re-?record/i.test(i.label)))
async function clickContextItem(win, label) {
  return js(win, `(() => {
    const b = [...document.querySelectorAll('.context-menu .context-menu-item')].find(b => (b.querySelector('.context-menu-label')?.textContent.trim() || '') === ${JSON.stringify(label)});
    if (!b || b.disabled) return false; b.click(); return true
  })()`)
}
// Match any "Re-record" item so a candidate that reuses the existing command with
// a slightly different label is not failed by an over-exact string match.
async function clickReRecordMenuItem(win) {
  return js(win, `(() => {
    const b = [...document.querySelectorAll('.context-menu .context-menu-item')].find(b => /re-?record/i.test(b.querySelector('.context-menu-label')?.textContent.trim() || ''));
    if (!b || b.disabled) return false; b.click(); return true
  })()`)
}

/* ------------------------------------------------------------ UI actions -- */
async function selectSentence(win, index = 0) {
  // The word panel appears on the first click and shifts the layout, so a
  // literal same-coordinate double-click can miss the word. Use the editor's own
  // "Select sentence" menu action to get a deterministic sentence selection.
  await closeAnyMenu(win)
  const menu = await openWordContextMenuAt(win, index)
  if (!menu) throw Error('word context menu did not open for sentence selection')
  const clicked = await clickContextItem(win, 'Select sentence')
  if (!clicked) throw Error(`word context menu has no "Select sentence" action (items: ${JSON.stringify(menu.items.map((i) => i.label))})`)
  await waitFor(win, `!!document.querySelector('.word-selection-tools') && [...document.querySelectorAll('.word-selection-tools button')].some(b => b.textContent.trim() === 'Re-record audio')`, 20000)
  await waitFor(win, `(() => { const m = (document.querySelector('.word-selection-summary')?.textContent || '').match(/(\\d+)\\s+words/); return Boolean(m && Number(m[1]) >= 2) })()`, 20000)
}
async function openWordContextMenuAt(win, index = 0) {
  const c = await wordCenter(win, index)
  if (!c) return null
  await cdpClickAt(win, c.x, c.y, { button: 'right' })
  const opened = await waitSoft(win, `!!document.querySelector('.context-menu')`, 5000)
  if (!opened) return null
  return menuItems(win)
}
const openWordContextMenu = (win) => openWordContextMenuAt(win, 0)
async function closeAnyMenu(win) {
  if (!await js(win, `!!document.querySelector('.context-menu')`)) return
  await cdpKey(win, 'Escape', 'Escape', 0, 27)
  await waitSoft(win, `!document.querySelector('.context-menu')`, 3000)
}
async function openMenuByKeyboard(win) {
  await closeAnyMenu(win)
  const focused = await js(win, `(() => { const w = document.querySelector('.word'); if (w) w.focus(); return { tag: document.activeElement?.tagName, cls: document.activeElement?.className, text: document.activeElement?.textContent } })()`)
  // Browser-native context-menu key: try the CDP path, then a faithful
  // Electron sendInputEvent, then the dedicated ContextMenu key.
  await cdpKey(win, 'F10', 'F10', 8, 121)
  if (await waitSoft(win, `!!document.querySelector('.context-menu')`, 2500)) return { opened: true, via: 'cdp Shift+F10', focused }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10', modifiers: ['shift'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F10', modifiers: ['shift'] })
  if (await waitSoft(win, `!!document.querySelector('.context-menu')`, 2500)) return { opened: true, via: 'sendInputEvent Shift+F10', focused }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Menu' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Menu' })
  if (await waitSoft(win, `!!document.querySelector('.context-menu')`, 2500)) return { opened: true, via: 'sendInputEvent Menu', focused }
  return { opened: false, via: null, focused }
}

// Keyboard activation of the context-menu item: focus it and press Enter.
async function activateMenuItemByKeyboard(win) {
  const focused = await js(win, `(() => {
    const b = [...document.querySelectorAll('.context-menu .context-menu-item')].find(b => /re-?record/i.test(b.querySelector('.context-menu-label')?.textContent.trim() || ''));
    if (!b || b.disabled) return false; b.focus(); return document.activeElement === b;
  })()`)
  if (!focused) return { focused: false }
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  return { focused: true }
}
async function startAndUseRecording(win, { expectTarget }) {
  await click(win, 'Start recording')
  const ready = await waitSoft(win, `!!document.querySelector('.record-sheet audio[aria-label="Listen to replacement recording"]')`, 20000)
  if (!ready) {
    const err = await js(win, `document.querySelector('.record-sheet .review-error')?.textContent?.trim() || null`)
    return { ok: false, reason: 'recording did not reach the listen stage', error: err }
  }
  const target = await js(win, `document.querySelector('.record-sheet blockquote')?.textContent?.replace(/\\s+/g, ' ').trim() || null`)
  if (expectTarget && target !== expectTarget) return { ok: false, reason: `record sheet target mismatch: ${JSON.stringify(target)} != ${JSON.stringify(expectTarget)}`, target }
  await click(win, 'Use recording')
  const closed = await waitSoft(win, `!document.querySelector('.record-sheet')`, 30000)
  if (!closed) {
    const err = await js(win, `document.querySelector('.record-sheet .review-error')?.textContent?.trim() || null`)
    return { ok: false, reason: 'record sheet did not close after Use recording', error: err, target }
  }
  return { ok: true, target }
}

/* ------------------------------------------------------------ journeys ---- */
async function loadOwner() {
  const win = windowFor('owner')
  await win.loadURL('about:blank')
  await attachCdp(win)
  await win.loadURL(url)
  await waitFor(win, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'File')`)
  const appChunk = await js(win, `document.querySelector('script[type=module]')?.getAttribute('src') || null`)
  results.appChunk = appChunk
  // New reel + synthetic media fixture.
  await click(win, 'File')
  await waitFor(win, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'New reel')`)
  await click(win, 'New reel')
  await waitFor(win, `document.querySelector('.transcript-heading small')?.textContent.includes('0 words')`)
  const fixturePath = join(profile, 'qa336-fixture.webm')
  const fixture = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', fixturePath])
  if (fixture.status !== 0) throw Error('fixture build failed: ' + fixture.stderr.toString())
  const fixtureB64 = readFileSync(fixturePath).toString('base64')
  await js(win, `(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(fixtureB64)}), c => c.charCodeAt(0))], 'qa336-fixture.webm', { type: 'video/webm' }));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  })()`)
  await waitFor(win, `document.querySelectorAll('.word').length === 8`)
  results.ownerWords = await js(win, `document.querySelectorAll('.word').length`)
  await shot(win, '01-owner-baseline.png')
  return win
}

async function ownerMenuJourney(win) {
  // Select the first sentence and confirm the existing panel action is present.
  await selectSentence(win, 0)
  const selected = await selectedSummary(win)
  results.details.selectedSentence = selected
  results.details.panelChips = await js(win, `[...document.querySelectorAll('.word-selection-tools button')].map(b => b.textContent.trim())`)

  // (1) Right-click the selected sentence -> context menu must expose Re-record.
  const menu = await openWordContextMenu(win)
  results.details.contextMenu = menu
  check('contextMenuHasReRecord', hasReRecordItem(menu),
    { menu },
    `FAIL: selected-sentence right-click menu is missing the "Re-record audio" item. Actual items: ${JSON.stringify(menu ? menu.items.map(i => i.label) : null)}`)
  await shot(win, '02-owner-context-menu.png')

  // Keyboard access: open the menu from a focused word via Shift+F10 / Menu key,
  // then activate the Re-record item with the keyboard.
  const kb = await openMenuByKeyboard(win)
  const kbMenu = kb.opened ? await menuItems(win) : null
  note('keyboardOpensContextMenu', { ...kb, menu: kbMenu })
  if (kb.opened) {
    check('keyboardMenuHasReRecord', hasReRecordItem(kbMenu), { menu: kbMenu },
      `FAIL: keyboard-opened context menu is missing the "Re-record audio" item. Actual items: ${JSON.stringify(kbMenu ? kbMenu.items.map(i => i.label) : null)}`)
  } else {
    skip('keyboardMenuHasReRecord', 'context menu could not be opened by keyboard; see details.keyboardOpensContextMenu')
  }
  await closeAnyMenu(win)

  // The menu item must be keyboard-activatable (focusable <button> + Enter).
  if (hasReRecordItem(menu)) {
    await selectSentence(win, 0)
    await openWordContextMenu(win)
    const activation = await activateMenuItemByKeyboard(win)
    const kbSheet = activation.focused && await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
    const kbTarget = kbSheet ? await js(win, `document.querySelector('.record-sheet blockquote')?.textContent?.replace(/\\s+/g, ' ').trim() || null`) : null
    check('keyboardActivatesReRecord', Boolean(kbSheet && kbTarget === selected.text), { activation, kbSheet, kbTarget, expected: selected.text },
      `FAIL: the context-menu Re-record could not be activated by keyboard (focused=${activation.focused}, target=${JSON.stringify(kbTarget)})`)
    await clickSoft(win, 'Cancel')
    await waitSoft(win, `!document.querySelector('.record-sheet')`, 5000)
  } else {
    skip('keyboardActivatesReRecord', 'context-menu Re-record item missing (see contextMenuHasReRecord)')
  }
  await closeAnyMenu(win)

  // (2)(4) Invoke the context-menu Re-record, verify the target range, then Undo.
  if (hasReRecordItem(menu)) {
    const before = await replacementSummary(win)
    await selectSentence(win, 0)
    await openWordContextMenu(win)
    const invoked = await clickReRecordMenuItem(win)
    const sheetOpen = invoked && await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
    results.details.menuInvoked = { invoked, sheetOpen }
    check('menuOpensRecordSheet', Boolean(sheetOpen), { invoked, sheetOpen }, 'FAIL: context-menu Re-record did not open the record sheet')
    if (sheetOpen) {
      await shot(win, '03-owner-menu-record-sheet.png')
      const rec = await startAndUseRecording(win, { expectTarget: selected.text })
      results.details.menuRecording = rec
      const after = await replacementSummary(win)
      results.details.menuAfterReplace = after
      const clip = after && after.clips.length === 1 ? after.clips[0] : null
      const targets = clip && Math.abs(clip.start - selected.start) <= 0.05 && Math.abs(clip.end - selected.end) <= 0.05
      check('menuReplacesCorrectRange', Boolean(rec.ok && targets), { rec, before, after, expected: { start: selected.start, end: selected.end } },
        `FAIL: context-menu Re-record did not replace the selected sentence range. expected ${JSON.stringify({ start: selected.start, end: selected.end })}, got ${JSON.stringify(clip)}`)
      const undone = await undoLast(win)
      const restored = await replacementSummary(win)
      results.details.menuAfterUndo = { undone, restored }
      check('menuUndoRestores', Boolean(undone && restored && restored.clips.length === 0 && restored.recordings.length === 0), { undone, restored },
        `FAIL: Undo did not restore the sentence after a context-menu Re-record (clips=${JSON.stringify(restored && restored.clips)})`)
    } else {
      skip('menuReplacesCorrectRange', 'record sheet never opened from the context menu')
      skip('menuUndoRestores', 'no replacement to undo')
    }
  } else {
    skip('menuOpensRecordSheet', 'context-menu Re-record item missing (see contextMenuHasReRecord)')
    skip('menuReplacesCorrectRange', 'context-menu Re-record item missing (see contextMenuHasReRecord)')
    skip('menuUndoRestores', 'context-menu Re-record item missing (see contextMenuHasReRecord)')
  }

  // (3) Cancel path via the context menu (falls back to the panel when missing).
  await cancelVia(win, hasReRecordItem(menu) ? 'menu' : 'panel')
  // (3) Microphone-denied path via the context menu (falls back to the panel).
  await micDeniedVia(win, hasReRecordItem(menu) ? 'menu' : 'panel')

  await closeAnyMenu(win)
}

async function cancelVia(win, via) {
  await selectSentence(win, 0)
  const before = await replacementSummary(win)
  let opened = false
  if (via === 'menu') {
    const menu = await openWordContextMenu(win)
    if (hasReRecordItem(menu) && await clickReRecordMenuItem(win)) opened = await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
    await closeAnyMenu(win)
  } else {
    await click(win, 'Re-record audio')
    opened = await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
  }
  const after = await replacementSummary(win)
  const intact = opened && after && after.clips.length === 0 && after.recordings.length === 0
  const key = via === 'menu' ? 'menuCancelLeavesIntact' : 'panelCancelLeavesIntact'
  check(key, Boolean(intact), { via, opened, before, after },
    `FAIL: cancel via ${via} did not leave the sentence intact (opened=${opened})`)
  if (opened) {
    await clickSoft(win, 'Cancel')
    await waitSoft(win, `!document.querySelector('.record-sheet')`, 5000)
  }
}

async function micDeniedVia(win, via) {
  await selectSentence(win, 0)
  await js(win, `window.__qa336.denyMic = true`)
  const before = await replacementSummary(win)
  let opened = false
  if (via === 'menu') {
    const menu = await openWordContextMenu(win)
    if (hasReRecordItem(menu) && await clickReRecordMenuItem(win)) opened = await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
    await closeAnyMenu(win)
  } else {
    await click(win, 'Re-record audio')
    opened = await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
  }
  let errorText = null
  if (opened) {
    await clickSoft(win, 'Start recording')
    await waitSoft(win, `!!document.querySelector('.record-sheet .review-error')`, 15000)
    errorText = await js(win, `document.querySelector('.record-sheet .review-error')?.textContent?.trim() || null`)
    await clickSoft(win, 'Cancel')
    await waitSoft(win, `!document.querySelector('.record-sheet')`, 5000)
  }
  await js(win, `window.__qa336.denyMic = false`)
  const after = await replacementSummary(win)
  const intact = opened && errorText && after && after.clips.length === 0 && after.recordings.length === 0
  const key = via === 'menu' ? 'menuMicDeniedLeavesIntact' : 'panelMicDeniedLeavesIntact'
  check(key, Boolean(intact), { via, opened, errorText, before, after },
    `FAIL: mic-denied via ${via} did not surface an error or left a replacement behind (opened=${opened}, error=${JSON.stringify(errorText)})`)
}

async function undoLast(win) {
  const hasChip = await waitSoft(win, `!!document.querySelector('.toast button[aria-label="Undo the last edit"]')`, 8000)
  if (hasChip) { await js(win, `document.querySelector('.toast button[aria-label="Undo the last edit"]').click()`); return 'toast-undo-chip' }
  await js(win, `document.activeElement && document.activeElement.blur && document.activeElement.blur()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] })
  return 'ctrl+z'
}

async function panelJourney(win) {
  await selectSentence(win, 0)
  const selected = await selectedSummary(win)
  const before = await replacementSummary(win)
  await click(win, 'Re-record audio')
  const sheetOpen = await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
  check('panelOpensRecordSheet', sheetOpen, { sheetOpen }, 'FAIL: the existing panel Re-record did not open the record sheet')
  if (!sheetOpen) { skip('panelReplacesCorrectRange', 'sheet did not open'); skip('panelUndoRestores', 'no replacement'); return }
  const rec = await startAndUseRecording(win, { expectTarget: selected.text })
  const after = await replacementSummary(win)
  const clip = after && after.clips.length === 1 ? after.clips[0] : null
  const targets = clip && Math.abs(clip.start - selected.start) <= 0.05 && Math.abs(clip.end - selected.end) <= 0.05
  check('panelReplacesCorrectRange', Boolean(rec.ok && targets), { rec, before, after, expected: { start: selected.start, end: selected.end }, selected },
    `FAIL: the existing panel Re-record did not replace the selected sentence range (rec=${JSON.stringify(rec)})`)
  const undone = await undoLast(win)
  const restored = await replacementSummary(win)
  check('panelUndoRestores', Boolean(undone && restored && restored.clips.length === 0 && restored.recordings.length === 0), { undone, restored },
    `FAIL: Undo did not restore the sentence after a panel Re-record`)
  await shot(win, '04-owner-panel-done.png')
}

async function createEditLink(win) {
  await click(win, 'Share')
  await waitFor(win, `!!document.querySelector('[aria-label="Share access"]')`)
  await js(win, `(() => { const s = document.querySelector('[aria-label="Share access"]'); s.value = 'edit'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await click(win, 'Create editing link')
  await waitFor(win, `!!document.querySelector('.review-link-box input')`, 60000)
  const link = await js(win, `document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editing link: ' + link)
  results.editLinkShape = link.replace(/[?#].*$/, '/edit/<room>#<key>')
  await shot(win, '05-owner-share-link.png')
  return link
}

async function guestReplace(win, link, label, viaMenu) {
  await win.loadURL('about:blank')
  await attachCdp(win)
  await win.loadURL(link)
  await waitFor(win, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 60000)
  await field(win, '[aria-label="Editor name"]', label)
  await selectSentence(win, 0)
  const selected = await selectedSummaryFromDom(win)
  let entry = 'panel'
  if (viaMenu) {
    const menu = await openWordContextMenu(win)
    if (hasReRecordItem(menu)) {
      entry = 'menu'
      await clickReRecordMenuItem(win)
    } else {
      await closeAnyMenu(win)
      await click(win, 'Re-record audio')
    }
  } else {
    await click(win, 'Re-record audio')
  }
  const sheetOpen = await waitSoft(win, `!!document.querySelector('.record-sheet')`, 8000)
  if (!sheetOpen) return { ok: false, entry, reason: 'record sheet did not open' }
  const rec = await startAndUseRecording(win, { expectTarget: selected.text })
  // The shared editor uploads the take and applies it; wait for the replacement clip label.
  const labelSeen = await waitSoft(win, `[...document.querySelectorAll('.clip-label')].some(n => /Re-recorded voice/i.test(n.textContent))`, 20000)
  return { ok: Boolean(rec.ok && labelSeen), entry, rec, labelSeen, selected }
}
function selectedSummaryFromDom(win) {
  return js(win, `(() => {
    const ids = [...document.querySelectorAll('.word[data-sel="true"]')].map(w => w.getAttribute('data-word-id'));
    return { ids, text: [...document.querySelectorAll('.word[data-sel="true"]')].map(w => w.textContent).join(' ') }
  })()`)
}
async function saveShared(win) {
  await click(win, 'Save now')
  return waitSoft(win, `document.querySelector('.shared-edit-bar [role="status"]')?.textContent.includes('All changes saved')`, 30000)
}
function sharedDraftHasReplacement(win, roomId) {
  return js(win, `(async () => {
    const open = () => new Promise((ok, fail) => { const r = indexedDB.open('speechedit-collaboration', 1); r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
    const db = await open();
    try {
      const value = await new Promise((ok) => { const q = db.transaction('state').objectStore('state').get(${JSON.stringify('draft:' + roomId)}); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); });
      const project = value && value.project;
      const track = project && (project.tracks || []).find(t => t.id === 'voice_replacements');
      return Boolean(track && track.clips.length);
    } finally { db.close(); }
  })()`)
}
async function hostPullObserves(win, roomId) {
  // The share sheet is already open from createEditLink.
  await clickSoft(win, 'Refresh feedback')
  const pulled = await clickSoft(win, 'Bring shared edits into this project')
  if (!pulled) return { pulled: false }
  const ok = await waitSoft(win, `JSON.parse(localStorage.getItem('speechedit:project') || '{}').tracks?.some(t => t.id === 'voice_replacements' && t.clips.length)`, 30000)
  return { pulled: true, ok, project: await replacementSummary(win) }
}

app.whenReady().then(async () => {
  let win
  try {
    win = await loadOwner()
    await ownerMenuJourney(win)
    await panelJourney(win)

    // (5)(6) Guest re-records -> save -> host and a second client observe after sync.
    const link = await createEditLink(win)
    const roomId = new URL(link).pathname.split('/')[2]
    const guest = windowFor('guest')
    const guestResult = await guestReplace(guest, link, 'Remote editor', true)
    results.details.guestReplace = guestResult
    check('guestReplacesSentence', Boolean(guestResult.ok), guestResult,
      `FAIL: guest could not re-record the selected sentence (entry=${guestResult.entry}, reason=${guestResult.reason || JSON.stringify(guestResult.rec)})`)
    const saved = await saveShared(guest)
    results.details.guestSaved = saved
    check('guestSavedToSharedProject', saved, { saved }, 'FAIL: the guest recording did not reach "All changes saved"')

    const pulled = await hostPullObserves(win, roomId)
    results.details.hostPull = pulled
    check('hostObservesReplacementAfterSync', Boolean(pulled.ok), pulled,
      `FAIL: the host did not observe the guest replacement after "Bring shared edits into this project"`)

    const second = windowFor('second-guest')
    await second.loadURL('about:blank')
    await attachCdp(second)
    await second.loadURL(link)
    await waitFor(second, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 60000)
    const secondLabel = await waitSoft(second, `[...document.querySelectorAll('.clip-label')].some(n => /Re-recorded voice/i.test(n.textContent))`, 30000)
    const secondDraft = await sharedDraftHasReplacement(second, roomId)
    results.details.secondClient = { labelSeen: secondLabel, draftHasReplacement: secondDraft }
    check('otherClientObservesReplacementAfterSync', Boolean(secondLabel || secondDraft), results.details.secondClient,
      'FAIL: a second client did not observe the replacement after sync')
    await shot(second, '06-second-client-synced.png')
    await shot(win, '07-host-final.png')

    const failed = Object.values(results.checks).filter((v) => v === false).length
    results.pass = failed === 0
    console.log('QA336_RESULT ' + JSON.stringify({ pass: results.pass, checks: results.checks, failures: results.failures }))
    finish(results.pass ? 0 : 2)
  } catch (error) {
    results.error = String(error && error.stack ? error.stack : error)
    results.pass = false
    console.error(error)
    console.log('QA336_RESULT ' + JSON.stringify({ pass: false, checks: results.checks, failures: results.failures, error: results.error }))
    finish(1)
  }
})
