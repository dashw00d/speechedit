// Run against a locally served production build. Uses an isolated browser profile.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, readdirSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const profile = mkdtempSync(join(tmpdir(), 'speechedit-whisper-'))
app.setPath('userData', profile)
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
const origin = new URL(process.argv.find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:3000').origin
const assets = resolve('src/renderer/dist/assets')
const filename = readdirSync(assets).find(name => /^browserWhisper.worker-.*\.js$/.test(name))
if (!filename) throw new Error('Run bun run build:web first.')
const deadline = setTimeout(() => { console.error('Whisper smoke test timed out.'); app.exit(1) }, 240_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const runtimeRequests = []
  // A successful test must not depend on the Transformers runtime CDN.
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: new URL(details.url).hostname === 'cdn.jsdelivr.net' })
  })
  window.webContents.session.webRequest.onCompleted(details => {
    if (/ort-wasm/.test(details.url)) runtimeRequests.push({ url: details.url, status: details.statusCode })
  })
  await window.loadURL(`${origin}/healthz`)
  const result = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    let worker = new Worker(${JSON.stringify(`/assets/${filename}`)});
    let backend;
    let audioDuration;
    let fallbackReason;
    const onmessage = ({ data }) => {
      if (data.type === 'fallback') {
        worker.terminate();
        worker = new Worker(${JSON.stringify(`/assets/${filename}`)});
        worker.onmessage = onmessage;
        worker.onerror = event => reject(new Error(event.message));
        worker.postMessage({ type: 'load', backend: 'wasm', fallbackReason: data.reason });
      } else if (data.type === 'ready') {
        backend = data.backend;
        fallbackReason = data.fallbackReason;
        const encoded = ${JSON.stringify(process.env.SPEECHEDIT_WHISPER_AUDIO ? readFileSync(process.env.SPEECHEDIT_WHISPER_AUDIO).toString('base64') : null)};
        const prepare = encoded ? (async () => {
          const context = new AudioContext({ sampleRate: 16000 });
          try {
            const decoded = await context.decodeAudioData(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
            return decoded.getChannelData(0).slice();
          } finally { await context.close(); }
        })() : Promise.resolve(new Float32Array(16000));
        prepare.then(audio => { audioDuration = audio.length / 16000; worker.postMessage({ type: 'transcribe', id: 'smoke', audio }, [audio.buffer]); }).catch(reject);
      } else if (data.type === 'result') {
        worker.terminate();
        resolve({ backend, fallbackReason, transcriptionCompleted: true, cues: data.cues, audioDuration });
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.error));
      }
    };
    worker.onmessage = onmessage;
    worker.onerror = event => reject(new Error(event.message));
    worker.postMessage({ type: 'load' });
  })`)
  if (!runtimeRequests.some(request => request.url.endsWith('.wasm')) ||
      !runtimeRequests.some(request => request.url.endsWith('.mjs')) ||
      runtimeRequests.some(request => new URL(request.url).origin !== origin || request.status !== 200)) {
    throw new Error(`Runtime was not served locally: ${JSON.stringify(runtimeRequests)}`)
  }
  if (process.env.SPEECHEDIT_WHISPER_AUDIO) {
    if (result.cues.length < 3 || result.cues.some(cue => /\s/.test(cue.text.trim()))) {
      throw new Error('Expected individual spoken words with timestamps: ' + JSON.stringify(result.cues));
    }
    if (result.cues.some(cue => cue.start < 0 || cue.end > result.audioDuration || cue.end < cue.start)) throw new Error('Word timestamps exceed the recording.');
    const durations = new Set(result.cues.map(cue => Math.round((cue.end - cue.start) * 100)));
    if (durations.size < 3) throw new Error('Word timings appear evenly interpolated.');
  }
  console.log(JSON.stringify({ ...result, runtimeRequests }, null, 2))
  if (process.env.SPEECHEDIT_EXPECT_BACKEND && result.backend !== process.env.SPEECHEDIT_EXPECT_BACKEND) {
    throw new Error(`Expected ${process.env.SPEECHEDIT_EXPECT_BACKEND}, received ${result.backend}`)
  }
  clearTimeout(deadline)
  window.destroy()
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
