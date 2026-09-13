// Desktop-host first-session undo journey probe (run on the BUILT app at out/).
//
// Earlier revisions loaded out/renderer/index.html with only the preload, so the
// main-process ipc handlers never existed and the ffmpeg-backed "looks" analysis
// that produces the automatic first edit could not run. This revision boots the
// real built main process (out/main/index.js) so the full journey is genuine:
//   drop a recording
//     -> automatic first edit (real ffmpeg silence analysis) with an undo-inviting toast
//     -> the inline Undo chip is keyboard reachable (focus Dismiss, Shift+Tab, Enter)
//     -> Enter restores the prior word/chapter/timeline state
//     -> the confirmation names and performs the redo path (Ctrl+Shift+Z)
// Bounded: hard 115s timeout, exits with PROBE_RESULT JSON, never retried on hang.
const { app, BrowserWindow } = require('electron')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const repo = '/home/ryan/dev/speechedit'
const profile = mkdtempSync(join(tmpdir(), 'speechedit-desktop-undo-probe-'))
// Keep the app's homedir-backed sync dir (~/.speechedit) inside the throwaway profile.
process.env.HOME = profile
app.setPath('userData', profile)
const outDir = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || join(repo, 'evidence')
mkdirSync(outDir, { recursive: true })
const timer = setTimeout(() => { console.error('Probe timed out'); app.exit(1) }, 115000)

// Boot the real built main process (registers ipc handlers, protocol, window).
require(join(repo, 'out/main/index.js'))

app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  // Real WAV fixture on disk: tone 0-2s, silence 2-6s, tone 6-8s, silence 8-10s.
  const wavPath = join(profile, 'probe.wav')
  const samples = 160000, bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write('WAVE', 8)
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    const t = i / 16000
    const v = t < 2 || (t >= 6 && t < 8) ? Math.round(Math.sin(i * 0.1) * 9000) : 0
    bytes.writeInt16LE(v, 44 + i * 2)
  }
  writeFileSync(wavPath, bytes)

  const win = await (async () => {
    for (let i = 0; i < 300; i++) { const w = BrowserWindow.getAllWindows()[0]; if (w) return w; await sleep(50) }
    throw Error('No BrowserWindow created by the built main process')
  })()
  win.webContents.setAudioMuted(true)
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error('[renderer]', message) })
  const js = async (expression) => win.webContents.executeJavaScript(expression)
  const waitFor = async (label, expression, tries = 900) => {
    for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(100) }
    throw Error('Missing ' + label + '\n' + (await js('document.body.innerText')).slice(0, 1400))
  }
  const signature = () => js(`(() => {
    const raw = localStorage.getItem('speechedit:project')
    const p = raw ? JSON.parse(raw) : null
    if (!p) return null
    return {
      words: p.transcript.words.filter((w) => !w.deleted).length,
      chapters: (p.scenes ?? []).length,
      cuts: (p.cuts ?? []).length,
      applied: (p.suggestions ?? []).filter((s) => s.applied).length,
      tracks: JSON.stringify(p.tracks ?? [])
    }
  })()`)

  console.log('STAGE window ready')
  await waitFor('app ready', `(() => { const b = [...document.querySelectorAll('button')].find(n => n.textContent.trim() === 'File'); if (!b) return false; b.click(); return true })()`)
  await waitFor('new reel', `(() => { const b = [...document.querySelectorAll('button')].find(n => n.textContent.trim() === 'New reel'); if (!b) return false; b.click(); return true })()`)
  await waitFor('empty reel', `document.querySelector('.transcript-heading small')?.textContent.includes('0 words')`)
  console.log('STAGE empty reel, dropping fixture')

  await js(`(() => {
    const bytes = ${JSON.stringify(bytes.toString('base64'))}
    const bin = atob(bytes); const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const file = new File([arr], 'probe.wav', { type: 'audio/wav' })
    Object.defineProperty(file, 'path', { value: ${JSON.stringify(wavPath)} })
    const transfer = new DataTransfer(); transfer.items.add(file)
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
  })()`)

  // 1. Real ffmpeg looks analysis cuts the dead air and invites undo.
  await waitFor('undo-inviting first-edit toast', `(() => { const t = document.querySelector('.toast span[role="status"]'); return t && /undo to put (it|them) back/i.test(t.textContent) })()`)
  await sleep(500)
  const before = await js(`({
    toast: document.querySelector('.toast span[role="status"]').textContent,
    buttons: [...document.querySelectorAll('.toast button')].map(b => ({ text: b.textContent.trim(), aria: b.getAttribute('aria-label') })),
    heading: document.querySelector('.transcript-heading small').textContent
  })`)
  const beforeSig = await signature()
  console.log('BEFORE', JSON.stringify({ ...before, signature: beforeSig }))

  // 2. Keyboard-only: start on Dismiss, Tab backwards to the Undo chip, press Enter.
  await js(`document.querySelector('.toast button[aria-label="Dismiss message"]').focus()`)
  const dismissFocused = await js(`document.activeElement?.getAttribute('aria-label')`)
  win.webContents.sendInputEvent({ type: 'rawKeyDown', keyCode: 'Tab', modifiers: ['shift'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] })
  await sleep(150)
  const undoFocused = await js(`document.activeElement?.getAttribute('aria-label')`)
  win.webContents.sendInputEvent({ type: 'rawKeyDown', keyCode: 'Return', windowsVirtualKeyCode: 13 })
  win.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', windowsVirtualKeyCode: 13 })
  await waitFor('undo confirmation toast', `(() => { const t = document.querySelector('.toast span[role="status"]'); return t && /undid the last edit/i.test(t.textContent) })()`)
  await sleep(500)
  const after = await js(`({
    toast: document.querySelector('.toast span[role="status"]').textContent,
    undoChipGone: !document.querySelector('.toast button[aria-label="Undo the last edit"]'),
    heading: document.querySelector('.transcript-heading small').textContent
  })`)
  const afterSig = await signature()
  console.log('FOCUSED', JSON.stringify({ dismissFocused, undoFocused }))
  console.log('AFTER', JSON.stringify({ ...after, signature: afterSig }))

  // 3. Redo path: Ctrl+Shift+Z re-applies the automatic edit.
  win.webContents.sendInputEvent({ type: 'rawKeyDown', keyCode: 'Z', modifiers: ['control', 'shift'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control', 'shift'] })
  await sleep(600)
  const redoneSig = await signature()
  console.log('REDONE', JSON.stringify({ signature: redoneSig }))

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const ok =
    before.buttons.some(b => b.text === 'Undo' && b.aria === 'Undo the last edit') &&
    before.buttons.some(b => b.text === 'Dismiss') &&
    dismissFocused === 'Dismiss message' &&
    undoFocused === 'Undo the last edit' &&
    /undid the last edit\. redo puts it back\./i.test(after.toast) &&
    after.undoChipGone &&
    Boolean(beforeSig) && beforeSig.cuts > 0 && beforeSig.applied > 0 &&
    Boolean(afterSig) && afterSig.cuts === 0 && afterSig.applied === 0 &&
    same(beforeSig, redoneSig)
  const result = { ok, before, beforeSig, dismissFocused, undoFocused, after, afterSig, redoneSig }
  writeFileSync(join(outDir, 'desktop-undo-probe.result.json'), JSON.stringify(result, null, 2))
  console.log('PROBE_RESULT', JSON.stringify(result))
  clearTimeout(timer)
  app.exit(ok ? 0 : 2)
}).catch(error => { console.error('PROBE_ERROR', error && error.stack || error); app.exit(1) })
