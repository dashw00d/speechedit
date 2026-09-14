/*
 * RYA-354 / SPE-BUG2a-REG: durable two-context browser confirmation.
 *
 * Defect RYA-352: two people edit the same passage through the full editor.
 * One cuts words; the other re-records the same span against a stale base.
 * `mergeSharedProjects` combines both with no conflict; the replacement clip
 * (fixed to its pre-merge slot) then bleeds past the now-shorter passage and
 * force-mutes the next sentence's original voice.
 *
 * Two independent Electron contexts — the reel owner (opening their own full
 * editing link) and a guest — exercise exactly that overlap. The harness fails
 * on a "silent All changes saved with an over-long replacement clip": no
 * conflict surfaced AND replacement voice covering program time outside the
 * retained passage.
 *
 * Baseline candidate: origin/main @ e9b6590 (deployment-approximate).
 * Preparation only: this harness never touches product source.
 *
 * Usage:
 *   QA354_OUT=/dir electron scripts/qa354-concurrent-cut-rerecord.cjs \
 *     http://127.0.0.1:3366 --no-sandbox
 *
 * Exit codes: 0 = safe (conflict surfaced or replacement re-validated),
 *             2 = silent over-long merge, 1 = harness error / timeout.
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const outDir = process.env.QA354_OUT || join(tmpdir(), 'speechedit-qa354')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'speechedit-qa354-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3366'
const RUN_MS = Number(process.env.QA354_RUN_MS || 360000)
const WAIT_MS = Number(process.env.QA354_WAIT_MS || 60000)
const timer = setTimeout(() => { console.error('QA354 timed out'); finish(1) }, RUN_MS)

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
  try { writeFileSync(join(outDir, 'qa354-trace.json'), JSON.stringify(payload, null, 2)) } catch (e) { console.error('trace write failed', e) }
  console.log('QA354_RESULTS ' + JSON.stringify({ pass: results.pass, failures, results }))
  app.exit(code)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(win, expression, budgetMs = WAIT_MS) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (await win.webContents.executeJavaScript(expression).catch(() => false)) return true
    await sleep(50)
  }
  return false
}
const js = (win, expression) => win.webContents.executeJavaScript(expression)
const shot = async (win, name) => { try { writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG()) } catch {} }
const click = (win, text) => js(win, `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('Button unavailable: '+${JSON.stringify(text)}); b.click(); })()`)
const clickMatch = (win, re) => js(win, `(() => { const b=[...document.querySelectorAll('button')].find(b=>${re}.test(b.textContent)); if(!b||b.disabled) throw Error('Button unavailable: '+${JSON.stringify(re)}); b.click(); })()`)
const words = win => js(win, `[...document.querySelectorAll('.word')].map(w=>w.textContent)`)
const status = win => js(win, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').trim()`)
const conflictText = win => js(win, `document.querySelector('.shared-edit-bar .shared-conflict')?.innerText || document.querySelector('.shared-conflict')?.innerText || ''`)
const waitSettled = (win, budget = 30000) => waitFor(win, `(() => { const t=document.querySelector('.shared-edit-bar [role="status"]')?.textContent||''; return t.includes('All changes saved') || t.includes('Resolve simultaneous edits') || !!document.querySelector('.shared-conflict') })()`, budget)
async function field(win, sel, value) {
  await js(win, `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw Error('Field missing: '+${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`)
}
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
        {text:'Now a different chapter.',start:2,end:4}
      ]}); }
    };
  ` })
}
const linkParts = link => { const u = new URL(link); return { id: u.pathname.split('/')[2], key: u.hash.slice(1), origin: u.origin } }
const roomState = (win, link) => { const { id, key } = linkParts(link); return js(win, `fetch('/api/reviews/${id}',{headers:{Authorization:'Bearer ${key}'}}).then(r=>r.status===200?r.json():{httpStatus:r.status})`) }

// Program-time mapping for cuts only (matches the fixture; no speed/inserts).
function programOf(project, src) {
  let removed = 0
  for (const c of project.cuts || []) {
    if (c.end <= src) removed += c.end - c.start
    else if (c.start < src) removed += src - c.start
  }
  return src - removed
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
    const transfer=new DataTransfer(); transfer.items.add(new File([bytes],'qa354.wav',{type:'audio/wav'}));
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
  await shot(owner, '01-owner-share-link.png')

  // Owner joins their own edit link as the first editor.
  await owner.loadURL(link)
  if (!await waitFor(owner, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 30000)) throw Error('Owner editor did not load')
  await field(owner, '[aria-label="Editor name"]', 'Owner')

  // --- guest joins the same room ------------------------------------------
  const guest = windowFor('guest')
  await guest.loadURL(link)
  if (!await waitFor(guest, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 30000)) throw Error('Guest editor did not load')
  await field(guest, '[aria-label="Editor name"]', 'Guest')
  results.baselineWords = await words(guest)
  await shot(owner, '02-both-joined.png')

  // --- owner cuts words 1-2 while the guest's poll is paused --------------
  // Pause only the guest's poll of the exact room so its base stays pre-cut.
  let blockGuestGet = true
  guest.webContents.session.webRequest.onBeforeRequest({ urls: [`${origin}/api/reviews/${id}`] }, (_d, cb) => cb({ cancel: blockGuestGet }))

  owner.focus()
  await js(owner, `document.querySelectorAll('.word')[1].click()`)
  await js(owner, `document.querySelectorAll('.word')[2].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`)
  await waitFor(owner, `[...document.querySelectorAll('button')].some(b=>/Remove/.test(b.textContent))`)
  await clickMatch(owner, '/Remove/')
  await sleep(300)
  await click(owner, 'Save now')
  await waitFor(owner, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, 60000)
  results.ownerWordsAfterCut = await words(owner)
  await shot(owner, '03-owner-cut.png')

  // --- guest re-records words 0-3 against its stale (pre-cut) base --------
  guest.focus()
  await js(guest, `document.querySelectorAll('.word')[0].click()`)
  await js(guest, `document.querySelectorAll('.word')[3].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`)
  if (!await waitFor(guest, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Re-record audio')`, 15000)) throw Error('Re-record control did not appear')
  await click(guest, 'Re-record audio')
  if (!await waitFor(guest, `!!document.querySelector('.record-sheet')`, 15000)) throw Error('Record sheet did not open')
  results.guestSlot = await js(guest, `document.querySelector('.record-sheet p strong')?.textContent || ''`)
  await click(guest, 'Start recording')
  if (!await waitFor(guest, `!!document.querySelector('.record-sheet audio')`, 40000)) throw Error('Recording did not complete')
  await waitFor(guest, `document.querySelector('.record-sheet audio').readyState >= 1`, 20000)
  results.guestTakeDuration = await js(guest, `document.querySelector('.record-sheet audio').duration`)
  // Unblock the poll, then save: the save GETs the owner's cut and merges it
  // with the guest's pre-cut replacement clip.
  blockGuestGet = false
  await sleep(500)
  await click(guest, 'Use recording')
  if (!await waitFor(guest, `!document.querySelector('.record-sheet')`, 15000)) throw Error('Record sheet did not close')
  await click(guest, 'Save now')
  await waitSettled(guest, 60000)
  await sleep(1500)
  results.guestConflictBanner = !!(await conflictText(guest))
  results.guestConflictText = await conflictText(guest)
  results.guestStatusText = await status(guest)
  await shot(guest, '04-guest-after-merge.png')

  // --- persisted server state and the over-long-clip check ----------------
  const room = await roomState(guest, link)
  if (!room || !room.project) throw Error('Could not read merged room state: ' + JSON.stringify(room).slice(0, 300))
  const project = room.project
  const w = project.transcript.words
  const vclips = (project.tracks.find(t => t.id === 'voice_replacements')?.clips || []).filter(c => c.replaceVoice)
  const retainedStart = programOf(project, w[0].start)
  const retainedEnd = programOf(project, w[3].end)
  const coverage = vclips.map(c => ({ start: c.start, end: c.start + c.duration }))
  const coversOutside = coverage.some(c => c.start < retainedStart - 0.02 || c.end > retainedEnd + 0.02)
  const nextStart = programOf(project, w[4].start)
  results.serverVoiceClips = coverage
  results.serverDeleted = w.map(x => x.deleted)
  results.serverCutSpans = (project.cuts || []).map(c => ({ start: c.start, end: c.end }))
  results.retainedPassage = { start: retainedStart, end: retainedEnd }
  results.nextSentenceProgramStart = nextStart
  results.replacementBleedPastPassage = coverage.length ? Number((Math.max(...coverage.map(c => c.end)) - retainedEnd).toFixed(4)) : 0
  results.coversOutsidePassage = coversOutside
  results.cutInsideReplacement = coverage.some(c => (project.cuts || []).some(cut => cut.start < c.end && cut.end > c.start))
  results.silentAllChangesSaved = /All changes saved/.test(results.guestStatusText || '') && coversOutside && !results.guestConflictBanner
  step('concurrentMerge', {
    conflictBanner: results.guestConflictBanner, status: results.guestStatusText,
    voiceClips: results.serverVoiceClips, retainedPassage: results.retainedPassage,
    coversOutsidePassage: coversOutside, cutInsideReplacement: results.cutInsideReplacement
  })
  await shot(guest, '05-server-state.png')

  // Owner observes the merge too.
  owner.focus()
  await waitFor(owner, `document.querySelectorAll('.word')[1]?.closest('.word')!==null`, 10000).catch(() => {})
  results.ownerObservedDeleted = await js(owner, `JSON.parse(localStorage.getItem('speechedit:project')||'{}').transcript?.words?.map?.(w=>w.deleted) || null`)

  results.completed = true
  // Acceptance: the overlap must be surfaced (conflict) OR the replacement
  // re-validated so merged voice covers no program time outside the passage.
  if (!results.guestConflictBanner && coversOutside) {
    fail('overlapping cut + re-record merged silently: "All changes saved" with the replacement voice covering program time outside the retained passage' +
      (results.guestConflictBanner ? '' : ' (no conflict surfaced)'))
  }
  finish(failures.length ? 2 : 0)
}).catch(error => { console.error(error); results.error = String(error); finish(1) })
