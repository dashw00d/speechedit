/*
 * RYA-365 / SPE-BUG2b-REG: durable two-context browser confirmation.
 *
 * Defect RYA-363: two collaborators each add their FIRST `voice_replacements`
 * clip from a base that lacks the track, on different non-overlapping passages.
 * The second saver gets a conflict, and choosing "Keep my conflicting edits"
 * silently deletes the first collaborator's recording from the shared project
 * and from that collaborator's own screen on the next poll.
 *
 * Two independent Electron contexts — the reel owner (first recorder) and a
 * guest (second recorder) — exercise exactly that sequence over one full editing
 * room. The harness fails when the first recorder's clip is dropped from the
 * server project or from the first recorder's screen after the second recorder
 * keeps their conflicting edits.
 *
 * Baseline candidate: origin/main @ e9b6590 (deployment-approximate).
 * Preparation only: this harness never touches product source.
 *
 * Usage:
 *   QA365_OUT=/dir electron scripts/qa365-two-records-loss.cjs \
 *     http://127.0.0.1:3367 --no-sandbox
 *
 * Exit codes: 0 = both recordings survive, 2 = a recording was dropped,
 *             1 = harness error / timeout.
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const outDir = process.env.QA365_OUT || join(tmpdir(), 'speechedit-qa365')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'speechedit-qa365-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3367'
const RUN_MS = Number(process.env.QA365_RUN_MS || 360000)
const WAIT_MS = Number(process.env.QA365_WAIT_MS || 60000)
const timer = setTimeout(() => { console.error('QA365 timed out'); finish(1) }, RUN_MS)

const traces = {}
const results = { steps: [] }
const failures = []
let finished = false
function step(name, value) { results.steps.push({ name, ...(value === undefined ? {} : { value }), at: Date.now() }) }
function fail(msg) { failures.push(msg); console.error('FAIL: ' + msg) }
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  results.pass = failures.length === 0 && results.completed === true
  const payload = { url, results, traces, failures, finishedAt: new Date().toISOString() }
  try { writeFileSync(join(outDir, 'qa365-trace.json'), JSON.stringify(payload, null, 2)) } catch (e) { console.error('trace write failed', e) }
  console.log('QA365_RESULTS ' + JSON.stringify({ pass: results.pass, failures, results }))
  app.exit(code)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const js = (win, expression) => win.webContents.executeJavaScript(expression)
const shot = async (win, name) => { try { writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG()) } catch {} }
async function waitFor(win, expression, budgetMs = WAIT_MS) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (await js(win, expression).catch(() => false)) return true
    await sleep(50)
  }
  return false
}
const click = (win, text) => js(win, `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('Button unavailable: '+${JSON.stringify(text)}); b.click(); })()`)
const field = (win, sel, value) => js(win, `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw Error('Field missing: '+${JSON.stringify(sel)}); const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`)
const status = win => js(win, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').trim()`)
const conflictText = win => js(win, `document.querySelector('.shared-conflict')?.innerText || ''`)
const waitSettled = (win, budget = 30000) => waitFor(win, `(() => { const t=document.querySelector('.shared-edit-bar [role="status"]')?.textContent||''; return t.includes('All changes saved') || t.includes('Resolve simultaneous edits') || !!document.querySelector('.shared-conflict') })()`, budget)

function windowFor(partition) {
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  const trace = { partition, console: [], network: [], gone: [] }
  traces[partition] = trace
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) trace.console.push({ level, message: String(message).slice(0, 500) }) })
  win.webContents.on('render-process-gone', (_e, d) => trace.gone.push(d))
  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, d => { if (d.statusCode >= 400) trace.network.push({ url: d.url, status: d.statusCode, method: d.method }) })
  return win
}
const installMock = async win => {
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
    const NativeWorker = window.Worker;
    window.Worker = class extends EventTarget {
      constructor(u,o){ super(); if(!String(u).includes('browserWhisper.worker')) return new NativeWorker(u,o); }
      terminate(){ this.stopped = true; }
      emit(d){ setTimeout(()=>{ if(!this.stopped) this.onmessage?.({ data:d }); }, 10); }
      postMessage(m){ if(m.type==='load') this.emit({type:'ready',backend:'wasm'}); else this.emit({type:'result',id:m.id,cues:[
        {text:'Welcome to this recording.',start:0,end:2},
        {text:'Now a different chapter.',start:4,end:6}
      ]}); }
    };
  ` })
}
const linkParts = link => { const u = new URL(link); return { id: u.pathname.split('/')[2], key: u.hash.slice(1), origin: u.origin } }
const clipsOf = p => (p?.tracks?.find(t => t.id === 'voice_replacements')?.clips || []).filter(c => c.replaceVoice).map(c => ({ assetId: c.assetId, start: c.start, duration: c.duration }))
const sharedDraft = async (win, roomId) => {
  const d = await js(win, `new Promise(ok => { const r=indexedDB.open('speechedit-collaboration',1); r.onsuccess=()=>{ const db=r.result; const g=db.transaction('state').objectStore('state').get(${JSON.stringify('draft:' + roomId)}); g.onsuccess=()=>ok(g.result||null); g.onerror=()=>ok(null) }; r.onerror=()=>ok(null) })`)
  return d?.project || null
}
async function record(win, firstIndex, lastIndex, label) {
  win.focus()
  await js(win, `document.querySelectorAll('.word')[${firstIndex}].click()`)
  await js(win, `document.querySelectorAll('.word')[${lastIndex}].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`)
  if (!await waitFor(win, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Re-record audio')`, 15000)) throw Error('Re-record control did not appear for ' + label)
  await click(win, 'Re-record audio')
  if (!await waitFor(win, `!!document.querySelector('.record-sheet')`, 15000)) throw Error('Record sheet did not open for ' + label)
  const slot = await js(win, `document.querySelector('.record-sheet p strong')?.textContent || ''`)
  await click(win, 'Start recording')
  if (!await waitFor(win, `!!document.querySelector('.record-sheet audio')`, 40000)) throw Error('Recording did not complete for ' + label)
  await waitFor(win, `document.querySelector('.record-sheet audio').readyState >= 1`, 20000)
  await click(win, 'Use recording')
  if (!await waitFor(win, `!document.querySelector('.record-sheet')`, 15000)) throw Error('Record sheet did not close for ' + label)
  step(label, { slot })
  return slot
}

app.whenReady().then(async () => {
  // --- reel owner creates the reel and a full editing link -----------------
  const owner = windowFor('owner')
  await installMock(owner)
  await owner.loadURL(url)
  await js(owner, `(async () => {
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
    const transfer=new DataTransfer(); transfer.items.add(new File([bytes],'qa365.wav',{type:'audio/wav'}));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  })()`)
  if (!await waitFor(owner, `document.querySelectorAll('.word').length === 8`, 90000)) throw Error('Owner fixture did not produce 8 words')
  await click(owner, 'Share')
  await js(owner, `(() => { const s=document.querySelector('[aria-label="Share access"]'); s.value='edit'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await click(owner, 'Create editing link')
  if (!await waitFor(owner, `!!document.querySelector('.review-link-box input')`, 15000)) throw Error('Editing link was not created')
  const link = await js(owner, `document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editing link: ' + link)
  const { id, key, origin } = linkParts(link)
  results.editLink = link.replace(/[?#].*$/, '/edit/<room>#<key>')

  // The owner is the FIRST recorder: join their own full editing link.
  await owner.loadURL(link)
  if (!await waitFor(owner, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 30000)) throw Error('Owner editor did not load')
  await field(owner, '[aria-label="Editor name"]', 'Owner A')

  // --- guest joins the same room (SECOND recorder) ------------------------
  const guest = windowFor('guest')
  await guest.loadURL(link)
  if (!await waitFor(guest, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 30000)) throw Error('Guest editor did not load')
  await field(guest, '[aria-label="Editor name"]', 'Guest B')
  results.baselineWords = await js(guest, `[...document.querySelectorAll('.word')].map(w=>w.textContent)`)
  await shot(owner, '01-both-joined.png')

  // Freeze the guest's poll of the exact room so its base stays free of the
  // voice_replacements track while the owner records and saves first.
  let blockGuestGet = true
  guest.webContents.session.webRequest.onBeforeRequest({ urls: [`${origin}/api/reviews/${id}`] }, (_d, cb) => cb({ cancel: blockGuestGet }))

  // --- owner (A) records words 0-3 and saves ------------------------------
  await record(owner, 0, 3, 'recordA')
  await click(owner, 'Save now')
  if (!await waitFor(owner, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, 60000)) throw Error('Owner save did not settle')
  const roomA = await js(owner, `fetch('/api/reviews/${id}', { headers: { Authorization: 'Bearer ${key}' } }).then(r=>r.ok?r.json():{httpStatus:r.status})`)
  results.clipsAfterA = clipsOf(roomA.project)
  results.ownerConflictAfterA = false
  await shot(owner, '02-owner-recorded.png')

  // --- guest (B) records words 4-7 against its stale (pre-voice) base ------
  await record(guest, 4, 7, 'recordB')
  const bDraft = await sharedDraft(guest, id)
  results.bLocalClipBeforeSave = clipsOf(bDraft)[0]?.assetId || null
  blockGuestGet = false
  await sleep(500)
  await click(guest, 'Save now')
  if (!await waitFor(guest, `!!document.querySelector('.shared-conflict')`, 30000)) throw Error('Guest did not get the expected stale-sync conflict')
  results.guestConflictBanner = true
  results.guestConflictText = (await conflictText(guest)).slice(0, 400)
  await shot(guest, '03-guest-conflict.png')

  // --- guest keeps its conflicting edits ----------------------------------
  await click(guest, 'Keep my conflicting edits')
  if (!await waitFor(guest, `!document.querySelector('.shared-conflict')`, 60000)) throw Error('Guest conflict did not resolve')
  await sleep(1500)
  await shot(guest, '04-guest-resolved.png')

  const roomAfterResolve = await js(guest, `fetch('/api/reviews/${id}', { headers: { Authorization: 'Bearer ${key}' } }).then(r=>r.ok?r.json():{httpStatus:r.status})`)
  results.serverClipsAfterResolve = clipsOf(roomAfterResolve.project)

  // --- owner polls the server and settles ---------------------------------
  await waitFor(owner, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, 20000).catch(() => {})
  await sleep(4000)
  const ownerDraft = await sharedDraft(owner, id)
  results.ownerLocalClipsAfterSettle = clipsOf(ownerDraft)
  await shot(owner, '05-owner-after-settle.png')

  const aId = results.clipsAfterA?.[0]?.assetId || null
  const bId = results.bLocalClipBeforeSave
  const serverIds = new Set((results.serverClipsAfterResolve || []).map(c => c.assetId))
  const ownerIds = new Set((results.ownerLocalClipsAfterSettle || []).map(c => c.assetId))
  results.aRecordingId = aId
  results.bRecordingId = bId
  results.serverKeepsA = aId ? serverIds.has(aId) : null
  results.serverKeepsB = bId ? serverIds.has(bId) : null
  results.ownerKeepsA = aId ? ownerIds.has(aId) : null
  step('outcome', {
    clipsAfterA: results.clipsAfterA,
    bLocalClipBeforeSave: bId,
    serverClipsAfterResolve: results.serverClipsAfterResolve,
    ownerLocalClipsAfterSettle: results.ownerLocalClipsAfterSettle,
    serverKeepsA: results.serverKeepsA, serverKeepsB: results.serverKeepsB, ownerKeepsA: results.ownerKeepsA
  })

  results.completed = true
  if (!results.guestConflictBanner) fail('guest B did not get the expected stale-sync conflict banner')
  if (results.serverKeepsA === false) fail("owner A's recording was dropped from the server project after B chose 'Keep my conflicting edits'")
  if (results.serverKeepsB === false) fail("guest B's recording is missing from the server project after resolving the conflict")
  if (results.ownerKeepsA === false) fail("owner A's own screen lost A's recording after B chose 'Keep my conflicting edits'")
  if (!results.serverKeepsA || !results.serverKeepsB || !results.ownerKeepsA) {
    fail(`recordings not both retained: serverKeepsA=${results.serverKeepsA} serverKeepsB=${results.serverKeepsB} ownerKeepsA=${results.ownerKeepsA}`)
  }
  finish(failures.length ? 2 : 0)
}).catch(error => { console.error(error); results.error = String(error); finish(1) })
