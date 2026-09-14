/*
 * RYA-471 adversarial co-op harness #3 — the host's main workspace route.
 *
 * Real first-time pair: the host (owner) shares a reel and keeps working in the
 * normal workspace (`/`), while the guest opens the full-editing link
 * (`/edit/<room>#<key>`). RYA-429 added a pull-only owner notices/pull surface.
 *
 *   F. (1) guest edit reaches host after "Bring shared edits into this project"
 *      (2) host edit in the normal workspace must reach the shared project and
 *          the guest; check server + guest screen.
 *      (3) host edit survival: reload / later open the editing link must not
 *          silently drop the host's workspace work.
 *
 * RYA-479 regression: owner push, Undo/pull, conflicts, offline recovery, stale host tabs.
 * Disposable rooms only; mock ASR and synthetic WAV. Exit 0/2/1.
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const outDir = process.env.QA471_OUT || join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || tmpdir(), 'owner-sync')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || tmpdir(), 'owner-sync-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3365'
const RUN_MS = Number(process.env.QA471_RUN_MS || 300000)
const WAIT_MS = Number(process.env.QA471_WAIT_MS || 60000)
const timer = setTimeout(() => { console.error('QA471-3 timed out'); finish(1) }, RUN_MS)

const traces = {}
const results = { scenarios: {} }
const failures = []
let finished = false
function step(name, value) { (results.steps ||= []).push({ name, ...(value === undefined ? {} : { value }), at: Date.now() }) }
function fail(msg) { failures.push(msg); console.error('FAIL: ' + msg) }
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  results.pass = failures.length === 0 && results.completed === true
  try { writeFileSync(join(outDir, 'hunt3-trace.json'), JSON.stringify({ url, results, traces, failures, finishedAt: new Date().toISOString() }, null, 2)) } catch (e) { console.error('trace write failed', e) }
  console.log('QA471_RESULTS ' + JSON.stringify({ pass: results.pass, failures, scenarios: results.scenarios }))
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
const words = win => js(win, `[...document.querySelectorAll('.word')].map(w=>w.textContent)`)
const linkParts = link => { const u = new URL(link); return { id: u.pathname.split('/')[2], key: u.hash.slice(1), origin: u.origin } }
const roomWords = (win, link) => { const { id, key } = linkParts(link); return js(win, `fetch('/api/reviews/${id}',{headers:{Authorization:'Bearer ${key}'}}).then(r=>r.ok?r.json():{httpStatus:r.status}).then(r=>(r.project?.transcript?.words||[]).map(w=>w.text))`) }
const field = (win, sel, value) => js(win, `(() => { const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw Error('Field missing: '+${JSON.stringify(sel)}); const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`)
const ownerStatus = win => js(win, `(document.querySelector('[aria-label="Collaborator updates"] [role="status"]')?.textContent||'').trim()`)

const correctWord = async (win, index, text) => {
  win.focus()
  await js(win, `document.querySelectorAll('.word')[${index}].click()`)
  if (!await waitFor(win, `[...document.querySelectorAll('button')].some(b=>/Correct word/.test(b.textContent))`, 15000)) throw Error('Correct word control did not appear')
  await js(win, `([...document.querySelectorAll('button')].find(b=>/Correct word/.test(b.textContent))).click()`)
  if (!await waitFor(win, `!!document.querySelector('.word-edit')`, 15000)) throw Error('Word editor did not open')
  await js(win, `document.querySelector('.word-edit').focus()`)
  await field(win, '.word-edit', text)
  await js(win, `(() => { const input=document.querySelector('.word-edit'); input.blur(); if (input.isConnected) input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); })()`)
  if (!await waitFor(win, `!document.querySelector('.word-edit') && document.querySelectorAll('.word')[${index}]?.textContent === ${JSON.stringify(text)}`, 15000)) throw Error('Word correction did not apply: ' + text)
}

function windowFor(partition) {
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  const trace = { partition, console: [], network: [], gone: [] }
  traces[partition] = trace
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) trace.console.push({ level, message: String(message).slice(0, 400) }) })
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
        {text:'Now a different chapter.',start:6,end:8}
      ]}); }
    };
  ` })
}
async function createRoom(win, tag) {
  await win.loadURL(url)
  if (!await waitFor(win, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='File')`, 30000)) throw Error('App did not load for ' + tag)
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
  if (!await waitFor(win, `document.querySelectorAll('.word').length === 8`, 90000)) throw Error('Fixture did not produce 8 words for ' + tag)
  await click(win, 'Share')
  await js(win, `(() => { const s=document.querySelector('[aria-label="Share access"]'); s.value='edit'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await click(win, 'Create editing link')
  if (!await waitFor(win, `!!document.querySelector('.review-link-box input')`, 15000)) throw Error('Editing link was not created for ' + tag)
  const link = await js(win, `document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editing link: ' + link)
  return link
}

app.whenReady().then(async () => {
  const host = windowFor('host')          // main workspace route, stays on '/'
  const guest = windowFor('guest')        // opens /edit/ link
  await installMock(host)
  await installMock(guest)

  const S = {}
  const link = await createRoom(host, 'qaF')
  S.link = link.replace(/[?#].*$/, '/edit/<room>#<key>')
  // close the Share sheet so the workspace is the normal editor
  await click(host, 'Close').catch(() => {})
  await waitFor(host, `!document.querySelector('.share-sheet') && document.querySelectorAll('.word').length === 8`, 15000)
  S.hostBaseline = await words(host)

  await guest.loadURL(link)
  if (!await waitFor(guest, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 40000)) throw Error('Guest editor did not load')
  await field(guest, '[aria-label="Editor name"]', 'Guest')

  // guest edits word0 and saves
  await correctWord(guest, 0, 'GuestWord')
  await click(guest, 'Save now')
  await waitFor(guest, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, 60000)

  // host must be notified and able to pull
  const notified = await waitFor(host, `(() => { const t=document.querySelector('[aria-label="Collaborator updates"] [role="status"]')?.textContent||''; return t.includes('Your collaborator saved changes') })()`, 20000)
  S.hostNotified = notified
  S.hostStatus = await ownerStatus(host)
  await shot(host, 'F1-host-notified.png')
  if (!notified) fail(`Scenario F: host was not notified of the guest's saved edit within 20 s (status="${S.hostStatus}")`)

  if (notified) {
    await click(host, 'Bring shared edits into this project')
    await waitFor(host, `document.querySelectorAll('.word')[0]?.textContent === 'GuestWord'`, 20000)
  }
  S.hostWordsAfterPull = await words(host)
  if (S.hostWordsAfterPull[0] !== 'GuestWord') fail(`Scenario F: host "Bring shared edits" did not apply the guest edit (host words=${JSON.stringify(S.hostWordsAfterPull)})`)

  // host edits a DIFFERENT word in the normal workspace
  await correctWord(host, 1, 'HostWord')
  S.hostWordsAfterEdit = await words(host)
  const syncStarted = Date.now()
  await waitFor(guest, `document.querySelectorAll('.word')[1]?.textContent === 'HostWord'`, 3500)
  S.hostSyncMs = Date.now() - syncStarted

  S.serverWordsAfterHostEdit = await roomWords(guest, link)
  S.guestWordsAfterHostEdit = await words(guest)
  await shot(host, 'F2-host-edited.png')

  const hostEditShared = S.serverWordsAfterHostEdit[1] === 'HostWord' && S.guestWordsAfterHostEdit[1] === 'HostWord'
  S.hostEditShared = hostEditShared
  if (!hostEditShared) fail(`Scenario F co-op failure: host edit in the normal workspace never reached the shared project or the guest (server word1="${S.serverWordsAfterHostEdit[1]}", guest word1="${S.guestWordsAfterHostEdit[1]}", host word1="${S.hostWordsAfterEdit[1]}")`)

  // Undo the owner's correction, then Undo the imported guest edit. Both travel back.
  const undoHost = async () => {
    await js(host, `document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',ctrlKey:true,bubbles:true}))`)
  }
  await undoHost()
  await waitFor(guest, `document.querySelectorAll('.word')[1]?.textContent === 'to'`, 5000)
  S.undoHostShared = (await roomWords(guest, link))[1] === 'to' && (await words(guest))[1] === 'to'
  if (!S.undoHostShared) fail('Undo of host correction did not reach server and guest')
  await undoHost()
  await waitFor(guest, `document.querySelectorAll('.word')[0]?.textContent === 'Welcome'`, 5000)
  S.undoPullShared = (await roomWords(guest, link))[0] === 'Welcome' && (await words(guest))[0] === 'Welcome'
  if (!S.undoPullShared) fail('Undo of brought-in guest edits did not reach server and guest')
  await correctWord(host, 1, 'HostWord')
  await waitFor(guest, `document.querySelectorAll('.word')[1]?.textContent === 'HostWord'`, 5000)

  // A guest save waiting to be pulled must not be overwritten by new host work.
  await correctWord(guest, 2, 'GuestPending')
  await click(guest, 'Save now')
  await waitFor(host, `(document.querySelector('[aria-label="Collaborator updates"] [role="status"]')?.textContent||'').includes('Your collaborator saved changes')`, 10000)
  await correctWord(host, 3, 'OwnerPending')
  await sleep(3500)
  S.pendingMessage = await ownerStatus(host)
  S.waitingServer = await roomWords(guest, link)
  if (!S.pendingMessage.includes('not shared yet') || S.waitingServer[2] !== 'GuestPending' || S.waitingServer[3] === 'OwnerPending') fail('Pending guest changes were overwritten or host pending state was not explained')
  await click(host, 'Bring shared edits into this project')
  await waitFor(guest, `document.querySelectorAll('.word')[3]?.textContent === 'OwnerPending'`, 5000)
  S.mergedWords = await words(guest)
  if (S.mergedWords[2] !== 'GuestPending' || S.mergedWords[3] !== 'OwnerPending') fail('Non-overlapping pending edits did not merge and share')

  // Disconnect the host. Keep its work visible and retry after connection returns.
  await host.webContents.debugger.sendCommand('Network.enable')
  await host.webContents.debugger.sendCommand('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await correctWord(host, 4, 'OfflineOwner')
  await sleep(3500)
  S.offlineMessage = await ownerStatus(host)
  if (!S.offlineMessage.includes('not be shared yet')) fail('Offline host falsely claimed its changes were shared')
  await host.webContents.debugger.sendCommand('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await waitFor(guest, `document.querySelectorAll('.word')[4]?.textContent === 'OfflineOwner'`, 8000)
  S.reconnectedWords = await words(guest)
  if (S.reconnectedWords[4] !== 'OfflineOwner') fail('Host offline changes did not reach guest after reconnect')

  // Open another host workspace in the same browser storage before a later save.
  // Its baseline must remain tied to its own draft when the first tab pushes.
  const otherHost = windowFor('host')
  await installMock(otherHost)
  await otherHost.loadURL(url)
  await waitFor(otherHost, `document.querySelectorAll('.word')[4]?.textContent === 'OfflineOwner'`, 15000)
  await waitFor(otherHost, `(document.querySelector('[aria-label="Collaborator updates"] [role="status"]')?.textContent||'').includes('Your changes are shared')`, 5000)
  await correctWord(host, 5, 'FirstHost')
  await waitFor(guest, `document.querySelectorAll('.word')[5]?.textContent === 'FirstHost'`, 5000)
  await correctWord(otherHost, 6, 'SecondHost')
  await sleep(3500)
  S.otherHostStatus = await ownerStatus(otherHost)
  S.otherHostServer = await roomWords(guest, link)
  if (S.otherHostServer[5] !== 'FirstHost' || S.otherHostServer[6] === 'SecondHost' || !S.otherHostStatus.includes('not shared yet')) fail('Stale second host adopted another tab’s baseline and overwrote shared work')
  otherHost.close()

  // Same-word conflict: explicit pull refuses to overwrite either draft.
  await correctWord(guest, 7, 'GuestConflict')
  await click(guest, 'Save now')
  await waitFor(host, `(document.querySelector('[aria-label="Collaborator updates"] [role="status"]')?.textContent||'').includes('Your collaborator saved changes')`, 10000)
  await correctWord(host, 7, 'HostConflict')
  await sleep(500)
  await click(host, 'Bring shared edits into this project')
  await waitFor(host, `(document.querySelector('[aria-label="Collaborator updates"] [role="alert"]')?.textContent||'').includes('overlap')`, 5000)
  S.conflictAlert = await js(host, `document.querySelector('[aria-label="Collaborator updates"] [role="alert"]')?.textContent||''`)
  S.conflictServer = await roomWords(guest, link)
  S.conflictHost = await words(host)
  if (!S.conflictAlert.includes('overlap') || S.conflictHost[7] !== 'HostConflict' || S.conflictServer[7] !== 'GuestConflict') fail('Same-word conflict lost work or was not explained')
  await correctWord(host, 7, 'chapter.') // undo the conflicting correction explicitly
  await sleep(500)
  await click(host, 'Bring shared edits into this project')
  await waitFor(host, `document.querySelectorAll('.word')[7]?.textContent === 'GuestConflict'`, 5000)

  // does opening the editing link later preserve the host's workspace edit?
  await host.loadURL(link)
  await waitFor(host, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.shared-edit-bar')`, 30000)
  await sleep(4000)
  S.hostWordsAfterOpenLink = await words(host)
  S.hostWorkspaceEditSurvivedOpenLink = S.hostWordsAfterOpenLink[1] === 'HostWord'
  if (!S.hostWorkspaceEditSurvivedOpenLink) fail(`Scenario F: opening the editing link did not include the host's workspace edit (word1="${S.hostWordsAfterOpenLink[1]}" instead of "HostWord"); it remains recoverable in the normal workspace, but the shared editor shows a stale copy with no warning`)
  await shot(host, 'F3-host-open-link.png')

  // Is the workspace edit recoverable by returning to the normal workspace?
  await host.loadURL(url)
  await waitFor(host, `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='File')`, 30000)
  await sleep(2500)
  S.hostWordsAfterReturnToWorkspace = await words(host)
  S.hostWorkspaceEditRecoveredOnReturn = S.hostWordsAfterReturnToWorkspace[1] === 'HostWord'
  await shot(host, 'F4-host-return-workspace.png')
  if (S.hostWorkspaceEditSurvivedOpenLink === false && S.hostWorkspaceEditRecoveredOnReturn === false) fail('Scenario F data loss: the host workspace edit is unrecoverable after opening the editing link and returning to the workspace')

  results.scenarios.F = S
  step('scenarioF', { hostNotified: S.hostNotified, hostEditShared, hostWorkspaceEditSurvivedOpenLink: S.hostWorkspaceEditSurvivedOpenLink })
  results.completed = true
  finish(failures.length ? 2 : 0)
}).catch(error => { console.error(error); results.error = String(error); finish(1) })
