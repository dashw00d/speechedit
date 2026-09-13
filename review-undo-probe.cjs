// Reviewer probe: first-session toast Undo journey on the built web app.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const profile = mkdtempSync(join(tmpdir(), 'speechedit-review-undo-probe-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
const url = process.argv[2] || 'http://127.0.0.1:3311'
const timer = setTimeout(() => { console.error('Probe timed out'); app.exit(1) }, 120000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { sandbox: true, partition: 'probe', backgroundThrottling: false } })
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error(message) })
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    const NativeWorker = window.Worker;
    window.__transcriptionTest = { attempts: 0, cpuLoads: 0 };
    window.Worker = class extends EventTarget {
      constructor(url, options) { super(); if (!String(url).includes('browserWhisper.worker')) return new NativeWorker(url, options); }
      terminate() { this.stopped = true; }
      emit(data) { setTimeout(() => { if (!this.stopped) this.onmessage?.({ data }); }, 10); }
      postMessage(message) {
        if (message.type === 'load') {
          if (message.backend !== 'wasm') this.emit({ type: 'fallback', reason: 'GPU unavailable in UI fixture' });
          else { window.__transcriptionTest.cpuLoads++; this.emit({ type: 'ready', backend: 'wasm', fallbackReason: message.fallbackReason }); }
        } else {
          window.__transcriptionTest.attempts++;
          this.emit({ type: 'result', id: message.id, cues: [
            { text: 'Welcome to this recording.', start: 0, end: 2 },
            { text: 'Now a different chapter.', start: 6, end: 8 }
          ] });
        }
      }
    };
  ` })
  await win.loadURL(url)
  await win.webContents.executeJavaScript(`(async () => {
    const wait = async predicate => { for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('UI did not settle'); };
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text);
    await wait(() => button('File'));
    button('File').click();
    await wait(() => button('New reel'));
    button('New reel').click();
    await wait(() => document.querySelector('.transcript-heading small')?.textContent.includes('0 words'));
    const samples = 160000, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
    const str = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) { const t = i / 16000; const audible = (t < 2 || (t >= 6 && t < 8)) ? Math.sin(i * 0.1) * 2000 : 0; view.setInt16(44 + i * 2, audible, true) }
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'probe.wav', { type: 'audio/wav' }));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  })()`)
  const js = async expression => win.webContents.executeJavaScript(expression)
  const waitFor = async (label, expression) => {
    for (let i = 0; i < 400; i++) { if (await js(expression)) return; await new Promise(r => setTimeout(r, 50)) }
    throw Error('Missing ' + label + '\n' + await js('document.body.innerText'))
  }

  // 1. Wait for the automatic first edit toast that invites undo.
  const observed = []
  for (let i = 0; i < 250; i++) {
    const snap = await js(`({ toast: document.querySelector('.toast span[role="status"]')?.textContent ?? null, heading: document.querySelector('.transcript-heading small')?.textContent ?? null })`)
    const key = JSON.stringify(snap)
    if (!observed.length || observed[observed.length - 1].key !== key) observed.push({ t: (i * 0.1).toFixed(1), key, ...snap })
    if (snap.toast && /undo to put (it|them) back/i.test(snap.toast)) break
    await new Promise(r => setTimeout(r, 100))
  }
  console.log('TIMELINE', JSON.stringify(observed, null, 1))
  if (!observed.length || !observed[observed.length - 1].toast || !/undo to put (it|them) back/i.test(observed[observed.length - 1].toast)) {
    console.log('PANELS', await js(`({
      transcript: document.querySelector('.panel.transcript')?.innerText.slice(0, 1500) ?? null,
      aside: [...document.querySelectorAll('aside, .suggestions, [class*=suggestion]')].map(n => n.innerText.slice(0, 800)).join(' || ').slice(0, 2000) || null
    })`))
    throw Error('Missing undo-inviting toast')
  }
  const before = await js(`({
    toast: document.querySelector('.toast span[role="status"]').textContent,
    buttons: [...document.querySelectorAll('.toast button')].map(b => ({ text: b.textContent.trim(), aria: b.getAttribute('aria-label') })),
    heading: document.querySelector('.transcript-heading small').textContent
  })`)
  console.log('BEFORE', JSON.stringify(before))

  // 2. Focus the Undo chip and press Enter through the real input pipeline.
  await js(`document.querySelector('.toast button[aria-label="Undo the last edit"]').focus()`)
  const focused = await js(`document.activeElement?.getAttribute('aria-label')`)
  win.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await waitFor('post-undo toast', `(() => { const t = document.querySelector('.toast span[role="status"]'); return t && /undid the last edit/i.test(t.textContent) })()`)
  const after = await js(`({
    toast: document.querySelector('.toast span[role="status"]').textContent,
    undoChipPresent: !!document.querySelector('.toast button[aria-label="Undo the last edit"]'),
    heading: document.querySelector('.transcript-heading small').textContent
  })`)
  console.log('FOCUSED', JSON.stringify({ focused }))
  console.log('AFTER', JSON.stringify(after))

  const ok =
    before.buttons.some(b => b.text === 'Undo' && b.aria === 'Undo the last edit') &&
    before.buttons.some(b => b.text === 'Dismiss') &&
    focused === 'Undo the last edit' &&
    /undid the last edit/i.test(after.toast) &&
    after.heading === before.heading
  console.log('PROBE_RESULT', JSON.stringify({ ok }))
  clearTimeout(timer)
  app.exit(ok ? 0 : 2)
}).catch(error => { console.error(error); app.exit(1) })
