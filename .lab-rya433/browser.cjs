const {app,BrowserWindow}=require('electron')
const fs=require('fs'),path=require('path'),assert=require('assert/strict')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
app.setPath('userData',fs.mkdtempSync(path.join(process.env.TMPDIR,'qa433-')))
const url=process.argv.find(a=>a.startsWith('http'))
const out=path.join(__dirname,process.env.QA_OUTPUT||'baseline');fs.mkdirSync(out,{recursive:true})
const traces=[];let w
const js=s=>w.webContents.executeJavaScript(s)
const wait=async s=>{for(let i=0;i<150;i++){if(await js(s))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timeout '+s)}
const click=label=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`)
app.whenReady().then(async()=>{
 w=new BrowserWindow({show:true,width:900,height:750,webPreferences:{partition:'qa433',backgroundThrottling:false}})
 let allowed=false,requests=0
 w.webContents.session.setPermissionCheckHandler(()=>allowed)
 w.webContents.session.setPermissionRequestHandler((_w,p,cb)=>{requests++;cb(allowed)})
 await w.loadURL(url+'/fixture.html');await wait(`!!document.querySelector('button')`)
 // Observe transient countdown/success, not only the eventual error.
 await js(`window.observed=[];new MutationObserver(()=>window.observed.push({clock:!!document.querySelector('.record-clock'),take:!!document.querySelector('audio')})).observe(document.getElementById('root'),{subtree:true,childList:true})`)
 await click('Start recording');await wait(`!!document.querySelector('[role=alert]')`)
 const denial=await js(`({text:document.querySelector('.record-sheet').innerText,uses:window.uses,observed:window.observed})`)
 assert.equal(denial.uses,0);assert(!denial.observed.some(x=>x.clock||x.take));assert(!denial.text.includes('fits the selected slot'));assert(!denial.text.includes('Use recording'))
 traces.push({denial,requests});fs.writeFileSync(path.join(out,'denied.png'),(await w.webContents.capturePage()).toPNG())
 if(process.env.QA_EXPECT_COPY==='1'){assert.match(denial.text,/microphone is blocked/i);assert.match(denial.text,/Retry recording/)}
 allowed=true
 await click(denial.text.includes('Retry recording')?'Retry recording':'Start recording')
 await wait(`!!document.querySelector('audio')`)
 traces.push({retry:await js(`document.querySelector('.record-sheet').innerText`)});assert.equal(await js('window.uses'),0)
 await click('Use recording');assert.equal(await js('window.uses'),1)
 if(process.env.QA_EXPECT_COPY==='1') {
 for (const [name,expected] of [['PermissionDeniedError','microphone is blocked'],['SecurityError','microphone is blocked'],['NotFoundError','No microphone was found'],['NotReadableError','microphone could not start'],['missing','Microphone access is unavailable']]) {
  await w.loadURL(url+'/fixture.html');await wait(`!!document.querySelector('button')`)
  await js(name==='missing' ? `Object.defineProperty(navigator,'mediaDevices',{value:undefined});void 0` : `navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('injected device error',${JSON.stringify(name)})};void 0`)
  await click('Start recording');await wait(`!!document.querySelector('[role=alert]')`)
  const text=await js(`document.querySelector('.record-sheet').innerText`);assert(text.includes(expected));assert(text.includes('Retry recording'));assert(!text.includes('Use recording'));assert.equal(await js('window.uses'),0);traces.push({injected:name,text})
 }
 await w.loadURL(url+'/fixture.html');await wait(`!!document.querySelector('button')`);await click('Start recording');await wait(`!!document.querySelector('.record-clock') && document.querySelector('.record-clock').textContent.includes('s left')`);await click('Stop early');await wait(`!!document.querySelector('audio')`);assert.match(await js(`document.querySelector('.record-sheet').innerText`),/Stopped early/);await click('Cancel');assert.equal(await js('window.uses'),0);assert.equal(await js('window.closedSheet'),true);traces.push({stopEarlyCancel:'passed'})
 await w.loadURL(url+'/fixture.html');await wait(`!!document.querySelector('button')`);await click('Start recording');await wait(`!!document.querySelector('.record-clock')`);await click('Cancel');await new Promise(r=>setTimeout(r,500));assert.equal(await js('window.uses'),0);assert.equal(await js('window.closedSheet'),true);assert.equal(await js(`!!document.querySelector('audio')`),false);traces.push({countdownCancel:'passed'})
 }
 fs.writeFileSync(path.join(out,'trace.json'),JSON.stringify(traces,null,2));console.log(JSON.stringify(traces));app.exit(0)
}).catch(e=>{console.error(e);fs.writeFileSync(path.join(out,'trace.json'),JSON.stringify({traces,error:String(e)},null,2));app.exit(1)})
setTimeout(()=>{console.error('timed out');app.exit(1)},45000)
