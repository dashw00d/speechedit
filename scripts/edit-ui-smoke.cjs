const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')

const profile = mkdtempSync(join(tmpdir(), 'speechedit-review-ui-'))
let videoFixture = ''
if (process.env.SPEECHEDIT_REVIEW_VIDEO === '1') {
  const output = join(profile, 'source.webm')
  const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', output])
  if (result.status !== 0) throw Error(result.stderr.toString())
  videoFixture = readFileSync(output).toString('base64')
}
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
const url = process.argv.find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:3088'
const timer = setTimeout(() => { console.error('Review UI timed out'); app.exit(1) }, 120000)
async function waitFor(win, expression) {
  for (let i = 0; i < 700; i++) { if (await win.webContents.executeJavaScript(expression)) return; await new Promise(r => setTimeout(r, 50)) }
  throw Error('Missing ' + expression + '\n' + await win.webContents.executeJavaScript('document.body.innerText'))
}
const click = (win, text) => win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw Error('Button unavailable: ' + ${JSON.stringify(text)}); b.click(); })()`)
async function field(win, selector, value) {
  await win.webContents.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`)
}
function windowFor(partition) {
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error(message) })
  return win
}
app.whenReady().then(async () => {
  const win = windowFor('owner')
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      const NativeWorker = window.Worker;
      let fail = false;
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
            if (fail) { fail = false; this.emit({ type: 'error', id: message.id, error: 'Temporary transcription failure' }); }
            else this.emit({ type: 'result', id: message.id, cues: [
              { text: 'Welcome to this recording.', start: 0, end: 2 },
              { text: 'Now a different chapter.', start: 6, end: 8 }
            ] });
          }
        }
      };
    ` })
    await win.loadURL(url)
    await win.webContents.executeJavaScript(`(async () => {
      const wait = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 30)); } throw Error('UI did not settle'); };
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
      for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * 0.1) * 2000, true);
      const transfer = new DataTransfer(); transfer.items.add(${videoFixture ? `new File([Uint8Array.from(atob(${JSON.stringify(videoFixture)}), c => c.charCodeAt(0))], 'review-video.webm', { type: 'video/webm' })` : `new File([bytes], 'transcription-test.wav', { type: 'audio/wav' })`});
      document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    })()`)

  await waitFor(win, `document.querySelector('.transcript-heading small')?.textContent.includes('2 chapters')`)
  const original = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('speechedit:project'))`)

  await click(win, 'Share'); await click(win, 'Create editing link')
  await waitFor(win, `!!document.querySelector('.review-link-box input')`)
  const link = await win.webContents.executeJavaScript(`document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editor link')
  const reviewer = windowFor('reviewer')
  await reviewer.loadURL(link)
  await waitFor(reviewer, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`)
  await field(reviewer, '[aria-label="Editor name"]', 'Remote editor')
  const cache = await reviewer.webContents.executeJavaScript(`localStorage.getItem('speechedit:project')`)
  if (cache !== null) throw Error('Shared editor contaminated local workspace')
  const correctWord = async (window, index, text) => {
    window.focus()
    await window.webContents.executeJavaScript(`document.querySelectorAll('.word')[${index}].click()`)
    await waitFor(window, `[...document.querySelectorAll('button')].some(b => /Correct word/.test(b.textContent))`)
    await window.webContents.executeJavaScript(`([...document.querySelectorAll('button')].find(b => /Correct word/.test(b.textContent))).click()`)
    await waitFor(window, `!!document.querySelector('.word-edit')`)
    await window.webContents.executeJavaScript(`document.querySelector('.word-edit').focus()`)
    await field(window, '.word-edit', text)
    await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('.word-edit'); input.blur(); if (input.isConnected) input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); })()`)
    await waitFor(window, `!document.querySelector('.word-edit') && document.querySelectorAll('.word')[${index}]?.textContent === ${JSON.stringify(text)}`)
  }
  await correctWord(reviewer, 0, 'RemoteWelcome')
  await click(reviewer, 'Save now')
  await waitFor(reviewer, `document.querySelector('.shared-edit-bar [role="status"]')?.textContent.includes('All changes saved')`)
  const id = new URL(link).pathname.split('/')[2], key = new URL(link).hash.slice(1)
  const remote = await reviewer.webContents.executeJavaScript(`fetch('/api/reviews/${id}', { headers: { Authorization: 'Bearer ${key}' } }).then(r => r.json())`)
  if (remote.project.transcript.words[0].text !== 'RemoteWelcome') throw Error('Remote word was not saved')
  if (remote.projectRevision < 2) throw Error('No shared revision')
  const assetId = Object.keys(remote.project.assets)[0]
  const proxyBytes = await reviewer.webContents.executeJavaScript(`fetch('/api/reviews/${id}/media/${assetId}').then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b)))`)
  const proxyPath = join(profile, 'downloaded-proxy.webm'); writeFileSync(proxyPath, Buffer.from(proxyBytes))
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', proxyPath], { encoding: 'utf8' }).stdout)
  const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio')
  if (!audio || Math.abs(Number(probe.format.duration) - 10) > 0.25) throw Error('Proxy audio or duration incorrect')
  if (videoFixture && (!video || video.width > 640 || video.height > 360 || video.r_frame_rate !== '8/1')) throw Error('Incorrect video proxy: ' + JSON.stringify(video))
  console.log('Compressed preview', { bytes: proxyBytes.length, duration: probe.format.duration, fps: video?.r_frame_rate, codec: audio.codec_name })
  await reviewer.reload()
  await waitFor(reviewer, `document.querySelector('.word')?.textContent === 'RemoteWelcome'`)
  await new Promise(r => setTimeout(r, 350))
  writeFileSync('/tmp/speechedit-full-editor.png', (await reviewer.webContents.capturePage()).toPNG())
  const second = windowFor('second-editor'); await second.loadURL(link)
  await waitFor(second, `document.querySelector('.word')?.textContent === 'RemoteWelcome'`)
  await correctWord(second, 1, 'Collaborator')
  await click(second, 'Save now')
  await waitFor(reviewer, `document.querySelectorAll('.word')[1]?.textContent === 'Collaborator'`)
  let blocked = true
  reviewer.webContents.session.webRequest.onBeforeRequest({ urls: [new URL(link).origin + '/api/reviews/*'] }, (_d, cb) => cb({ cancel: blocked }))
  await correctWord(reviewer, 0, 'MyConflict')
  await correctWord(second, 0, 'TheirConflict')
  await click(second, 'Save now')
  await waitFor(second, `document.querySelector('.shared-edit-bar [role="status"]')?.textContent.includes('All changes saved')`)
  blocked = false
  await click(reviewer, 'Save now')
  await waitFor(reviewer, `!!document.querySelector('.shared-conflict')`)
  await reviewer.reload()
  await waitFor(reviewer, `!!document.querySelector('.shared-conflict')`)
  await click(reviewer, 'Keep my conflicting edits')
  await waitFor(reviewer, `!document.querySelector('.shared-conflict') && document.querySelector('.shared-edit-bar [role="status"]')?.textContent.includes('All changes saved')`)
  await waitFor(second, `document.querySelector('.word')?.textContent === 'MyConflict'`)
  reviewer.focus()
  await reviewer.webContents.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180
    const c = canvas.getContext('2d'); c.fillStyle = 'navy'; c.fillRect(0, 0, 320, 180); c.fillStyle = 'white'; c.font = '24px sans-serif'; c.fillText('Remote image', 30, 95)
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/png'))
    const native = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function() {
      if (this.type !== 'file') return native.call(this)
      HTMLInputElement.prototype.click = native
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'remote-image.png', { type: 'image/png' })); this.files = transfer.files
      this.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })()`)
  await click(reviewer, '+ Add'); await click(reviewer, 'Picture or B-roll…')
  await waitFor(reviewer, `document.body.innerText.includes('remote-image')`)
  await click(reviewer, 'Save now')
  await waitFor(reviewer, `document.querySelector('.shared-edit-bar [role="status"]')?.textContent.includes('All changes saved')`)
  const mediaRoom = await reviewer.webContents.executeJavaScript(`fetch('/api/reviews/${id}', { headers: { Authorization: 'Bearer ${key}' } }).then(r => r.json())`)
  const addedImage = Object.values(mediaRoom.project.assets).find(a => a.kind === 'image')
  if (!addedImage || mediaRoom.media[addedImage.id]?.mime !== 'image/webp') throw Error('Remote image was not uploaded and saved')
  const ownerBefore = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('speechedit:project'))`)
  if (ownerBefore.transcript.words[0].text !== original.transcript.words[0].text) throw Error('Remote changed original workspace before pull')
  await click(win, 'Bring shared edits into this project')
  await waitFor(win, `JSON.parse(localStorage.getItem('speechedit:project')).transcript.words[0].text === 'MyConflict'`)
  const pulled = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('speechedit:project'))`)
  if (!pulled.assets[addedImage.id]?.proxyOnly) throw Error('Remote addition lost original-quality render guard')
  if (pulled.assets[Object.keys(original.assets)[0]].path !== original.assets[Object.keys(original.assets)[0]].path) throw Error('Original media changed')
  await click(win, 'Close'); await click(win, 'Undo')
  const undone = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('speechedit:project'))`)
  if (undone.transcript.words[0].text !== original.transcript.words[0].text) throw Error('Shared pull was not undoable')
  await click(win, 'Share'); await waitFor(win, `!!document.querySelector('.review-link-box input')`)
  await click(win, 'Revoke link…'); await click(win, 'Revoke and delete previews')
  await click(reviewer, 'Save now')
  await waitFor(reviewer, `document.querySelector('[role="alert"]')?.textContent.includes('revoked')`)
  console.log(JSON.stringify({ fullEditor: true, compression: true, remoteSave: true, reload: true, secondEditorSync: true, conflictRecovery: true, newImageUpload: true, isolated: true, originalPreserved: true, ownerPullUndo: true, revoked: true }))
  win.destroy(); reviewer.destroy(); second.destroy(); clearTimeout(timer); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
