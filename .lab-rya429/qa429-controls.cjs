/*
 * RYA-437 / SPE-BUG3-REG: durable two-context owner-sees-collaborator-edit regression.
 *
 * Defect RYA-335 FINDING 1 / RYA-429 (SPE-BUG3): the reel owner edits in the
 * normal workspace (route `/`). Only the shared-editing route (`/edit/<room>#<key>`,
 * src/renderer/src/components/EditPage.tsx:12-21) constructs a CollaborationClient.
 * So when a collaborator opens the full-editing link, changes a word and saves,
 * the owner's own editor never polls, applies, or surfaces the change. The owner's
 * only ingress is Share -> "Bring shared edits into this project"
 * (src/renderer/src/components/ShareSheet.tsx:98). A tired owner at 6am sees no
 * notification, badge or status change and cannot tell a teammate edited anything.
 *
 * This harness prepares ONLY the regression. It does not change product source.
 *
 * Two independent Electron contexts over one full-editing room:
 *   - owner : creates the reel, creates the full-editing link, stays in the main
 *             workspace editor (NOT /edit/), closes the Share sheet.
 *   - guest : opens the /edit/ link, corrects word 0 to "RemoteWelcome", saves.
 *
 * Then it watches the owner's own editor for the existing poll interval and
 * asserts the owner observes the collaborator's saved change through one of the
 * two accepted product behaviors:
 *   (a) the change is auto-applied to the owner's editor (word 0 becomes
 *       "RemoteWelcome"), or
 *   (b) a clear in-editor prompt/status/badge announces the collaborator change.
 *
 * Baseline origin/main @ e9b6590 must FAIL: the owner never observes the edit.
 * Astra's fix must make it PASS unchanged.
 *
 * Usage:
 *   QA437_OUT=/dir electron scripts/qa437-owner-sees-collaborator-edits.cjs \
 *     http://127.0.0.1:3381 --no-sandbox
 *
 * Exit codes: 0 = owner observes the collaborator edit, 2 = acceptance failed,
 *             1 = harness error / timeout.
 */
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const outDir = process.env.QA437_OUT || join(tmpdir(), 'speechedit-qa437')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'speechedit-qa437-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3381'
const RUN_MS = Number(process.env.QA437_RUN_MS || 300000)
const WAIT_MS = Number(process.env.QA437_WAIT_MS || 60000)
// 3 s is the production CollaborationClient poll interval (collaborationClient.ts
// open(): setInterval(..., 3000)). Watch ten intervals so a slower owner poll
// implementation still passes, while baseline fails deterministically.
const OBSERVE_MS = Number(process.env.QA437_OBSERVE_MS || 45000)
const REMOTE_WORD = 'RemoteWelcome'
const timer = setTimeout(() => { console.error('QA437 timed out'); finish(1) }, RUN_MS)

const results = { steps: [] }
const traces = {}
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
  try { writeFileSync(join(outDir, 'qa437-trace.json'), JSON.stringify(payload, null, 2)) } catch (e) { console.error('trace write failed', e) }
  console.log('QA437_RESULTS ' + JSON.stringify({ pass: results.pass, failures, results }))
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

// --- owner-visible signals ------------------------------------------------
const ownerWords = win => js(win, `[...document.querySelectorAll('.word')].map(w=>w.textContent)`)
const ownerCachedProject = win => js(win, `(() => { try { return JSON.parse(localStorage.getItem('speechedit:project')||'null') } catch { return null } })()`)
const ownerCachedWord0 = win => js(win, `(() => { try { const p=JSON.parse(localStorage.getItem('speechedit:project')||'null'); return p?.transcript?.words?.[0]?.text ?? null } catch { return null } })()`)
// A clear in-editor shared-edit prompt: not the Share sheet button. The Share
// sheet is closed for the whole observation window, so anything here is an
// in-editor surface the owner can see without hunting.
const sharedPrompt = win => js(win, `(() => {
  const verbs='(edit|edits|edited|editing|change|changes|changed|changing|update|updates|updated|updating)';
  const actors='(collaborator|teammate|guest|another editor|shared (project|edit|copy)|this project)';
  const re = new RegExp('\\\\bshared edits?\\\\b|\\\\bbring shared\\\\b|\\\\bremote (edit|change|update)|\\\\b'+verbs+'\\\\b[^.]{0,40}\\\\b'+actors+'|\\\\b'+actors+'\\\\b[^.]{0,40}\\\\b'+verbs+'\\\\b|\\\\bnew (shared )?(edit|change|version|revision)s?\\\\b|\\\\bchanges? (are )?(available|waiting|pending)\\\\b|\\\\b(has|have) new (edit|change)s?\\\\b', 'i');
  const nodes=[...document.querySelectorAll('[role="status"],[role="alert"],.toast,.doc-banner,.shared-edit-bar,.shared-edit-notice')];
  for (const n of nodes) { const t=(n.textContent||'').trim(); if (t && re.test(t)) return t.slice(0,300) }
  return null;
})()`)

