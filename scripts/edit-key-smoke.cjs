// Shared-project undo probe: create a full editing link, let the recipient make
// a real edit, then reverse it with the inline Undo chip through real keyboard
// input (Shift+Tab from Dismiss, Enter) and redo with Ctrl+Shift+Z.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const profile = mkdtempSync(join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || tmpdir(), 'speechedit-key-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
const url = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3088'
const out = process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'docs/runs'
const timer = setTimeout(() => { console.error('shared-undo-smoke timed out'); app.exit(1) }, 120000)

function windowFor(partition) {
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error(message) })
  return win
}

app.whenReady().then(async () => {
  const owner = windowFor('shared-owner')
  await owner.loadURL('about:blank')
  owner.webContents.debugger.attach('1.3')
  await owner.webContents.debugger.sendCommand('Page.enable')
  await owner.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    const NativeWorker = window.Worker;
    window.Worker = class extends EventTarget {
      constructor(url, options) { super(); if (!String(url).includes('browserWhisper.worker')) return new NativeWorker(url, options); }
      terminate() { this.stopped = true; }
      emit(data) { setTimeout(() => { if (!this.stopped) this.onmessage?.({ data }); }, 10); }
      postMessage(message) {
        if (message.type === 'load') this.emit({ type: 'ready', backend: 'wasm' });
        else this.emit({ type: 'result', id: message.id, cues: [
          { text: 'Welcome to this recording.', start: 0, end: 2 },
          { text: 'Now a different chapter.', start: 3, end: 5 }
        ] });
      }
    };
  ` })
  await owner.loadURL(url)

  const js = (win, expression) => win.webContents.executeJavaScript(expression)
  const waitFor = async (win, label, expression, ms = 45000) => {
    const started = Date.now()
    while (Date.now() - started < ms) { if (await js(win, expression)) return; await new Promise(r => setTimeout(r, 50)) }
    throw new Error('Missing ' + label + '\n' + (await js(win, 'document.body.innerText')).slice(0, 1200))
  }
  const click = (win, text) => js(win, `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('unavailable '+${JSON.stringify(text)}); b.click(); return true })()`)
  const press = (win, keyCode, modifiers) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'char', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }

  await waitFor(owner, 'File menu', `[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='File')`)
  await click(owner, 'File')
  await waitFor(owner, 'New reel', `[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='New reel')`)
  await click(owner, 'New reel')
  await waitFor(owner, 'empty reel', `document.querySelector('.transcript-heading small')?.textContent.includes('0 words')`)
  await js(owner, `(() => {
    const samples = 160000, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
    const str = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * 0.1) * 2000, true);
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'shared.wav', { type: 'audio/wav' }));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
  })()`)
  await waitFor(owner, 'owner words', `document.querySelectorAll('.word').length >= 4`, 60000)
  await click(owner, 'Share')
  await owner.webContents.executeJavaScript(`(() => { const s = document.querySelector('[aria-label="Share access"]'); s.value = 'edit'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await click(owner, 'Create editing link')
  await waitFor(owner, 'share link', `!!document.querySelector('.review-link-box input')`, 60000)
  const link = await js(owner, `document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw new Error('Not a full editing link')

  const recipient = windowFor('shared-recipient')
  await recipient.loadURL(link)
  await waitFor(recipient, 'recipient editor', `document.querySelectorAll('.word').length >= 4 && !!document.querySelector('.timeline-panel')`)

  const checks = []
  const check = (name, pass) => { checks.push({ name, pass }); console.log(name + ': ' + pass) }
  const denied = win => js(win, `!!document.querySelector('[role="alert"]')?.textContent.includes('does not grant access') && !document.querySelector('.timeline-panel') && document.querySelector('.shared-edit-bar button').disabled`)
  const room = new URL(link).pathname.split('/')[2]
  const bad = `${url}/edit/${room}#definitely-not-the-key`
  // This is same-document navigation, matching the original reported path.
  await recipient.loadURL(bad)
  await new Promise(r => setTimeout(r, 2000))
  check('reused context wrong fragment denies editor', await denied(recipient))
  require('node:fs').mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'wrong-key.png'), (await recipient.webContents.capturePage()).toPNG())
  check('server rejects wrong bearer with valid cookie', await js(recipient, `fetch('/api/reviews/${room}', {headers:{Authorization:'Bearer definitely-not-the-key'}}).then(r=>r.status===403)`))
  await recipient.loadURL(link)
  await waitFor(recipient, 'valid key recovery', `!!document.querySelector('.timeline-panel') && document.querySelectorAll('.word').length >= 4`)
  check('valid fragment recovers editor', true)
  await recipient.loadURL(`${url}/edit/${room}`)
  await waitFor(recipient, 'cookie-only access', `!!document.querySelector('.timeline-panel')`)
  recipient.reload()
  await waitFor(recipient, 'cookie-only reload', `!!document.querySelector('.timeline-panel') && document.querySelectorAll('.word').length >= 4`)
  check('cookie-only reload retains access', true)
  const fresh = windowFor('fresh-invalid-key')
  await fresh.loadURL(bad)
  await waitFor(fresh, 'fresh invalid denial', `!!document.querySelector('[role="alert"]')`)
  check('fresh wrong key denies editor', await denied(fresh))
  await recipient.loadURL(bad)
  recipient.reload()
  await waitFor(recipient, 'reused invalid reload denial', `!!document.querySelector('[role="alert"]')`)
  check('reused wrong key reload denies editor', await denied(recipient))
  writeFileSync(join(out, 'results.json'), JSON.stringify({checks, pass:checks.every(c=>c.pass)}, null, 2))
  clearTimeout(timer); app.exit(checks.every(c=>c.pass) ? 0 : 2)
}).catch(error => { console.error(error); app.exit(1) })
