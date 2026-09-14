/*
 * RYA-351 / SPE-BUG1-REG: durable two-context co-op regression harness.
 *
 * Covers the two SpeechEdit collaboration defects prepared for Astra's queue:
 *   RYA-342  after a peer merge that changes projectRevision, the receiving
 *            editor's Undo must stay enabled and reverse their own last edit.
 *   RYA-343  two clients editing different words in the SAME caption cue must
 *            merge (cleanly or at word level) with both words persisted and no
 *            stuck "Resolve simultaneous edits" state.
 *
 * Baseline candidate: origin/main @ e9b6590 (deployment-approximate).
 * This harness is preparation only: it never touches product source.
 *
 * Usage:
 *   QA351_OUT=/dir electron scripts/qa351-coop-merge-regression.cjs \
 *     http://127.0.0.1:3365 --no-sandbox
 *
 * Exit codes: 0 = every check passed, 2 = an acceptance check failed,
 *             1 = harness error / timeout.
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const outDir = process.env.QA351_OUT || join(tmpdir(), 'speechedit-qa351')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'speechedit-qa351-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find(arg => /^https?:\/\//.test(arg)) || 'http://127.0.0.1:3365'
const origin = new URL(url).origin
const RUN_MS = Number(process.env.QA351_RUN_MS || 360000)
const WAIT_MS = Number(process.env.QA351_WAIT_MS || 60000)
const timer = setTimeout(() => { console.error('QA351 timed out'); finish(1) }, RUN_MS)

const traces = {}
const results = { scenarios: {} }
const failures = []
let finished = false
function fail(msg) { failures.push(msg); console.error('FAIL: ' + msg) }
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  const payload = { url, results, traces, failures, finishedAt: new Date().toISOString() }
  try { writeFileSync(join(outDir, 'qa351-trace.json'), JSON.stringify(payload, null, 2)) } catch (e) { console.error('trace write failed', e) }
  console.log('QA351_RESULTS ' + JSON.stringify(results))
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
const click = (win, text) => win.webContents.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('Button unavailable: '+${JSON.stringify(text)}); b.click(); })()`)
async function field(win, sel, value) {
  await win.webContents.executeJavaScript(`(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw Error('Field missing: '+${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`)
}
function windowFor(partition) {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  const trace = { partition, console: [], network: [], gone: [] }
  traces[partition] = trace
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => trace.console.push({ level, message: String(message).slice(0, 600) }))
  win.webContents.on('render-process-gone', (_e, d) => trace.gone.push(d))
  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, d => { if (d.statusCode >= 400) trace.network.push({ url: d.url, status: d.statusCode, method: d.method }) })
  return win
}
const shot = async (win, name) => { try { writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG()) } catch {} }
const word = (win, i) => win.webContents.executeJavaScript(`document.querySelectorAll('.word')[${i}]?.textContent`)
const words = async (win) => win.webContents.executeJavaScript(`[...document.querySelectorAll('.word')].map(w=>w.textContent)`)
const status = (win) => win.webContents.executeJavaScript(`document.querySelector('.shared-edit-bar [role="status"]')?.textContent.trim()||''`)
const conflictText = (win) => win.webContents.executeJavaScript(`document.querySelector('.shared-edit-bar .shared-conflict')?.innerText||''`)
const undoState = (win) => win.webContents.executeJavaScript(`(() => { const b=[...document.querySelectorAll('.history-controls button')].find(b=>b.textContent.trim()==='Undo'); return b ? { disabled: b.disabled } : null })()`)
const clickUndo = (win) => win.webContents.executeJavaScript(`(() => { const b=[...document.querySelectorAll('.history-controls button')].find(b=>b.textContent.trim()==='Undo'); if (b && !b.disabled) b.click(); return !!b && !b.disabled; })()`)
const clickRedo = (win) => win.webContents.executeJavaScript(`(() => { const b=[...document.querySelectorAll('.history-controls button')].find(b=>b.textContent.trim()==='Redo'); if (b && !b.disabled) b.click(); return !!b && !b.disabled; })()`)
const waitSaved = (win, budget = 25000) => waitFor(win, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, budget)
const waitSettled = (win, budget = 25000) => waitFor(win, `(() => { const t=document.querySelector('.shared-edit-bar [role="status"]')?.textContent||''; return t.includes('All changes saved') || t.includes('Resolve simultaneous edits') })()`, budget)
async function correctWord(win, index, text) {
  win.focus()
  await win.webContents.executeJavaScript(`document.querySelectorAll('.word')[${index}].click()`)
  if (!await waitFor(win, `[...document.querySelectorAll('button')].some(b=>/Correct word/.test(b.textContent))`, 15000)) throw Error('Correct word control did not appear for word ' + index)
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('button')].find(b=>/Correct word/.test(b.textContent))).click()`)
  await waitFor(win, `!!document.querySelector('.word-edit')`, 15000)
  await win.webContents.executeJavaScript(`document.querySelector('.word-edit').focus()`)
  await field(win, '.word-edit', text)
  await win.webContents.executeJavaScript(`(() => { const i=document.querySelector('.word-edit'); i.blur(); if(i.isConnected) i.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); })()`)
  if (!await waitFor(win, `!document.querySelector('.word-edit') && document.querySelectorAll('.word')[${index}]?.textContent===${JSON.stringify(text)}`, 15000)) throw Error('Word ' + index + ' did not become ' + text)
}
async function saveNow(win) {
  try { await click(win, 'Save now') } catch { /* autosave may already be running */ }
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
    window.__transcriptionTest = { attempts: 0 };
    window.Worker = class extends EventTarget {
      constructor(url, options) { super(); if (!String(url).includes('browserWhisper.worker')) return new NativeWorker(url, options); }
      terminate() { this.stopped = true; }
      emit(data) { setTimeout(() => { if (!this.stopped) this.onmessage?.({ data }); }, 10); }
      postMessage(message) {
        if (message.type === 'load') this.emit({ type: 'ready', backend: 'wasm', fallbackReason: undefined });
        else { window.__transcriptionTest.attempts++; this.emit({ type: 'result', id: message.id, cues: [
          { text: 'Welcome to this recording.', start: 0, end: 2 },
          { text: 'Now a different chapter.', start: 6, end: 8 }
        ] }); }
      }
    };
  ` })
  await owner.loadURL(url)
  await owner.webContents.executeJavaScript(`(async () => {
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
    for(let i=0;i<samples;i++) view.setInt16(44+i*2,Math.sin(i*0.1)*2000,true);
    const transfer=new DataTransfer(); transfer.items.add(new File([bytes],'transcription-test.wav',{type:'audio/wav'}));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  })()`)
  if (!await waitFor(owner, `document.querySelector('.transcript-heading small')?.textContent.includes('2 chapters')`, 45000)) throw Error('Owner transcription fixture did not produce 2 chapters')
  await click(owner, 'Share')
  await owner.webContents.executeJavaScript(`(() => { const s=document.querySelector('[aria-label="Share access"]'); s.value='edit'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await click(owner, 'Create editing link')
  if (!await waitFor(owner, `!!document.querySelector('.review-link-box input')`, 15000)) throw Error('Editing link was not created')
  const link = await owner.webContents.executeJavaScript(`document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editing link: ' + link)
  results.editLink = link.replace(/[?#].*$/, '/edit/<room>#<key>')
  await shot(owner, '01-owner-share-link.png')

  const guest = windowFor('guest'); await guest.loadURL(link)
  if (!await waitFor(guest, `document.querySelectorAll('.word').length===8`, 30000)) throw Error('Guest editor did not load 8 words')
  await field(guest, '[aria-label="Editor name"]', 'Guest A')
  const peer = windowFor('peer'); await peer.loadURL(link)
  if (!await waitFor(peer, `document.querySelectorAll('.word').length===8`, 30000)) throw Error('Peer editor did not load 8 words')
  await field(peer, '[aria-label="Editor name"]', 'Guest B')
  results.setup = true
  results.initialWords = await words(owner)
  await waitSaved(guest, 25000); await waitSaved(peer, 25000)
  await shot(guest, '02-guest-joined.png')

  // ---------------------------------------------------------------------
  // RYA-342: local Undo survives a peer merge (projectRevision advances)
  // ---------------------------------------------------------------------
  try {
    const s = results.scenarios.rya342 = {}
    await correctWord(guest, 2, 'G2'); await saveNow(guest); await waitSaved(guest, 25000)
    await correctWord(guest, 3, 'G3'); await saveNow(guest); await waitSaved(guest, 25000)
    s.undoEnabledBeforeMerge = !(await undoState(guest))?.disabled
    if (!s.undoEnabledBeforeMerge) fail('RYA-342 precondition: Undo was already disabled before the peer merge')

    // Prove Undo works before the merge, then restore via Redo and save.
    await clickUndo(guest); await waitFor(guest, `document.querySelectorAll('.word')[3]?.textContent!=='G3'`, 15000)
    s.undoWorkedBeforeMerge = (await word(guest, 3)) !== 'G3'
    await clickRedo(guest); await waitFor(guest, `document.querySelectorAll('.word')[3]?.textContent==='G3'`, 15000)
    await saveNow(guest); await waitSaved(guest, 25000)

    const revBefore = (await roomState(guest, link))?.projectRevision
    await shot(guest, '03-rya342-before-merge.png')

    // Peer edits a different word (different cue) and saves -> revision advances.
    await correctWord(peer, 5, 'Peer5'); await saveNow(peer); await waitSaved(peer, 25000)
    s.mergeObservedAfterPeerSave = await waitFor(guest, `document.querySelectorAll('.word')[5]?.textContent==='Peer5'`, 30000)
    await sleep(2500)
    s.word3BeforeUndo = await word(guest, 3)
    s.projectRevisionBefore = revBefore
    s.projectRevisionAfter = (await roomState(guest, link))?.projectRevision
    s.revisionAdvanced = typeof s.projectRevisionBefore === 'number' && typeof s.projectRevisionAfter === 'number' && s.projectRevisionAfter > s.projectRevisionBefore
    s.undoEnabledAfterMerge = !(await undoState(guest))?.disabled
    await shot(guest, '04-rya342-after-merge.png')

    const clicked = await clickUndo(guest)
    s.undoButtonAcceptedClick = clicked
    await sleep(2000)
    s.word3AfterUndoAttempt = await word(guest, 3)
    s.undoAfterMergeWorked = s.word3AfterUndoAttempt !== 'G3'
    s.peerWord5Preserved = (await word(guest, 5)) === 'Peer5'
    await saveNow(guest); await waitSaved(guest, 25000)
    await shot(guest, '05-rya342-after-undo.png')

    s.checks = {
      undoEnabledBeforeMerge: s.undoEnabledBeforeMerge,
      undoWorkedBeforeMerge: s.undoWorkedBeforeMerge,
      mergeObservedAfterPeerSave: s.mergeObservedAfterPeerSave,
      revisionAdvanced: s.revisionAdvanced,
      undoEnabledAfterMerge: s.undoEnabledAfterMerge,
      undoAfterMergeWorked: s.undoAfterMergeWorked,
      peerEditPreserved: s.peerWord5Preserved
    }
    s.ok = Object.values(s.checks).every(Boolean)
    if (!s.ok) {
      if (!s.undoEnabledAfterMerge) fail('RYA-342: Undo is disabled after the peer merge (merge wiped local history)')
      else if (!s.undoAfterMergeWorked) fail('RYA-342: Undo after the peer merge did not reverse the local last edit')
      if (!s.mergeObservedAfterPeerSave) fail('RYA-342: peer edit was not observed before the Undo assertion')
      if (!s.revisionAdvanced) fail('RYA-342: projectRevision did not advance across the peer merge')
    }
  } catch (e) {
    results.scenarios.rya342 = Object.assign(results.scenarios.rya342 || {}, { error: String(e), ok: false })
    fail('RYA-342 harness error: ' + e.message)
  }

  // ---------------------------------------------------------------------
  // Control: different cues merge cleanly (already passes at baseline).
  // Proves the convergence/conflict checks can pass and isolate RYA-343 to
  // same-cue merge granularity rather than a broken harness selector.
  // ---------------------------------------------------------------------
  try {
    const s = results.scenarios.crossCueControl = {}
    await saveNow(guest); await waitSaved(guest, 25000)
    await saveNow(peer); await waitSaved(peer, 25000)
    await sleep(3500)
    await correctWord(guest, 0, 'CrossA')
    await correctWord(peer, 4, 'CrossB')
    await Promise.all([saveNow(guest), saveNow(peer)])
    await waitSettled(guest, 30000); await waitSettled(peer, 30000)
    await sleep(3500)
    s.guestStatus = await status(guest); s.peerStatus = await status(peer)
    s.guestConflict = await conflictText(guest); s.peerConflict = await conflictText(peer)
    const room = await roomState(guest, link)
    s.serverWord0 = room?.project?.transcript?.words?.[0]?.text ?? null
    s.serverWord4 = room?.project?.transcript?.words?.[4]?.text ?? null
    s.guestWords = [await word(guest, 0), await word(guest, 4)]
    s.peerWords = [await word(peer, 0), await word(peer, 4)]
    const blockingConflict = /Resolve simultaneous edits/.test(s.guestStatus || '') || /Resolve simultaneous edits/.test(s.peerStatus || '') ||
      /Another editor changed the same items/.test(s.guestConflict || '') || /Another editor changed the same items/.test(s.peerConflict || '')
    s.checks = {
      noBlockingConflict: !blockingConflict,
      bothWordsPersisted: s.serverWord0 === 'CrossA' && s.serverWord4 === 'CrossB',
      clientsConverged: s.guestWords[0] === 'CrossA' && s.guestWords[1] === 'CrossB' && s.peerWords[0] === 'CrossA' && s.peerWords[1] === 'CrossB'
    }
    s.ok = Object.values(s.checks).every(Boolean)
    if (!s.ok) fail('Control: cross-cue clean-merge control failed (harness may be non-discriminating): ' + JSON.stringify(s.checks))
  } catch (e) {
    results.scenarios.crossCueControl = Object.assign(results.scenarios.crossCueControl || {}, { error: String(e), ok: false })
    fail('Control harness error: ' + e.message)
  }

  // ---------------------------------------------------------------------
  // RYA-343: two clients edit different words in the same cue, stale base
  // ---------------------------------------------------------------------
  try {
    const s = results.scenarios.rya343 = {}
    // Clean sync barrier before the stale-base setup.
    await saveNow(guest); await waitSaved(guest, 25000)
    await saveNow(peer); await waitSaved(peer, 25000)
    await sleep(3500)

    // Freeze the peer's base so its next save carries a stale revision.
    let peerOffline = true
    peer.webContents.session.webRequest.onBeforeRequest({ urls: [origin + '/api/reviews/*'] }, (_d, cb) => cb({ cancel: peerOffline }))
    await sleep(5000)

    // Guest edits word 6 of cue 2 and persists -> server advances.
    await correctWord(guest, 6, 'SameCueA'); await saveNow(guest); await waitSaved(guest, 25000)
    s.guestSavedWord6 = await word(guest, 6)

    // Peer edits the *different* word 7 of the same cue on its stale base.
    await correctWord(peer, 7, 'SameCueB')
    s.peerLocalWord7 = await word(peer, 7)

    // Reconnect: the peer's poll now merges against the newer revision.
    peerOffline = false
    await waitSettled(peer, 30000)
    await saveNow(peer).catch(() => {})
    await waitSettled(peer, 30000)
    await sleep(3500)

    s.peerStatus = await status(peer)
    s.peerConflict = await conflictText(peer)
    s.guestStatus = await status(guest)
    s.guestConflict = await conflictText(guest)
    s.peerWord6 = await word(peer, 6); s.peerWord7 = await word(peer, 7)
    s.guestWord6 = await word(guest, 6); s.guestWord7 = await word(guest, 7)
    const room = await roomState(peer, link)
    s.serverWord6 = room?.project?.transcript?.words?.[6]?.text ?? null
    s.serverWord7 = room?.project?.transcript?.words?.[7]?.text ?? null
    await shot(peer, '06-rya343-peer-after-reconnect.png')

    const blockingConflict = /Resolve simultaneous edits/.test(s.peerStatus || '') || /Resolve simultaneous edits/.test(s.guestStatus || '') ||
      /Another editor changed the same items/.test(s.peerConflict || '') || /Another editor changed the same items/.test(s.guestConflict || '')
    s.conflictTextObserved = /Another editor changed/.test(s.peerConflict || '') ? s.peerConflict : (/Another editor changed/.test(s.guestConflict || '') ? s.guestConflict : '')
    s.noBlockingConflict = !blockingConflict
    s.bothWordsPersisted = s.serverWord6 === 'SameCueA' && s.serverWord7 === 'SameCueB'
    s.clientsConverged = s.guestWord6 === 'SameCueA' && s.guestWord7 === 'SameCueB' && s.peerWord6 === 'SameCueA' && s.peerWord7 === 'SameCueB'
    s.checks = {
      noBlockingConflict: s.noBlockingConflict,
      bothWordsPersisted: s.bothWordsPersisted,
      clientsConverged: s.clientsConverged
    }
    s.ok = Object.values(s.checks).every(Boolean)
    await shot(peer, '07-rya343-final.png')
    if (!s.ok) {
      if (!s.noBlockingConflict) fail('RYA-343: same-cue different-word edits hit a blocking "Resolve simultaneous edits" state' + (s.conflictTextObserved ? ' (' + s.conflictTextObserved.split('\n')[2] + ')' : ''))
      if (!s.bothWordsPersisted) fail('RYA-343: both words did not persist (server word6=' + s.serverWord6 + ', word7=' + s.serverWord7 + ')')
      if (!s.clientsConverged) fail('RYA-343: clients did not converge on both words')
    }
  } catch (e) {
    results.scenarios.rya343 = Object.assign(results.scenarios.rya343 || {}, { error: String(e), ok: false })
    fail('RYA-343 harness error: ' + e.message)
  }

  results.pass = !!(results.scenarios.rya342?.ok && results.scenarios.rya343?.ok && results.scenarios.crossCueControl?.ok)
  finish(results.pass ? 0 : 2)
}).catch(error => { console.error(error); results.fatal = String(error); fail('harness fatal: ' + error.message); finish(1) })