function windowFor(partition) {
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  const trace = { partition, console: [], network: [], gone: [], reviewRequests: [] }
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
        {text:'Now a different chapter.',start:6,end:8}
      ]}); }
    };
  ` })
}
const correctWord = async (win, index, text) => {
  win.focus()
  await js(win, `document.querySelectorAll('.word')[${index}].click()`)
  if (!await waitFor(win, `[...document.querySelectorAll('button')].some(b=>/Correct word/.test(b.textContent))`, 15000)) throw Error('Correct word control did not appear')
  await js(win, `([...document.querySelectorAll('button')].find(b=>/Correct word/.test(b.textContent))).click()`)
  if (!await waitFor(win, `!!document.querySelector('.word-edit')`, 15000)) throw Error('Word editor did not open')
  await js(win, `document.querySelector('.word-edit').focus()`)
  await field(win, '.word-edit', text)
  await js(win, `(() => { const input=document.querySelector('.word-edit'); input.blur(); if (input.isConnected) input.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); })()`)
  if (!await waitFor(win, `!document.querySelector('.word-edit') && document.querySelectorAll('.word')[${index}]?.textContent === ${JSON.stringify(text)}`, 15000)) throw Error('Word correction did not apply')
}

app.whenReady().then(async () => {
  // --- owner: create the reel and a full editing link ----------------------
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
    const transfer=new DataTransfer(); transfer.items.add(new File([bytes],'qa437.wav',{type:'audio/wav'}));
    document.querySelector('.panel.transcript').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
  })()`)
  if (!await waitFor(owner, `document.querySelectorAll('.word').length === 8`, 90000)) throw Error('Owner fixture did not produce 8 words')
  results.ownerOriginalWord0 = await js(owner, `document.querySelectorAll('.word')[0].textContent`)
  results.ownerOriginalWords = await ownerWords(owner)

  await click(owner, 'Share')
  await js(owner, `(() => { const s=document.querySelector('[aria-label="Share access"]'); s.value='edit'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await click(owner, 'Create editing link')
  if (!await waitFor(owner, `!!document.querySelector('.review-link-box input')`, 15000)) throw Error('Editing link was not created')
  const link = await js(owner, `document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editing link: ' + link)
  const u = new URL(link), roomId = u.pathname.split('/')[2], key = u.hash.slice(1), origin = u.origin
  results.editLink = link.replace(/[?#].*$/, '/edit/<room>#<key>')
  step('owner-created-link', { roomId: roomId.slice(0, 8) + '…' })

  // Owner stays in the main workspace editor. Close the Share sheet so the
  // observation only sees the editor surface (no Share-only "Bring shared
  // edits" button, which requires the owner to hunt through Share).
  await click(owner, 'Close')
  if (!await waitFor(owner, `!document.querySelector('.share-sheet') && document.querySelectorAll('.word').length === 8`, 15000)) throw Error('Owner editor did not restore after closing Share')
  results.ownerShareSheetClosed = true
  // Clear the one-time "Full editing link ready…" toast so the observation only
  // reacts to a *new* in-editor signal caused by the collaborator's save.
  for (let i = 0; i < 60; i++) {
    if (!await js(owner, `!!document.querySelector('.toast')`).catch(() => false)) break
    await js(owner, `(() => { const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')==='Dismiss message'||b.textContent.trim()==='Dismiss'); if(b) b.click(); })()`).catch(() => {})
    await sleep(100)
  }
  if (!await waitFor(owner, `!document.querySelector('.toast')`, 15000)) throw Error('Owner toast did not clear before observation')

  // Count the owner's own review-API traffic while we watch. Baseline makes zero
  // requests; a polling fix will make some. Recorded as evidence, not a gate.
  owner.webContents.session.webRequest.onBeforeRequest({ urls: [`${origin}/api/reviews/*`] }, (d, cb) => { traces.owner.reviewRequests.push({ method: d.method, url: d.url, at: Date.now() }); cb({}) })

  // Precondition/negative control: before any guest change, the owner shows no
  // shared-edit prompt and still has the original word.
  results.ownerPreRemoteWord0 = await ownerCachedWord0(owner)
  results.ownerPreRemotePrompt = await sharedPrompt(owner)
  if (results.ownerPreRemotePrompt) fail('negative control: owner already showed a shared-edit prompt before any collaborator edit')
  if (results.ownerPreRemoteWord0 !== results.ownerOriginalWord0) fail('negative control: owner word 0 changed before any collaborator edit')

  // Detector self-test (harness-only, no product source change): prove the
  // in-editor prompt predicate actually fires on a shared-edit message, so a
  // passing fix is reachable and this harness is not trivially always-failing.
  const probeText = 'A collaborator edited this project. Review shared edits.'
  await js(owner, `(() => { const p=document.createElement('div'); p.className='shared-edit-notice'; p.setAttribute('role','status'); p.textContent=${JSON.stringify(probeText)}; p.style.position='absolute'; p.style.left='-9999px'; document.body.appendChild(p) })()`)
  const detected = await sharedPrompt(owner)
  await js(owner, `document.querySelectorAll('.shared-edit-notice').forEach(n=>n.remove())`)
  results.detectorSelfTest = { promptDetected: !!detected, probeText: detected }
  if (!detected) fail('detector self-test failed: the shared-edit prompt predicate did not recognize a shared-edit message')
  if (await sharedPrompt(owner)) fail('detector self-test cleanup failed: the probe prompt was not removed')
  step('detector-self-test', results.detectorSelfTest)

  // --- guest: open the link, correct a word, save --------------------------
  const guest = windowFor('guest')
  await guest.loadURL(link)
  if (!await waitFor(guest, `document.querySelectorAll('.word').length === 8 && !!document.querySelector('.timeline-panel')`, 30000)) throw Error('Guest editor did not load')
  await field(guest, '[aria-label="Editor name"]', 'Guest B')
  await correctWord(guest, 0, REMOTE_WORD)
  await click(guest, 'Save now')
  if (!await waitFor(guest, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, 60000)) throw Error('Guest save did not settle')
  const room = await js(guest, `fetch('/api/reviews/${roomId}', { headers: { Authorization: 'Bearer ${key}' } }).then(r=>r.ok?r.json():{httpStatus:r.status})`)
  results.serverWord0AfterGuestSave = room?.project?.transcript?.words?.[0]?.text ?? null
  if (results.serverWord0AfterGuestSave !== REMOTE_WORD) throw Error('Guest correction did not reach the server project: ' + results.serverWord0AfterGuestSave)
  results.guestSaved = true
  await shot(guest, '01-guest-saved.png')
  step('guest-saved', { serverWord0: results.serverWord0AfterGuestSave })

  // --- watch the owner's own editor for the poll interval ------------------
  const started = Date.now()
  let autoApplied = false, prompt = null
  while (Date.now() - started < OBSERVE_MS) {
    const words = await ownerWords(owner).catch(() => [])
    if (words[0] === REMOTE_WORD) { autoApplied = true; break }
    const p = await sharedPrompt(owner).catch(() => null)
    if (p) { prompt = p; break }
    await sleep(250)
  }
  results.observeMs = Date.now() - started
  results.ownerAutoApplied = autoApplied
  results.ownerPrompt = prompt
  results.ownerObservedWord0 = (await ownerWords(owner).catch(() => []))[0] ?? null
  results.ownerCachedWord0After = await ownerCachedWord0(owner).catch(() => null)
  results.ownerPollCount = traces.owner.reviewRequests.length
  await shot(owner, '02-owner-after-guest-save.png')
  step('owner-observation', {
    autoApplied, prompt, ownerObservedWord0: results.ownerObservedWord0,
    ownerCachedWord0After: results.ownerCachedWord0After, ownerPollCount: results.ownerPollCount, observeMs: results.observeMs
  })

  // RYA-429 adjacent controls: same explicit command, local merge, Undo, layout.
  await correctWord(owner, 7, 'LocalEnding')
  await click(owner, 'Bring shared edits into this project')
  if (!await waitFor(owner, `document.querySelectorAll('.word')[0]?.textContent === 'RemoteWelcome' && document.querySelectorAll('.word')[7]?.textContent === 'LocalEnding'`, 15000)) throw Error('Explicit import lost remote or local edits')
  if (!await waitFor(owner, `document.querySelector('[aria-label="Collaborator updates"] [role="status"]')?.textContent === 'No new updates.'`, 10000)) throw Error('Import did not clear pending status')
  owner.focus()
  await js(owner, `document.activeElement?.blur()`)
  owner.webContents.sendInputEvent({ type:'keyDown', keyCode:'Z', modifiers:['control'] })
  owner.webContents.sendInputEvent({ type:'keyUp', keyCode:'Z', modifiers:['control'] })
  if (!await waitFor(owner, `document.querySelectorAll('.word')[0]?.textContent === 'Welcome' && document.querySelectorAll('.word')[7]?.textContent === 'LocalEnding'`, 10000)) throw Error('Undo did not preserve the pre-import local edit')
  const layout = await js(owner, `(() => { const r=document.querySelector('.timeline-panel').getBoundingClientRect(); return { top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight } })()`)
  if (layout.height < 50 || layout.bottom > layout.viewport + 1) throw Error('Timeline pushed outside editor: '+JSON.stringify(layout))
  results.ownerImportUndo = { pass:true, layout }
  await shot(owner, '04-owner-after-import-undo.png')

  // --- discriminating control: the /edit/ route DOES sync live ------------
  // A link-opener editor on the same room must see a fresh guest edit within the
  // poll interval. This proves the auto-apply detector works and that the defect
  // is specific to the owner's main workspace route, not collaboration in general.
  const control = windowFor('control')
  await control.loadURL(link)
  const controlLoaded = await waitFor(control, `document.querySelectorAll('.word').length === 8 && document.querySelectorAll('.word')[0]?.textContent === ${JSON.stringify(REMOTE_WORD)}`, 30000)
  results.controlLoadedFromServer = controlLoaded
  if (!controlLoaded) fail('discriminating control: the /edit/ route did not load the server word edit')
  await correctWord(guest, 1, 'LiveSync')
  await click(guest, 'Save now')
  await waitFor(guest, `(document.querySelector('.shared-edit-bar [role="status"]')?.textContent||'').includes('All changes saved')`, 60000)
  const controlSynced = await waitFor(control, `document.querySelectorAll('.word')[1]?.textContent === 'LiveSync'`, 20000)
  results.controlLiveSynced = controlSynced
  await shot(control, '03-control-edit-link-synced.png')
  step('discriminating-control', { controlLoadedFromServer: controlLoaded, controlLiveSynced: controlSynced })
  if (!controlSynced) fail('discriminating control: the /edit/ route did not auto-apply the guest edit within the poll interval')

  await correctWord(owner, 0, 'LocalConflict')
  await correctWord(guest, 0, 'SecondRemote')
  await click(guest, 'Save now')
  if (!await waitFor(owner, `!![...document.querySelectorAll('[aria-label="Collaborator updates"] button')].find(b=>b.textContent==='Bring shared edits into this project')`, 10000)) throw Error('Second update was not surfaced')
  await click(owner, 'Bring shared edits into this project')
  if (!await waitFor(owner, `(document.querySelector('[aria-label="Collaborator updates"] [role="alert"]')?.textContent||'').includes('overlap')`, 10000)) throw Error('Conflict was not preserved')
  await sleep(3500)
  results.conflictPreserved = await js(owner, `document.querySelectorAll('.word')[0]?.textContent === 'LocalConflict' && (document.querySelector('[aria-label="Collaborator updates"] [role="alert"]')?.textContent||'').includes('overlap')`)
  if (!results.conflictPreserved) throw Error('Polling cleared the conflict or changed local text')
  await shot(owner, '05-owner-conflict-retained.png')

  results.completed = true
  const observed = autoApplied || !!prompt
  results.pass = observed && controlSynced
  if (!observed) {
    fail(`owner never observed the collaborator's saved word edit within ${results.observeMs} ms (expected the editor to auto-apply "${REMOTE_WORD}" or show a clear in-editor shared-edit prompt). ` +
      `owner word[0]="${results.ownerObservedWord0}" (server="${REMOTE_WORD}"), owner cached word[0]="${results.ownerCachedWord0After}", ` +
      `owner review-API requests during the window=${results.ownerPollCount}. Root cause: the main workspace editor does not construct a CollaborationClient ` +
      `(only /edit/ openers do, src/renderer/src/components/EditPage.tsx:12-21); the sole owner ingress is Share -> "Bring shared edits into this project".`)
  } else {
    results.acceptedBehavior = autoApplied ? 'auto-applied' : 'in-editor prompt'
  }
  finish(failures.length ? 2 : 0)
}).catch(error => { console.error(error); results.error = String(error); finish(1) })
