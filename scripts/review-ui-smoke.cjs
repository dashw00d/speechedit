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
  await click(win, 'Share'); await click(win, 'Create review link')
  await waitFor(win, `!!document.querySelector('.review-link-box input')`)
  const link = await win.webContents.executeJavaScript(`document.querySelector('.review-link-box input').value`)
  console.log('Created review using real browser compression', videoFixture ? 'video + audio' : 'audio')
  const reviewer = windowFor('reviewer')
  await reviewer.loadURL(link)
  await waitFor(reviewer, `document.querySelectorAll('.review-word').length === 8`)
  await waitFor(reviewer, `document.querySelector('video')?.readyState >= 2`)
  const previewInfo = await reviewer.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); return { duration: v.duration, width: v.videoWidth, height: v.videoHeight }; })()`)
  if (Math.abs(previewInfo.duration - 10) > 0.25 || previewInfo.width > 640 || previewInfo.height > 360) throw Error('Incorrect proxy timing or resolution: ' + JSON.stringify(previewInfo))
  console.log('Preview:', previewInfo)
  const untouched = await reviewer.webContents.executeJavaScript(`localStorage.getItem('speechedit:project')`)
  if (untouched !== null) throw Error('Review wrote to the editor workspace')
  await field(reviewer, '.review-feedback input[maxlength="80"]', 'Review tester')
  await field(reviewer, '.review-feedback textarea', 'Remove this opening word')
  await reviewer.webContents.executeJavaScript(`document.querySelector('.review-word').click()`)
  await click(reviewer, 'Propose cut')
  await waitFor(reviewer, `document.querySelectorAll('.review-proposal').length === 1`)
  const afterProposal = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('speechedit:project'))`)
  if (JSON.stringify(afterProposal.cuts) !== JSON.stringify(original.cuts)) throw Error('Audit mutated the owner before acceptance')
  await click(reviewer, 'Preview')
  await waitFor(reviewer, `!!document.querySelector('.review-preview-note')`)
  await new Promise(r => setTimeout(r, 350))
  writeFileSync('/tmp/speechedit-review-page.png', (await reviewer.webContents.capturePage()).toPNG())
  await click(win, 'Refresh feedback')
  await waitFor(win, `document.querySelectorAll('.review-proposal').length === 1`)
  await click(win, 'Accept edit')
  await waitFor(win, `document.querySelector('.review-proposal')?.dataset.status === 'accepted'`)
  const accepted = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('speechedit:project'))`)
  if (accepted.cuts.length <= original.cuts.length) throw Error('Acceptance did not apply the cut')
  if (accepted.assets[Object.keys(original.assets)[0]].path !== original.assets[Object.keys(original.assets)[0]].path) throw Error('Original media reference changed')
  await click(win, 'Close'); await click(win, 'Undo')
  const undone = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('speechedit:project'))`)
  if (JSON.stringify(undone.cuts) !== JSON.stringify(original.cuts)) throw Error('Acceptance was not undoable')
  await click(win, 'Share')
  await waitFor(win, `!!document.querySelector('.review-link-box input')`)
  await click(win, 'Revoke link…'); await click(win, 'Revoke and delete previews')
  await waitFor(win, `!document.querySelector('.review-link-box')`)
  await click(reviewer, 'Refresh feedback')
  await waitFor(reviewer, `document.querySelector('[role="alert"]')?.textContent.includes('revoked')`)
  console.log(JSON.stringify({ compressedUpload: true, auditIsolated: true, proposedCut: true, accepted: true, originalRetained: true, undo: true, revoked: true }))
  win.destroy(); reviewer.destroy(); clearTimeout(timer); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
