// Production UI integration check with deterministic Whisper responses.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const profile = mkdtempSync(join(tmpdir(), 'speechedit-transcription-ui-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
const url = process.argv.find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:3000'
const timer = setTimeout(() => { console.error('UI transcription test timed out'); app.exit(1) }, 60_000)
app.whenReady().then(async () => {
  for (const mode of ['automatic', 'retry']) {
    const win = new BrowserWindow({ show: true, width: 1280, height: 900,
      webPreferences: { sandbox: true, partition: `test-${mode}`, backgroundThrottling: false } })
    console.log('Starting UI mode:', mode)
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.log('Browser:', message) })
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_details, callback) => callback({ cancel: true }))
    await win.loadURL('about:blank')
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Page.enable')
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      const NativeWorker = window.Worker;
      let fail = ${mode === 'retry'};
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
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'transcription-test.wav', { type: 'audio/wav' }));
      document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    })()`)
    const waitFor = async expression => {
      for (let i = 0; i < 200; i++) {
        if (await win.webContents.executeJavaScript(expression)) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error(`Missing UI state: ${expression}\n${await win.webContents.executeJavaScript('document.body.innerText')}`)
    }
    if (mode === 'retry') {
      await waitFor(`(() => { const b = document.querySelector('.transcript-transcribe-button'); return b && !b.disabled && b.textContent === 'TRANSCRIBE'; })()`)
      await new Promise(resolve => setTimeout(resolve, 300))
      writeFileSync('/tmp/speechedit-transcribe-recovery.png', (await win.webContents.capturePage()).toPNG())
      await win.webContents.executeJavaScript(`document.querySelector('.transcript-transcribe-button').click()`)
    }
    await waitFor(`document.querySelector('.transcript-heading small')?.textContent.includes('2 chapters')`)
    const result = await win.webContents.executeJavaScript(`({ ...window.__transcriptionTest, heading: document.querySelector('.transcript-heading small').textContent, recoveryHidden: !document.querySelector('.transcript-transcribe-button') })`)
    if (result.attempts !== (mode === 'retry' ? 2 : 1) || !result.recoveryHidden) throw new Error(JSON.stringify(result))
    console.log(JSON.stringify({ mode, ...result }))
    await new Promise(resolve => setTimeout(resolve, 300))
    writeFileSync(`/tmp/speechedit-transcribe-${mode}.png`, (await win.webContents.capturePage()).toPNG())
    win.destroy()
  }
  clearTimeout(timer)
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
