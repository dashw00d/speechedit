/*
 * RYA-493 — independent export replay inside a real host/guest journey on the
 * exact accepted candidate @ 1ad98fd (isolated clone, disposable room, mock
 * Whisper cues, synthetic WAV, real download sinks).
 *
 * Journey: host creates a reel on /, shares an editing link, guest joins on
 * /edit/<room>#<key> in a separate BrowserWindow/partition, corrects a word,
 * saves; host pulls the guest edit; then BOTH sides exercise the real export
 * surfaces. Exported files are written to real download sinks and validated,
 * including that the host's words export reflects the guest's edit.
 *
 * Exit 0 = all checks passed, 2 = acceptance failure, 1 = harness error.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const url = process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3000'
const outDir = process.env.QA493_OUT || path.join(os.tmpdir(), 'speechedit-qa493')
const RUN_MS = Number(process.env.QA493_RUN_MS || 420000)

const results = { url, steps: [], exchanges: [], downloads: [], observations: [] }
const traces = {}
const failures = []
let finished = false

function step(name, value) { results.steps.push({ name, ...(value === undefined ? {} : { value }), at: Date.now() }) }
function observation(id, text) { results.observations.push({ id, text }); console.error('OBSERVATION ' + id + ': ' + text) }
function fail(msg) { failures.push(msg); console.error('FAIL: ' + msg) }
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  results.pass = failures.length === 0 && results.completed === true
  try { fs.writeFileSync(path.join(outDir, 'qa493-trace.json'), JSON.stringify({ url, results, traces, failures }, null, 2)) } catch (e) { console.error('trace write failed', e) }
  console.log('QA493_RESULTS ' + JSON.stringify({ pass: results.pass, failures, downloadCount: results.downloads.length, observations: results.observations.map((o) => o.id) }))
  app.exit(code)
}
const timer = setTimeout(() => { console.error('QA493 timed out'); finish(1) }, RUN_MS)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.mkdirSync(path.join(outDir, 'downloads', 'host'), { recursive: true })
fs.mkdirSync(path.join(outDir, 'downloads', 'guest'), { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'speechedit-qa493-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }))

// --- download sinks (one per side, deterministic save paths) ----------------
const downloads = results.downloads
function attachDownloadSink(win, side) {
  const ses = win.webContents.session
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(true))
  ses.on('will-download', (_event, item) => {
    const filename = item.getFilename()
    const record = {
      side, filename, url: item.getURL(), mime: item.getMimeType(),
      totalBytes: item.getTotalBytes(), savePath: path.join(outDir, 'downloads', side, filename),
      state: 'started', startedAt: Date.now()
    }
    item.setSavePath(record.savePath)
    downloads.push(record)
    item.once('done', (_e, state) => {
      record.state = state
      try { record.size = fs.statSync(record.savePath).size } catch { record.size = null }
    })
  })
}

function newWindow(partition) {
  const win = new BrowserWindow({
    show: true, width: 1440, height: 1000,
    webPreferences: { sandbox: true, partition, backgroundThrottling: false }
  })
  const trace = { partition, console: [], network: [], gone: [] }
  traces[partition] = trace
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] },
    (_d, cb) => cb({ cancel: true })
  )
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) trace.console.push({ level, message: String(message).slice(0, 500) })
  })
  win.webContents.on('render-process-gone', (_e, d) => trace.gone.push(d))
  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, (d) => {
    if (d.statusCode >= 400) trace.network.push({ url: d.url.slice(0, 120), status: d.statusCode })
  })
  return win
}

const js = (win, expression) => win.webContents.executeJavaScript(expression)
const shot = async (win, name) => {
  try { fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG()) } catch {}
}
async function waitFor(win, expression, budgetMs = 60000) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (await js(win, expression).catch(() => false)) return Date.now() - started
    await sleep(50)
  }
  return -1
}
const clickButton = (text) => `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('Button unavailable: '+${JSON.stringify(text)}); b.click(); })()`
const words = (win) => js(win, `[...document.querySelectorAll('.word')].map(w=>w.textContent)`)
const toastText = (win) => js(win, `(() => { const t=document.querySelector('.toast'); return t ? t.textContent.trim() : null })()`)
const isProjectJsonDownload = (record) => /\.speechedit\.json$/i.test(record.filename)

// The exact RYA-435 toolbar-Export gate (same predicate as the RYA-490 harness).
function toolbarExportGate({ sheetOpen, title, newDownloads, toast }) {
  const reasons = []
  if (!(sheetOpen && title === 'Export')) reasons.push('export sheet did not open')
  if ((newDownloads || []).some(isProjectJsonDownload)) reasons.push('downloaded a .speechedit.json project file')
  if (/Downloaded .*\.speechedit\.json/i.test(toast || '')) reasons.push('showed a false "Downloaded ... .speechedit.json" toast')
  return reasons
}

const readText = (record) => { try { return fs.readFileSync(record.savePath, 'utf8') } catch { return null } }
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  if (!ok) fail(`${name}: ${detail}`)
}
function assertWordsFile(record, { label, kind, mustInclude, mustNotInclude }) {
  const text = readText(record)
  check(`${label} written`, record.state === 'completed' && record.size > 0, JSON.stringify({ filename: record.filename, size: record.size, state: record.state }))
  check(`${label} is not the project document`, !isProjectJsonDownload(record) && !(text && text.trimStart().startsWith('{')), record.filename)
  if (kind === 'srt') {
    check(`${label} matches SRT shape`, Boolean(text && /^\d+\n\d{2}:\d{2}:\d{2},\d{3} --> /.test(text)), (text || '').slice(0, 60))
    check(`${label} excludes cue markup in text`, Boolean(text && !text.includes('WEBVTT')), '')
  } else if (kind === 'vtt') {
    check(`${label} starts with WEBVTT`, Boolean(text && text.startsWith('WEBVTT')), (text || '').slice(0, 20))
    check(`${label} contains -->`, Boolean(text && text.includes('-->')), '')
  } else if (kind === 'md') {
    check(`${label} has ### chapter headings`, Boolean(text && text.includes('###')), '')
  } else if (kind === 'chapters') {
    check(`${label} matches M:SS Title shape`, Boolean(text && /^\d+:\d{2} /m.test(text)), (text || '').slice(0, 60))
  } else if (kind === 'txt') {
    check(`${label} is plain words (no cue markup)`, Boolean(text && !text.includes('-->') && !text.includes('WEBVTT') && !text.includes('###')), (text || '').slice(0, 60))
  }
  for (const needle of mustInclude || []) check(`${label} contains ${JSON.stringify(needle)}`, Boolean(text && text.includes(needle)), (text || '').slice(0, 160))
  for (const needle of mustNotInclude || []) check(`${label} excludes ${JSON.stringify(needle)}`, Boolean(text && !text.includes(needle)), (text || '').slice(0, 160))
}

// Mock the browser Whisper worker with fixed cues (same as the campaign harnesses).
async function installMock(win) {
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      const NativeWorker = window.Worker;
      window.Worker = class extends EventTarget {
        constructor(u,o){ super(); if(!String(u).includes('browserWhisper.worker')) return new NativeWorker(u,o); }
        terminate(){ this.stopped = true; }
        emit(d){ setTimeout(()=>{ if(!this.stopped) this.onmessage?.({ data:d }); }, 10); }
        postMessage(m){ if(m.type==='load') this.emit({type:'ready',backend:'wasm'}); else this.emit({type:'result',id:m.id,cues:[
          {text:'Welcome to this recording.',start:0,end:2},
          {text:'Now a different chapter.',start:6,end:8}
        ]}); }
      };
    `
  })
}

// Host creates a reel with a synthetic 16 kHz mono WAV dropped on the transcript panel.
async function createRoom(win, tag) {
  await win.loadURL(url)
  if (!await waitFor(win, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='File')`, 30000).then(t => t >= 0)) throw Error('App did not load for host')
  await js(win, `(async () => {
    const wait = async p => { for (let i=0;i<400;i++){ if(p()) return true; await new Promise(r=>setTimeout(r,30)); } throw Error('UI did not settle'); };
    const button = t => [...document.querySelectorAll('button')].find(n=>n.textContent.trim()===t);
    await wait(()=>button('File')); button('File').click();
    await wait(()=>button('New reel')); button('New reel').click();
    await wait(()=>document.querySelector('.transcript-heading small')?.textContent.includes('0 words'));
    const samples=160000, bytes=new ArrayBuffer(44+samples*2), view=new DataView(bytes);
    const str=(o,t)=>[...t].forEach((c,i)=>view.setUint8(o+i,c.charCodeAt(0)));
    str(0,'RIFF'); view.setUint32(4,36+samples*2,true); str(8,'WAVE'); str(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    str(36,'data'); view.setUint32(40,samples*2,true);
    for(let i=0;i<samples;i++) view.setInt16(44+i*2, Math.sin(i*0.1)*2000, true);
    const transfer=new DataTransfer(); transfer.items.add(new File([bytes],${JSON.stringify(tag + '.wav')},{type:'audio/wav'}));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  })()`)
  if (!await waitFor(win, `document.querySelectorAll('.word').length === 8 && /8 words/.test(document.querySelector('.transcript-heading small')?.textContent||'')`, 90000).then(t => t >= 0)) throw Error('Fixture did not produce 8 real words')
  await js(win, clickButton('Share'))
  await js(win, `(() => { const s=document.querySelector('[aria-label="Share access"]'); s.value='edit'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await js(win, clickButton('Create editing link'))
  if (!await waitFor(win, `!!document.querySelector('.review-link-box input')`, 15000).then(t => t >= 0)) throw Error('Editing link was not created')
  const link = await js(win, `document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editing link: ' + link)
  return link
}

// Guest corrects a word via the Correct word chip (same flow as the QoL harness).
const field = (win, sel, value) => js(win, `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw Error('Field missing: '+${JSON.stringify(sel)}); const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`)
async function correctWord(win, index, text) {
  let done = false
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    await js(win, `document.querySelectorAll('.word')[${index}]?.click()`)
    if (await waitFor(win, `[...document.querySelectorAll('button.chip')].some(b=>b.textContent.trim()==='Correct word')`, 10000).then(t => t >= 0)) {
      await js(win, `([...document.querySelectorAll('button.chip')].find(b=>b.textContent.trim()==='Correct word')).click()`)
      if (await waitFor(win, `!!document.querySelector('.word-edit')`, 8000).then(t => t >= 0)) { done = true; break }
    }
    await sleep(800)
  }
  if (!done) throw Error('Correct-word flow failed after retries')
  await js(win, `document.querySelector('.word-edit').focus()`)
  await field(win, '.word-edit', text)
  await js(win, `(() => { const input=document.querySelector('.word-edit'); input.blur(); if (input.isConnected) input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); })()`)
  if (!await waitFor(win, `!document.querySelector('.word-edit') && document.querySelectorAll('.word')[${index}]?.textContent === ${JSON.stringify(text)}`, 15000).then(t => t >= 0)) throw Error('Word correction did not apply: ' + text)
}

// Collect downloads triggered by a click expression until they settle.
async function clickAndCollect(win, clickExpr, count, budgetMs = 25000) {
  const mark = downloads.length
  await js(win, clickExpr)
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    const fresh = downloads.slice(mark)
    if (fresh.length >= count && fresh.every((d) => d.state !== 'started')) return fresh
    await sleep(100)
  }
  return downloads.slice(mark)
}

app.whenReady().then(async () => {
  const host = newWindow('persist:rya493-host')
  const guest = newWindow('persist:rya493-guest')
  attachDownloadSink(host, 'host')
  attachDownloadSink(guest, 'guest')
  await installMock(host)
  await installMock(guest)

  // ---- Journey: host creates + shares, guest joins, edits, saves ----------
  const link = await createRoom(host, 'rya493')
  await js(host, clickButton('Close')).catch(() => {})
  await waitFor(host, `!document.querySelector('.share-sheet') && document.querySelectorAll('.word').length === 8`, 15000)
  step('hostCreatedRoom', { linkPrefix: link.slice(0, 60) })
  await shot(host, '01-host-room-ready.png')

  await guest.loadURL(link)
  if (!await waitFor(guest, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.shared-edit-bar')`, 40000).then(t => t >= 0)) throw Error('Guest editor did not load')
  await field(guest, '[aria-label="Editor name"]', 'Guest')
  step('guestJoined', {})
  await shot(guest, '02-guest-joined.png')

  await correctWord(guest, 2, 'TakeTwo')
  await js(guest, clickButton('Save now'))
  const savedWait = await waitFor(guest, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, 60000)
  step('guestSaved', { waitMs: savedWait })
  if (savedWait < 0) throw Error('Guest save did not report "All changes saved" within 60 s')
  await shot(guest, '03-guest-saved.png')

  const notified = await waitFor(host, `(() => { const t=document.querySelector('[aria-label="Collaborator updates"] [role="status"]')?.textContent||''; return /saved|update|change/i.test(t) && !/No new updates/i.test(t) })()`, 25000)
  if (notified < 0) throw Error('Host was not notified of the guest save within 25 s')
  await js(host, clickButton('Bring shared edits into this project'))
  const pulled = await waitFor(host, `document.querySelectorAll('.word')[2]?.textContent === 'TakeTwo'`, 20000)
  step('hostPulled', { waitMs: pulled })
  if (pulled < 0) throw Error('Host pull did not apply the guest edit')
  const hostWords = await words(host)
  check('host transcript contains the guest edit before export', hostWords[2] === 'TakeTwo', hostWords.join(' '))
  await shot(host, '04-host-pulled.png')

  // ---- Export leg (host): toolbar Export gate, live on the journey state --
  const markH1 = downloads.length
  await js(host, `document.querySelector('.export-btn').click()`)
  const sheetH = await waitFor(host, `!!document.querySelector('.export-sheet')`, 15000).then(t => t >= 0)
  await sleep(800)
  const h1New = downloads.slice(markH1)
  const titleH = await js(host, `document.querySelector('#export-title')?.textContent.trim() || null`)
  const toastH1 = await toastText(host)
  const gateLive = toolbarExportGate({ sheetOpen: sheetH, title: titleH, newDownloads: h1New, toast: toastH1 })
  results.exchanges.push({ surface: 'host toolbar Export (journey)', sheetOpen: sheetH, title: titleH, downloads: h1New.map((d) => d.filename), gate: gateLive })
  check('host toolbar Export opens the export sheet', sheetH && titleH === 'Export', JSON.stringify({ sheetH, titleH }))
  check('host toolbar Export emits no download at all', h1New.length === 0, JSON.stringify(h1New.map((d) => d.filename)))
  check('host toolbar Export passes the RYA-435 gate (live, journey state)', gateLive.length === 0, JSON.stringify(gateLive))
  await shot(host, '05-host-export-sheet.png')

  // ---- Export leg (host): Download the words -> five files ----------------
  const h2New = await clickAndCollect(host, `(() => { const b=[...document.querySelectorAll('.export-sheet .export-choice')].find(b=>b.querySelector('strong')?.textContent.trim()==='Download the words'); if(!b||b.disabled) throw Error('Download the words unavailable'); b.click(); })()`, 5)
  results.exchanges.push({ surface: 'host Download the words', downloads: h2New.map((d) => ({ side: d.side, filename: d.filename, size: d.size, state: d.state })) })
  const hostWordsFiles = h2New.filter((d) => d.state === 'completed')
  check('host Download the words writes five files', hostWordsFiles.length === 5, JSON.stringify(h2New.map((d) => d.filename)))
  check('host Download the words writes no project document', !h2New.some(isProjectJsonDownload), JSON.stringify(h2New.map((d) => d.filename)))
  const byExt = (ext) => hostWordsFiles.find((d) => d.filename.endsWith(ext))
  const srt = byExt('.srt'), vtt = byExt('.vtt'), md = byExt('.md'), txt = byExt('.txt'), chapters = byExt('.chapters.txt')
  // Note: a corrected word is exported with <b> emphasis markup in SRT/VTT, so
  // the literal pre-edit sentence is not expected once an edit was pulled.
  if (srt) assertWordsFile(srt, { label: 'host SRT', kind: 'srt', mustInclude: ['TakeTwo', 'Now a different chapter'] })
  if (vtt) assertWordsFile(vtt, { label: 'host VTT', kind: 'vtt', mustInclude: ['TakeTwo', 'Now a different chapter'] })
  if (md) assertWordsFile(md, { label: 'host MD', kind: 'md', mustInclude: ['TakeTwo', 'Now a different chapter'] })
  if (chapters) assertWordsFile(chapters, { label: 'host chapters', kind: 'chapters' })
  if (txt) assertWordsFile(txt, { label: 'host TXT', kind: 'txt', mustInclude: ['TakeTwo'], mustNotInclude: ['-->'] })
  check('host words export reflects the guest collaborator edit (TakeTwo)', [srt, vtt, md, txt].filter(Boolean).length === 4, 'missing: ' + JSON.stringify([!srt && 'srt', !vtt && 'vtt', !md && 'md', !txt && 'txt'].filter(Boolean)))
  const toastH2 = await toastText(host)
  check('host words export shows an honest toast (no project-file claim)', !/\.speechedit\.json/i.test(toastH2 || ''), String(toastH2))
  await shot(host, '06-host-words-downloaded.png')
  await js(host, clickButton('Close')).catch(() => {})

  // ---- Recipient side (guest): the guest's own Export surface -------------
  const guestHasToolbarExport = await js(guest, `(() => ({ exportBtn: !!document.querySelector('.export-btn'), fileMenu: [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='File') }))()`)
  results.exchanges.push({ surface: 'guest export surfaces', ...guestHasToolbarExport })
  if (!guestHasToolbarExport.exportBtn) {
    observation('GUEST-NO-EXPORT', `The guest editor at /edit/<room>#<key> exposes no toolbar Export (${JSON.stringify(guestHasToolbarExport)}); the guest's only download surface is checked next.`)
  } else {
    // The guest (recipient) presses Export on their own editor and downloads
    // the finished words themselves.
    const markG0 = downloads.length
    await js(guest, `document.querySelector('.export-btn').click()`)
    const sheetG = await waitFor(guest, `!!document.querySelector('.export-sheet')`, 15000).then(t => t >= 0)
    await sleep(800)
    const g0New = downloads.slice(markG0)
    const titleG = await js(guest, `document.querySelector('#export-title')?.textContent.trim() || null`)
    const toastG0 = await toastText(guest)
    const gateGuest = toolbarExportGate({ sheetOpen: sheetG, title: titleG, newDownloads: g0New, toast: toastG0 })
    results.exchanges.push({ surface: 'guest toolbar Export (recipient)', sheetOpen: sheetG, title: titleG, downloads: g0New.map((d) => d.filename), gate: gateGuest })
    check('guest toolbar Export opens the export sheet', sheetG && titleG === 'Export', JSON.stringify({ sheetG, titleG }))
    check('guest toolbar Export emits no download at all', g0New.length === 0, JSON.stringify(g0New.map((d) => d.filename)))
    check('guest toolbar Export passes the RYA-435 gate (recipient side)', gateGuest.length === 0, JSON.stringify(gateGuest))
    await shot(guest, '07-guest-export-sheet.png')

    const gSheetDiag = await js(guest, `(() => ({ sheet: !!document.querySelector('.export-sheet'), choices: [...document.querySelectorAll('.export-sheet .export-choice')].map(b=>b.querySelector('strong')?.textContent.trim()), primary: document.querySelector('.export-sheet .export-choice[data-primary="true"] strong')?.textContent.trim(), primaryDetail: document.querySelector('.export-sheet .export-choice[data-primary="true"] span')?.textContent.trim(), copy: document.querySelector('.export-sheet .confirm-copy')?.textContent.trim() }))()`)
    results.exchanges.push({ surface: 'guest sheet diagnostics', ...gSheetDiag })
    check('guest primary is Download the words', gSheetDiag.primary === 'Download the words', JSON.stringify(gSheetDiag))
    check('guest copy explains original recording render limit', gSheetDiag.copy.includes('not render without the original recording'), gSheetDiag.copy)
    const guestWordsChoice = 'Download the words'
    const gWords = await clickAndCollect(guest, `(() => { const b=[...document.querySelectorAll('.export-sheet .export-choice')].find(b=>b.querySelector('strong')?.textContent.trim()===${JSON.stringify(guestWordsChoice)}); if(!b||b.disabled) throw Error('Export choice unavailable: '+${JSON.stringify(guestWordsChoice)}); b.click(); })()`, 5)
    results.exchanges.push({ surface: 'guest ' + guestWordsChoice, downloads: gWords.map((d) => ({ side: d.side, filename: d.filename, size: d.size, state: d.state })) })
    const guestWordsFiles = gWords.filter((d) => d.state === 'completed')
    check(`guest ${guestWordsChoice} writes five files`, guestWordsFiles.length === 5, JSON.stringify(gWords.map((d) => d.filename)))
    check(`guest ${guestWordsChoice} writes no project document`, !gWords.some(isProjectJsonDownload), JSON.stringify(gWords.map((d) => d.filename)))
    const gByExt = (ext) => guestWordsFiles.find((d) => d.filename.endsWith(ext))
    const gSrt = gByExt('.srt'), gVtt = gByExt('.vtt'), gTxt = gByExt('.txt')
    if (gSrt) assertWordsFile(gSrt, { label: 'guest SRT', kind: 'srt', mustInclude: ['TakeTwo'] })
    if (gVtt) assertWordsFile(gVtt, { label: 'guest VTT', kind: 'vtt', mustInclude: ['TakeTwo'] })
    if (gTxt) assertWordsFile(gTxt, { label: 'guest TXT', kind: 'txt', mustInclude: ['TakeTwo'] })
    check('guest words export reflects the shared edit (TakeTwo)', [gSrt, gVtt, gTxt].filter(Boolean).length === 3, 'missing: ' + JSON.stringify([!gSrt && 'srt', !gVtt && 'vtt', !gTxt && 'txt'].filter(Boolean)))
    await shot(guest, '08-guest-words-downloaded.png')
    await js(guest, clickButton('Close')).catch(() => {})
  }
  const g1New = await clickAndCollect(guest, clickButton('Download edit copy'), 1)
  results.exchanges.push({ surface: 'guest Download edit copy', downloads: g1New.map((d) => ({ side: d.side, filename: d.filename, size: d.size, state: d.state })) })
  const guestDraft = g1New.find((d) => d.state === 'completed')
  check('guest Download edit copy writes a file', Boolean(guestDraft), JSON.stringify(g1New.map((d) => d.filename)))
  if (guestDraft) {
    check('guest edit copy is honestly named as a project document', isProjectJsonDownload(guestDraft), guestDraft.filename)
    const draftText = readText(guestDraft)
    let draftHasEdit = false
    try { draftHasEdit = JSON.stringify(JSON.parse(draftText)).includes('TakeTwo') } catch {}
    check('guest edit copy contains the guest edit (TakeTwo)', draftHasEdit, (draftText || '').slice(0, 120))
  }
  await shot(guest, '09-guest-download.png')

  // ---- Non-vacuous gate replay against a REAL project-document download ---
  const replayRecord = guestDraft || { filename: 'shared-edit-draft.speechedit.json' }
  const gateReplay = toolbarExportGate({ sheetOpen: false, title: null, newDownloads: [replayRecord], toast: `Downloaded ${replayRecord.filename}` })
  results.exchanges.push({ surface: 'gate replay vs real project download', record: replayRecord.filename, reasons: gateReplay })
  check('regression replay: the gate rejects a real project-document export', gateReplay.length === 3, JSON.stringify(gateReplay))
  check('detector self-test: accepts a words download', !isProjectJsonDownload({ filename: 'rya493.srt' }), '')

  results.checks = checks
  results.completed = true
  finish(failures.length === 0 ? 0 : 2)
}).catch((error) => { console.error(error); results.error = String(error && error.stack || error); finish(1) })
