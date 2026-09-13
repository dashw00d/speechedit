// End-to-end first-session undo/redo probe for the built web editor.
// Drops a recording, waits for the automatic first edit to offer Undo, then
// reverses it with the inline Undo chip using real keyboard input
// (Shift+Tab from Dismiss, Enter) and redoes with Ctrl+Shift+Z.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const profile = mkdtempSync(join(tmpdir(), 'speechedit-first-undo-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
const url = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3088'
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'docs/runs'
const timer = setTimeout(() => { console.error('first-session-undo-smoke timed out'); app.exit(1) }, 120000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1280, height: 900, webPreferences: { sandbox: true, partition: 'first-undo', backgroundThrottling: false } })
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error(message) })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    const NativeWorker = window.Worker;
    window.Worker = class extends EventTarget {
      constructor(url, options) { super(); if (!String(url).includes('browserWhisper.worker')) return new NativeWorker(url, options); }
      terminate() { this.stopped = true; }
      emit(data) { setTimeout(() => { if (!this.stopped) this.onmessage?.({ data }); }, 10); }
      postMessage(message) {
        if (message.type === 'load') this.emit({ type: 'ready', backend: 'wasm' });
        else this.emit({ type: 'result', id: message.id, cues: [
          { text: 'Welcome um to this uh recording.', start: 0, end: 2.4 },
          { text: 'Now a different chapter.', start: 2.5, end: 4.5 }
        ] });
      }
    };
  ` })
  await win.loadURL(url)
  const js = (expression) => win.webContents.executeJavaScript(expression)
  const waitFor = async (label, expression, ms = 60000) => {
    const started = Date.now()
    while (Date.now() - started < ms) { if (await js(expression)) return; await new Promise(r => setTimeout(r, 40)) }
    throw new Error('Missing ' + label + '\n' + (await js('document.body.innerText')).slice(0, 1200))
  }
  const clickText = (text) => js(`(() => { const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('unavailable '+${JSON.stringify(text)}); b.click(); return true })()`)
  const press = (keyCode, modifiers) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'char', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const snapshot = () => js(`(() => {
    const heading = document.querySelector('.transcript-heading small')?.textContent || '';
    const words = Number((heading.match(/(\\d+) words/) || [])[1]);
    const chapters = Number((heading.match(/(\\d+) chapters?/) || [])[1]);
    return {
      heading, words, chapters,
      toast: document.querySelector('.toast span[role="status"]')?.textContent || null,
      toastButtons: [...document.querySelectorAll('.toast button')].map(b => ({ text: b.textContent.trim(), aria: b.getAttribute('aria-label') })),
      suggest: document.querySelector('.suggest-bar')?.innerText?.replace(/\\s+/g, ' ').trim() || null
    };
  })()`)

  await waitFor('File menu', `[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='File')`)
  await clickText('File')
  await waitFor('New reel', `[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='New reel')`)
  await clickText('New reel')
  await waitFor('empty reel', `document.querySelector('.transcript-heading small')?.textContent.includes('0 words')`)
  await js(`(() => {
    const samples = 160000, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
    const str = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * 0.1) * 2000, true);
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'first-session.wav', { type: 'audio/wav' }));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  })()`)

  await waitFor('automatic first-edit undo toast', `(() => { const t=document.querySelector('.toast span[role="status"]'); return t && /[Uu]ndo to put/.test(t.textContent) })()`)
  const before = await snapshot()

  await js(`document.querySelector('.toast button[aria-label="Dismiss message"]').focus()`)
  const dismissFocused = await js(`document.activeElement?.getAttribute('aria-label')`)
  press('Tab', ['shift'])
  await new Promise(r => setTimeout(r, 150))
  const undoFocused = await js(`document.activeElement?.getAttribute('aria-label')`)
  press('Enter')
  await waitFor('undo confirmation', `(() => { const t=document.querySelector('.toast span[role="status"]'); return t && /Undid the last edit/i.test(t.textContent) })()`)
  const after = await snapshot()

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control', 'shift'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control', 'shift'] })
  await waitFor('redo re-applies the first edit', `document.querySelector('.transcript-heading small')?.textContent.includes('${before.words} words')`, 15000)
  const redone = await snapshot()

  const ok =
    before.toastButtons.some(b => b.text === 'Undo' && b.aria === 'Undo the last edit') &&
    before.toastButtons.some(b => b.text === 'Dismiss') &&
    dismissFocused === 'Dismiss message' &&
    undoFocused === 'Undo the last edit' &&
    /Undid the last edit/i.test(after.toast || '') &&
    after.words > before.words &&
    redone.words === before.words &&
    /safe|ready/i.test(after.suggest || '') &&
    before.heading.includes(`${before.words} words`)
  const result = { ok, before, dismissFocused, undoFocused, after, redone }
  writeFileSync(join(out, 'first-session-undo-smoke.json'), JSON.stringify(result, null, 2))
  console.log('RESULT', JSON.stringify(result))
  clearTimeout(timer)
  app.exit(ok ? 0 : 2)
}).catch(error => { console.error('FAIL', error.message); app.exit(1) })
