// Reviewer probe (RYA-27/SPE-06): real browser-Whisper worker, WebGPU force-disabled,
// so the production fallback to CPU/WASM is exercised end to end with real audio.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, readdirSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')

app.commandLine.appendSwitch('disable-features', 'WebGPU,WebGPUService')
const profile = mkdtempSync(join(tmpdir(), 'speechedit-gpu-fallback-probe-'))
app.setPath('userData', profile)
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))
const origin = new URL(process.argv.find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:3088').origin
const assets = resolve('src/renderer/dist/assets')
const filename = readdirSync(assets).find(name => /^browserWhisper.worker-.*\.js$/.test(name))
if (!filename) throw new Error('Run bun run build:web first.')
const audioB64 = readFileSync('/home/ryan/.speechedit/samples/jfk.wav').toString('base64')
const deadline = setTimeout(() => { console.error('GPU fallback probe timed out.'); app.exit(1) }, 240_000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const runtimeRequests = []
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: new URL(details.url).hostname === 'cdn.jsdelivr.net' })
  })
  window.webContents.session.webRequest.onCompleted(details => {
    if (/ort-wasm/.test(details.url)) runtimeRequests.push({ url: details.url, status: details.statusCode })
  })
  await window.loadURL(`${origin}/healthz`)
  const gpuState = await window.webContents.executeJavaScript(`({ gpu: 'gpu' in navigator, secure: window.isSecureContext })`)
  const result = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    let worker = new Worker(${JSON.stringify(`/assets/${filename}`)});
    let backend;
    let audioDuration;
    let fallbackReason;
    const onmessage = ({ data }) => {
      if (data.type === 'fallback') {
        fallbackReason = data.reason;
        worker.terminate();
        worker = new Worker(${JSON.stringify(`/assets/${filename}`)});
        worker.onmessage = onmessage;
        worker.onerror = event => reject(new Error(event.message));
        worker.postMessage({ type: 'load', backend: 'wasm', fallbackReason: data.reason });
      } else if (data.type === 'ready') {
        backend = data.backend;
        fallbackReason = data.fallbackReason ?? fallbackReason;
        const context = new AudioContext({ sampleRate: 16000 });
        context.decodeAudioData(Uint8Array.from(atob(${JSON.stringify(audioB64)}), c => c.charCodeAt(0)).buffer)
          .then(decoded => { audioDuration = decoded.duration; const audio = decoded.getChannelData(0).slice(); return context.close().then(() => { worker.postMessage({ type: 'transcribe', id: 'probe', audio }, [audio.buffer]) }) })
          .catch(reject);
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
  if (result.backend !== 'wasm') throw new Error('Expected CPU/WASM fallback, got: ' + JSON.stringify(result))
  if (!result.fallbackReason) throw new Error('Expected a real fallback reason: ' + JSON.stringify(result))
  if (result.cues.length < 3 || result.cues.some(cue => /\s/.test(cue.text.trim()))) {
    throw new Error('Expected individual spoken words with timestamps: ' + JSON.stringify(result.cues.slice(0, 8)))
  }
  if (result.cues.some(cue => cue.start < 0 || cue.end > result.audioDuration || cue.end < cue.start)) throw new Error('Word timestamps exceed the recording.')
  const durations = new Set(result.cues.map(cue => Math.round((cue.end - cue.start) * 100)))
  if (durations.size < 3) throw new Error('Word timings appear evenly interpolated.')
  console.log('PROBE_GPU_FALLBACK ' + JSON.stringify({ gpuState, backend: result.backend, fallbackReason: result.fallbackReason, words: result.cues.length, audioDuration: result.audioDuration, firstCues: result.cues.slice(0, 3), sameOriginRuntime: true }))
  clearTimeout(deadline)
  window.destroy()
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
