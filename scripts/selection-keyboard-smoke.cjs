// RYA-505: real CDP pointer/keyboard selection, Tab/Enter, Delete/Undo and focus recovery.
// Host and guest use disposable rooms, synthetic WAV and mock ASR. Baseline exits 2; candidate 0.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const outDir = process.env.KEYBOARD_OUT || join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || tmpdir(), 'speechedit-keyboard')
mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || tmpdir(), 'speechedit-keyboard-profile-'))
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
app.on('quit', () => rmSync(profile, { recursive: true, force: true }))

const url = process.argv.find(a => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3481'
const timer = setTimeout(() => { console.error('Keyboard check timed out'); finish(1) }, Number(process.env.KEYBOARD_RUN_MS || 420000))

const traces = {}
const results = { steps: [], probe: 'RYA-505 selection keyboard regression', findings: [] }
let finished = false
function step(name, value) { results.steps.push({ name, ...(value === undefined ? {} : { value }), at: Date.now() }) }
function finding(id, text) { results.findings.push({ id, text }); console.error('FINDING ' + id + ': ' + text) }
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  results.completed = code !== 1; results.pass = code === 0
  try { writeFileSync(join(outDir, 'keyboard-trace.json'), JSON.stringify({ url, results, traces }, null, 2)) } catch (e) { console.error('trace write failed', e) }
  console.log('KEYBOARD_RESULTS ' + JSON.stringify({ findings: results.findings.map(f => f.id) }))
  app.exit(code)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const js = (win, expression) => win.webContents.executeJavaScript(expression)
const shot = async (win, name) => { try { writeFileSync(join(outDir, name), (await win.webContents.capturePage()).toPNG()) } catch {} }
async function waitFor(win, expression, budgetMs = 45000) {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (await js(win, expression).catch(() => false)) return true
    await sleep(50)
  }
  return false
}
const click = (win, text) => js(win, `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}); if(!b||b.disabled) throw Error('Button unavailable: '+${JSON.stringify(text)}); b.click(); })()`)
function windowFor(partition) {
  const win = new BrowserWindow({ show: true, width: 1440, height: 1000, webPreferences: { sandbox: true, partition, backgroundThrottling: false } })
  const trace = { partition, console: [], network: [] }
  traces[partition] = trace
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (_d, cb) => cb({ cancel: true }))
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) trace.console.push({ level, message: String(message).slice(0, 200) }) })
  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, d => { if (d.statusCode >= 400) trace.network.push({ url: d.url.slice(0, 120), status: d.statusCode }) })
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
  if (!await waitFor(win, `document.querySelectorAll('.word').length === 8 && /8 words/.test(document.querySelector('.transcript-heading small')?.textContent||'')`, 90000)) throw Error('Fixture did not produce 8 real words for ' + tag)
  await click(win, 'Share')
  await js(win, `(() => { const s=document.querySelector('[aria-label="Share access"]'); s.value='edit'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await click(win, 'Create editing link')
  if (!await waitFor(win, `!!document.querySelector('.review-link-box input')`, 15000)) throw Error('Editing link was not created for ' + tag)
  const link = await js(win, `document.querySelector('.review-link-box input').value`)
  if (!link.includes('/edit/')) throw Error('Not a full editing link: ' + link)
  return link
}
// Real (CDP) key events so browser focus traversal is genuine, not synthetic DOM events.
const rawKey = async (win, { key, code, vk, modifiers = 0, text }) => {
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(text ? { text } : {}) })
  if (text) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', key, code, windowsVirtualKeyCode: vk, modifiers, text })
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
}
const activeDesc = win => js(win, `(() => { const a=document.activeElement; if(!a) return 'none'; return a.tagName + ':' + (a.className && String(a.className).slice(0,40)) + ':' + (a.textContent||a.getAttribute('aria-label')||a.placeholder||'').trim().slice(0,40) })()`)
const check = (name, pass, detail) => { step(name, { pass, detail }); if (!pass) finding(name, JSON.stringify(detail)) }
const key = async (win, name, modifiers = 0) => {
  const codes = { Tab: 9, Enter: 13, Escape: 27, Delete: 46, z: 90, f: 70 }
  await rawKey(win, { key: name, code: name.length === 1 ? 'Key' + name.toUpperCase() : name, vk: codes[name], modifiers, ...(name === 'Enter' ? { text: '\r' } : {}) })
  await sleep(150)
}
async function select(win, index, keyboard = false) {
  win.focus()
  if (keyboard) {
    await js(win, `document.querySelectorAll('.word')[${index}].focus()`)
    await key(win, 'Enter')
  } else {
    const box = await js(win, `(() => {const w=document.querySelectorAll('.word')[${index}];w.scrollIntoView({block:'center'});const r=w.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    for (const type of ['mousePressed','mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...box, button:'left', clickCount:1 })
    await sleep(150)
  }
}
app.whenReady().then(async () => {
  const host = windowFor('keyboard-host'), guest = windowFor('keyboard-guest')
  await installMock(host); await installMock(guest)
  const link = await createRoom(host, 'keyboard-fixture')
  await click(host, 'Close')
  await guest.loadURL(link)
  if (!await waitFor(guest, `document.querySelectorAll('.word').length === 8`)) throw Error('Guest not ready')
  for (const [name, win] of [['host',host],['guest',guest]]) {
    for (const keyboard of [false,true]) {
      await select(win, 1, keyboard)
      const trail = [await activeDesc(win)]
      let reached = false
      for (let i=0;i<4;i++) {
        await key(win,'Tab'); trail.push(await activeDesc(win))
        reached = await js(win, `!!document.activeElement.closest('.word-selection-tools') && /Correct word|Re-record audio|Preview/.test(document.activeElement.textContent)`)
        if (reached) break
      }
      check(name + (keyboard ? '-keyboard' : '-pointer') + '-tab', reached, trail)
      if (reached) {
        await shot(win, name + '-actions.png')
        await key(win,'Enter')
        check(name + '-enter', await js(win, `document.activeElement.matches('.word-edit')`), await activeDesc(win))
        await key(win,'Delete')
        check(name + '-typing-safe', await js(win, `document.querySelectorAll('.word[data-deleted="true"]').length === 0`))
        await key(win,'Escape')
      }
    }
    await select(win, 2)
    await key(win,'Tab'); await key(win,'Escape')
    check(name + '-escape-return', await js(win, `document.activeElement.matches('.script') && document.querySelectorAll('.word[data-sel="true"]').length === 1`), await activeDesc(win))
    await key(win,'Tab')
    check(name + '-no-tab-trap', await js(win, `!document.activeElement.closest('.word-selection-tools')`), await activeDesc(win))
    await select(win, 2); await key(win,'Delete')
    check(name + '-delete', await js(win, `document.querySelectorAll('.word')[2].dataset.deleted === 'true'`))
    await key(win,'Delete')
    check(name + '-repeat-delete-safe', await js(win, `document.querySelectorAll('.word')[2].dataset.deleted === 'true'`))
    await key(win,'z',2)
    check(name + '-undo', await js(win, `document.querySelectorAll('.word')[2].dataset.deleted === 'false'`))
    await key(win,'f',2)
    check(name + '-search', await js(win, `document.activeElement.matches('.transcript-find')`), await activeDesc(win))
    await key(win,'Tab')
    check(name + '-search-tab', await js(win, `!document.activeElement.closest('.word-selection-tools')`), await activeDesc(win))
  }
  finish(results.findings.length ? 2 : 0)
}).catch(e => {console.error(e); step('fatal',String(e)); finish(1)})
