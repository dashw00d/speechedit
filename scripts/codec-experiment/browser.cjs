// env -u ELECTRON_RUN_AS_NODE electron scripts/codec-experiment/browser.cjs /tmp/codec-results --no-sandbox
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { tmpdir } = require('node:os')
const { createServer } = require('node:http')
const directory=resolve(process.argv.find((a,i)=>i>1&&!a.startsWith('--'))||'/tmp/codec-results')
const results=JSON.parse(readFileSync(join(directory,'results.json'),'utf8'))
const profile=mkdtempSync(join(tmpdir(),'speechedit-codec-browser-'));app.setPath('userData',profile)
const candidates=results.candidates.filter(c=>c.name.startsWith('opus-'))
const server=createServer((req,res)=>{
 const candidate=candidates.find(c=>'/'+c.file===req.url)
 if(!candidate){res.setHeader('Content-Type','text/html');res.end('<title>Codec benchmark</title>');return}
 const bytes=readFileSync(join(directory,candidate.file));res.setHeader('Content-Type','audio/webm');res.setHeader('Content-Length',bytes.length);res.end(bytes)
})
app.on('quit',()=>{server.close();rmSync(profile,{recursive:true,force:true})})
const deadline=setTimeout(()=>app.exit(1),60000)
app.whenReady().then(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const win=new BrowserWindow({show:false});await win.loadURL('http://127.0.0.1:'+server.address().port)
 const measurements=await win.webContents.executeJavaScript(`(async()=>{
 const results=[];for(const candidate of ${JSON.stringify(candidates)}){
  const started=performance.now(),response=await fetch('/'+candidate.file),bytes=await response.arrayBuffer(),downloadMs=performance.now()-started;
  const context=new AudioContext(),decodeStart=performance.now(),decoded=await context.decodeAudioData(bytes.slice(0)),decodeMs=performance.now()-decodeStart;
  const blob=URL.createObjectURL(new Blob([bytes],{type:'audio/webm'})),audio=document.createElement('audio');audio.src=blob;
  const settled=event=>new Promise((ok,fail)=>{const timeout=setTimeout(()=>fail(Error(event+' timed out')),10000);audio.addEventListener(event,()=>{clearTimeout(timeout);ok()},{once:true});audio.addEventListener('error',()=>{clearTimeout(timeout);fail(Error('Audio failed'))},{once:true})});
  await settled('loadeddata');const seekStart=performance.now(),seek=settled('seeked');audio.currentTime=decoded.duration*0.7;await seek;
  results.push({name:candidate.name,downloadBytes:bytes.byteLength,downloadMs,decodeMs,readyMs:downloadMs+decodeMs,seekMs:performance.now()-seekStart,decodedDuration:decoded.duration,decoderDownloadBytes:0,decoder:'browser native Opus',network:'localhost'});
  audio.removeAttribute('src');audio.load();URL.revokeObjectURL(blob);await context.close();
 }return {userAgent:navigator.userAgent,measurements:results,nolace:'not measured: enhanced browser decoder is not implemented'};
})()`)
 results.browserResults=measurements;writeFileSync(join(directory,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(measurements,null,2));clearTimeout(deadline);win.destroy();app.quit()
}).catch(e=>{console.error(e);app.exit(1)})
