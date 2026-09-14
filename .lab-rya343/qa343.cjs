/*
 * RYA-332 focused scenario 2: merge granularity + revoke terminal state.
 *
 *   A. simultaneous edits to DIFFERENT caption cues -> clean merge expected
 *   B. stale peer edits a DIFFERENT word in the SAME cue -> conflict? minimal loss?
 *   C. revoke while idle -> terminal state visible, 404s counted
 *
 * QA artifact, isolated lab only.
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const tmpdir = () => process.env.PAPERCLIP_RUN_SCRATCH_DIR || process.env.PAPERCLIP_SCRATCH_DIR || require('node:os').tmpdir()

const outDir = process.env.QA332_OUT || join(tmpdir(), 'speechedit-qa332b')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'speechedit-qa332b-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:3361'
const origin = new URL(url).origin
const RUN_MS = Number(process.env.QA332_RUN_MS || 300000)
const WAIT_MS = Number(process.env.QA332_WAIT_MS || 60000)
const timer = setTimeout(() => { console.error('QA332b timed out'); finish(1) }, RUN_MS)
const traces = {}
const results = { scenarios: {} }
let finished = false
function finish(code) {
  if (finished) return
  finished = true; clearTimeout(timer)
  try { writeFileSync(join(outDir, 'qa332b-trace.json'), JSON.stringify({ url, results, traces, finishedAt: new Date().toISOString() }, null, 2)) } catch (e) { console.error(e) }
  console.log('QA332B_RESULTS ' + JSON.stringify(results))
  app.exit(code)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(win, expression, budgetMs = WAIT_MS) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) { if (await win.webContents.executeJavaScript(expression)) return; await sleep(50) }
  throw Error(`Timed out waiting for ${expression}`)
}
const click = (win, text) => win.webContents.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('Button unavailable: '+${JSON.stringify(text)}); b.click(); })()`)
async function field(win, sel, value) { await win.webContents.executeJavaScript(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`) }
function windowFor(partition) {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  const trace = { partition, console: [], network: [], gone: [], failed: [] }
  win.webContents.session.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, d => trace.failed.push({url:d.url,error:d.error}))
  traces[partition] = trace
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => trace.console.push({ level, message: String(message).slice(0, 600) }))
  win.webContents.on('render-process-gone', (_e, d) => trace.gone.push(d))
  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, d => { if (d.statusCode >= 400) trace.network.push({ url: d.url, status: d.statusCode, method: d.method }) })
  return win
}
const word = (win, i) => win.webContents.executeJavaScript(`document.querySelectorAll('.word')[${i}]?.textContent`)
const status = (win) => win.webContents.executeJavaScript(`document.querySelector('.shared-edit-bar [role="status"]')?.textContent.trim()||''`)
const conflictText = (win) => win.webContents.executeJavaScript(`document.querySelector('.shared-edit-bar .shared-conflict')?.innerText||''`)
const errorLine = (win) => win.webContents.executeJavaScript(`document.querySelector('.shared-edit-bar [role="alert"]:not(.shared-conflict)')?.textContent.trim()||''`)
const waitSaved = (win, budget = 20000) => waitFor(win, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, budget)
async function correctWord(win, index, text) {
  win.focus()
  await win.webContents.executeJavaScript(`document.querySelectorAll('.word')[${index}].click()`)
  await waitFor(win, `[...document.querySelectorAll('button')].some(b=>/Correct word/.test(b.textContent))`)
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('button')].find(b=>/Correct word/.test(b.textContent))).click()`)
  await waitFor(win, `!!document.querySelector('.word-edit')`)
  await win.webContents.executeJavaScript(`document.querySelector('.word-edit').focus()`)
  await field(win, '.word-edit', text)
  await win.webContents.executeJavaScript(`(() => { const i=document.querySelector('.word-edit'); i.blur(); if(i.isConnected) i.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); })()`)
  await waitFor(win, `!document.querySelector('.word-edit') && document.querySelectorAll('.word')[${index}]?.textContent===${JSON.stringify(text)}`)
}
function linkParts(link) { const u = new URL(link); return { id: u.pathname.split('/')[2], key: u.hash.slice(1) } }
const roomState = (win, link) => { const { id, key } = linkParts(link); return win.webContents.executeJavaScript(`fetch('/api/reviews/${id}',{headers:{Authorization:'Bearer ${key}'}}).then(r=>r.status===200?r.json():{httpStatus:r.status})`) }

app.whenReady().then(async () => {
  const owner = windowFor('owner')
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
        if (message.type === 'load') { this.emit({ type: 'ready', backend: 'wasm', fallbackReason: undefined }); }
        else { this.emit({ type: 'result', id: message.id, cues: [ { text: 'Welcome to this recording.', start: 0, end: 2 }, { text: 'Now a different chapter.', start: 6, end: 8 } ] }); }
      }
    };
  ` })
  await owner.loadURL(url)
  await owner.webContents.executeJavaScript(`(async () => {
    const wait = async p => { for (let i=0;i<300;i++){ if(p()) return; await new Promise(r=>setTimeout(r,30)); } throw Error('UI did not settle'); };
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
    for(let i=0;i<samples;i++) view.setInt16(44+i*2,Math.sin(i*0.1)*2000,true);
    const transfer=new DataTransfer(); transfer.items.add(new File([bytes],'transcription-test.wav',{type:'audio/wav'}));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  })()`)
  await waitFor(owner, `document.querySelector('.transcript-heading small')?.textContent.includes('2 chapters')`)
  await click(owner, 'Share')
  await owner.webContents.executeJavaScript(`(() => { const s=document.querySelector('[aria-label="Share access"]'); s.value='edit'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await click(owner, 'Create editing link')
  await waitFor(owner, `!!document.querySelector('.review-link-box input')`)
  const link = await owner.webContents.executeJavaScript(`document.querySelector('.review-link-box input').value`)
  results.editLink = link.replace(/[?#].*$/, '/edit/<room>#<key>')

  // Structure evidence: word list vs caption clips on the server.
  const room0 = await roomState(owner, link)
  results.structure = {
    words: room0?.project?.transcript?.words?.map(w => ({ id: w.id, text: w.text })) ?? null,
    clips: room0?.project?.tracks?.flatMap((t, ti) => (t.clips || []).map(c => ({ track: ti, kind: t.kind, id: c.id, text: c.text, wordIds: c.wordIds || c.words || null }))) ?? null
  }

  const guest = windowFor('guest'); await guest.loadURL(link)
  await waitFor(guest, `document.querySelectorAll('.word').length===8`); await field(guest, '[aria-label="Editor name"]', 'Guest A')
  const peer = windowFor('peer'); await peer.loadURL(link)
  await waitFor(peer, `document.querySelectorAll('.word').length===8`); await field(peer, '[aria-label="Editor name"]', 'Guest B')

  // ---- A: different cues, simultaneous ----
  try {
    const s = results.scenarios.A = {}
    await correctWord(guest, 0, 'Cue1x')
    await correctWord(peer, 4, 'Cue2x')
    await Promise.all([click(guest, 'Save now'), click(peer, 'Save now')])
    await sleep(9000)
    s.guestWords = [await word(guest, 0), await word(guest, 4)]
    s.peerWords = [await word(peer, 0), await word(peer, 4)]
    s.guestStatus = await status(guest); s.peerStatus = await status(peer)
    s.guestConflict = await conflictText(guest); s.peerConflict = await conflictText(peer)
    const room = await roomState(guest, link)
    s.serverWords = [room?.project?.transcript?.words?.[0]?.text ?? null, room?.project?.transcript?.words?.[4]?.text ?? null]
    s.mergedBothSides = s.guestWords[0] === 'Cue1x' && s.guestWords[1] === 'Cue2x' && s.peerWords[0] === 'Cue1x' && s.peerWords[1] === 'Cue2x'
    s.ok = s.mergedBothSides
  } catch (e) { results.scenarios.A = { error: String(e), stack: e.stack } }

  // ---- B: stale peer edits a different word in the SAME cue (cue 2 = words 4-7) ----
  try {
    const s = results.scenarios.B = {}
    await waitSaved(guest, 25000)
    let peerOffline = true
    peer.webContents.session.webRequest.onBeforeRequest({ urls: [origin + '/api/reviews/*'] }, (_d, cb) => cb({ cancel: peerOffline }))
    await sleep(5000) // peer's base freezes
    await correctWord(guest, 6, 'SameCueA'); await click(guest, 'Save now'); await waitSaved(guest)
    s.guestSaved = await word(guest, 6)
    await correctWord(peer, 7, 'SameCueB') // peer edits different word in same cue, on a stale base
    peerOffline = false
    await sleep(8000)
    s.peerStatus = await status(peer)
    s.peerConflict = await conflictText(peer)
    s.peerWord6 = await word(peer, 6); s.peerWord7 = await word(peer, 7)
    s.guestWord6 = await word(guest, 6); s.guestWord7 = await word(guest, 7)
    const room = await roomState(peer, link)
    s.serverWord6 = room?.project?.transcript?.words?.[6]?.text ?? null
    s.serverWord7 = room?.project?.transcript?.words?.[7]?.text ?? null
    s.conflictRaised = /Another editor changed/.test(s.peerConflict || '')
    // Resolve via Keep mine and confirm both words survive.
    if (s.conflictRaised) {
      await click(peer, 'Keep my conflicting edits')
      await sleep(3000)
      await waitSaved(peer, 20000).catch(() => {})
      const resolved = await roomState(peer, link)
      s.resolvedWord6 = resolved?.project?.transcript?.words?.[6]?.text ?? null
      s.resolvedWord7 = resolved?.project?.transcript?.words?.[7]?.text ?? null
      s.resolvePreservedBoth = s.resolvedWord6 === 'SameCueA' && s.resolvedWord7 === 'SameCueB'
    }
    s.ok = !s.conflictRaised && s.peerStatus.includes('All changes saved') && s.serverWord6 === 'SameCueA' && s.serverWord7 === 'SameCueB' && s.peerWord6 === 'SameCueA' && s.peerWord7 === 'SameCueB' && s.guestWord6 === 'SameCueA' && s.guestWord7 === 'SameCueB'
    await require('node:fs/promises').writeFile(join(outDir, 'same-caption-peer.png'), (await peer.webContents.capturePage()).toPNG())
  } catch (e) { results.scenarios.B = Object.assign(results.scenarios.B || {}, { error: String(e), stack: e.stack }) }

  finish(results.scenarios.A?.ok && results.scenarios.B?.ok ? 0 : 2)
}).catch(error => { console.error(error); results.fatal = String(error); finish(1) })
