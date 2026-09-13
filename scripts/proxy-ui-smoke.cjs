// Local-only encoder verification: no source files or results leave the loopback server.
const { app, BrowserWindow } = require('electron')
const { createServer } = require('node:http')
const { createReadStream, createWriteStream, statSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const temp = mkdtempSync('/tmp/speechedit-proxy-smoke-')
app.setPath('userData', join(temp, 'profile'))
const fixture = join(temp, 'fixture.mp4')
const ffmpeg = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', fixture])
if (ffmpeg.status !== 0) throw Error(ffmpeg.stderr.toString())
const entry = join(temp, 'entry.ts')
writeFileSync(entry, `export { encodeReviewProxy } from ${JSON.stringify(resolve('src/renderer/src/lib/reviewProxy.ts'))}; export { registerBrowserMedia } from ${JSON.stringify(resolve('src/renderer/src/lib/browserMediaStore.ts'))};`)
const build = spawnSync('bun', ['build', entry, '--target', 'browser', '--outdir', join(temp, 'bundle')], { encoding: 'utf8' })
if (build.status !== 0) throw Error(build.stderr)
const server = createServer((req, res) => {
  if (req.method === 'POST' && ['/fast', '/fallback'].includes(req.url)) {
    const out = createWriteStream(join(temp, req.url.slice(1) + '.webm')); req.pipe(out); out.on('finish', () => res.end('ok')); return
  }
  const file = req.url === '/input.mp4' ? fixture : req.url === '/entry.js' ? join(temp, 'bundle', 'entry.js') : null
  if (!file) { res.setHeader('Content-Type', 'text/html'); res.end('<title>Preview encoder test</title>Testing compressed previews locally.'); return }
  res.writeHead(200, { 'Content-Type': file === fixture ? 'video/mp4' : 'text/javascript', 'Content-Length': statSync(file).size })
  createReadStream(file).pipe(res)
})
const timer = setTimeout(() => { console.error('Proxy smoke timed out'); app.exit(1) }, 90000)
app.whenReady().then(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const win = new BrowserWindow({ show: true, webPreferences: { sandbox: true, backgroundThrottling: false } })
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  const first = await win.webContents.executeJavaScript(`(async () => {
    const api = await import('/entry.js'), file = new File([await (await fetch('/input.mp4')).blob()], 'fixture.mp4', { type: 'video/mp4', lastModified: 1 })
    const path = await api.registerBrowserMedia(file), asset = { id: 'fixture', name: file.name, path, kind: 'video', duration: 5, waveform: [] }
    const modes = [], start = performance.now()
    const blob = await api.encodeReviewProxy(asset, new AbortController().signal, () => {}, value => modes.push(value.mode))
    if (modes.join(',') !== 'fast') throw Error('Fast encoding unexpectedly fell back: ' + modes)
    await fetch('/fast', { method: 'POST', body: blob })
    const cachedModes = [], cached = await api.encodeReviewProxy(asset, new AbortController().signal, () => {}, value => cachedModes.push(value.mode))
    if (cachedModes.join(',') !== 'cached' || cached.size !== blob.size) throw Error('Preview cache missed')
    const cancel = new AbortController(), other = { ...asset, path: await api.registerBrowserMedia(new File([file], 'cancel.mp4', { type: file.type, lastModified: 2 })) }
    let aborted = false
    try { await api.encodeReviewProxy(other, cancel.signal, () => cancel.abort()) } catch { aborted = cancel.signal.aborted }
    if (!aborted) throw Error('Cancelled encoding returned a preview')
    return { fastSeconds: (performance.now() - start) / 1000, bytes: blob.size, cacheHit: true, cancelled: true }
  })()`)
  await win.reload()
  const second = await win.webContents.executeJavaScript(`(async () => {
    const api = await import('/entry.js'), data = await (await fetch('/input.mp4')).blob()
    const file = new File([data], 'fixture.mp4', { type: 'video/mp4', lastModified: 1 })
    const asset = { id: 'fixture', name: file.name, path: await api.registerBrowserMedia(file), kind: 'video', duration: 5, waveform: [] }
    const modes = []; await api.encodeReviewProxy(asset, new AbortController().signal, () => {}, value => modes.push(value.mode))
    if (modes.join(',') !== 'cached') throw Error('Cache did not survive reload')
    const native = window.VideoEncoder; window.VideoEncoder = undefined
    try {
      const fallbackModes = [], blob = await api.encodeReviewProxy({ ...asset, path: await api.registerBrowserMedia(new File([data], 'fallback.mp4', { type: file.type, lastModified: 3 })) }, new AbortController().signal, () => {}, value => fallbackModes.push(value.mode))
      if (!fallbackModes.includes('playback')) throw Error('Missing playback fallback status: ' + fallbackModes)
      await fetch('/fallback', { method: 'POST', body: blob })
      return { cacheAfterReload: true, fallback: true }
    } finally { window.VideoEncoder = native }
  })()`)
  for (const name of ['fast', 'fallback']) {
    const input = join(temp, name + '.webm'), indexed = join(temp, name + '-indexed.webm')
    const remux = spawnSync('ffmpeg', ['-v', 'error', '-i', input, '-c', 'copy', indexed])
    if (remux.status !== 0) throw Error(remux.stderr.toString())
    const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', indexed], { encoding: 'utf8' }).stdout)
    const video = probe.streams.find(s => s.codec_type === 'video'), audio = probe.streams.find(s => s.codec_type === 'audio')
    if (!video || !audio || video.width !== 640 || video.height !== 360 || Math.abs(Number(probe.format.duration) - 5) > 0.3) throw Error('Incorrect preview timing or tracks: ' + name)
    if (name === 'fast' && video.r_frame_rate !== '8/1') throw Error('Incorrect preview frame rate')
  }
  console.log(JSON.stringify({ ...first, ...second, tracksAndTiming: true }))
  win.destroy(); server.close(); clearTimeout(timer); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
app.on('quit', () => rmSync(temp, { recursive: true, force: true }))
