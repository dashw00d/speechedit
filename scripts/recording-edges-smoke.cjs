const {app,BrowserWindow}=require('electron')
process.on('uncaughtException',error=>{console.error(error);app.exit(1)})
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {join,resolve}=require('node:path')
const {spawnSync}=require('node:child_process')
const {createServer}=require('node:http')
const dir=mkdtempSync(join(tmpdir(),'speechedit-edges-'))
app.setPath('userData',join(dir,'profile'))
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
const path=x=>JSON.stringify(resolve(x))
writeFileSync(join(dir,'entry.tsx'),`
import React from ${path('node_modules/react/index.js')};
import {createRoot} from ${path('node_modules/react-dom/client.js')};
import {RecordReplacementSheet} from ${path('src/renderer/src/components/RecordReplacementSheet.tsx')};
import {prepareProjectRecording,prepareReviewRecording} from ${path('src/renderer/src/lib/recordingEdges.ts')};
import {cleanRecordingEdges} from ${path('src/renderer/src/lib/recordingEdgeActions.ts')};
import {projectFromTake} from ${path('src/renderer/src/lib/importMedia.ts')};
import {pcmWave} from ${path('src/renderer/src/lib/recording.ts')};
import {applyCommand} from ${path('src/renderer/src/lib/commands.ts')};
import {projectToExportJob} from ${path('src/renderer/src/lib/exportJob.ts')};
import {sampleProgram} from ${path('src/renderer/src/lib/programLook.ts')};
import {useEditor} from ${path('src/renderer/src/store.ts')};
const wait=async(fn)=>{for(let i=0;i<700;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI did not settle: '+document.body.textContent)};
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const close=(a,b)=>Math.abs(a-b)<.015;
const pcm=new Float32Array(6*48000);for(let i=0;i<pcm.length;i++){const t=i/48000;if(t<1.2||t>=1.5&&t<4.5||t>=4.8)pcm[i]=.2*Math.sin(2*Math.PI*333*t)}
const source=URL.createObjectURL(pcmWave(pcm,48000));
const words=[{id:'before',text:'Before',start:0,end:1.1,deleted:false,speaker:'s'},{id:'selected',text:'Selected passage',start:2,end:4,deleted:false,speaker:'s'},{id:'after',text:'After',start:4.9,end:6,deleted:false,speaker:'s'}];
const project=projectFromTake({asset:{id:'src',path:source,name:'Speech',kind:'audio',duration:6,waveform:[],sourceOffset:0},words,whispered:null,analysis:{silence:[],scenes:{times:[],staticRegions:[]},loudness:[]}});
window.check=async()=>{
 const signal=new AbortController().signal;
 await fetch('/fixture.wav',{method:'POST',body:pcmWave(pcm,48000)});
 await fetch('/chunk.wav',{method:'POST',body:pcmWave(pcm.slice(48000,5*48000),48000)});
 const opusProject={...project,assets:{src:{...project.assets.src,path:location.origin+'/encoded.webm'}}};
 const opus=await prepareProjectRecording(opusProject,{start:2,end:4},signal);
 assert(close(opus.range.start,1.47)&&close(opus.range.end,4.53),'Opus pause detection failed: '+JSON.stringify(opus));
 const prepared=await prepareProjectRecording(project,{start:2,end:4},signal);
 assert(close(prepared.range.start,1.47)&&close(prepared.range.end,4.53),'Actual worker failed pause detection: '+JSON.stringify(prepared));
 const controller=new AbortController();controller.abort();let cancelled=false;try{await prepareProjectRecording(project,{start:2,end:4},controller.signal)}catch(e){cancelled=e.name==='AbortError'}assert(cancelled,'Abort not respected');
 const scoped=await prepareReviewRecording({id:'test',snapshot:{sourceDuration:6,scope:{start:1.8,end:4.2},words,assets:[{id:'src',sourceOffset:0,duration:6}],cuts:[],protected:[]},proposals:[],delivery:undefined},{start:2,end:4},signal);
 assert(scoped.range.start===2&&scoped.range.end===4,'Crossed shared scope');
 const progressive=await prepareReviewRecording({id:'test',snapshot:{sourceDuration:6,scope:{start:1,end:5},words,assets:[],cuts:[],protected:[]},proposals:[],delivery:{representations:[{id:'part',kind:'audio',start:1000000,end:5000000}]}},{start:2,end:4},signal);
 assert(close(progressive.range.start,1.47)&&close(progressive.range.end,4.53),'Progressive chunk offset lost: '+JSON.stringify(progressive));
 const activeAbort=new AbortController();const active=prepareProjectRecording(project,{start:2,end:4},activeAbort.signal);activeAbort.abort();let stopped=false;try{await active}catch(e){stopped=e.name==='AbortError'}assert(stopped,'Active workers did not cancel');
 const root=createRoot(document.getElementById('root'));let saved=null;
 root.render(React.createElement(RecordReplacementSheet,{words:'Selected passage',duration:2,prepare:s=>prepareProjectRecording(project,{start:2,end:4},s),onClose:()=>{},onUse:async(audio,s,range)=>{saved={duration:audio.duration,range}}}));
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 await wait(()=>button('Start recording'));assert(document.body.textContent.includes('Aligned to nearby pauses'),'Did not explain adjustment');
 button('Start recording').click();await wait(()=>document.querySelector('audio'));button('Use recording').click();await wait(()=>saved);
 assert(close(saved.duration,3.06)&&close(saved.range.start,1.47)&&close(saved.range.end,4.53),'Recorded/submitted different slot: '+JSON.stringify(saved));
 const asset={id:'take',path:source,name:'Take',kind:'audio',duration:2,waveform:[],isRecording:true};
 useEditor.getState().loadProject(applyCommand(project,{type:'replaceRangeAudio',start:2,end:4,asset}),{persist:false});
 const before=useEditor.getState().project,clip=before.tracks.find(t=>t.id==='voice_replacements').clips[0];
 const message=await cleanRecordingEdges(clip.id),after=useEditor.getState().project,job=projectToExportJob(after);
 assert(after.tracks.find(t=>t.id==='voice_replacements').clips[0].start===2,'Moved saved take');
 assert(sampleProgram(job,1.6).voice.gain===0&&sampleProgram(job,4.4).voice.gain===0,'Original edge was not muted');
 useEditor.getState().undo();assert(useEditor.getState().project===before,'Cleanup was not one undo');
 root.unmount();URL.revokeObjectURL(source);
 return {prepared,opus:opus.range,saved,scoped:scoped.range,progressive:progressive.range,cancelled,activeCancelled:stopped,existingTakeCleanup:message,undo:true};
};
`)
for(const [entry,out] of [[join(dir,'entry.tsx'),join(dir,'bundle.js')],[resolve('src/renderer/src/workers/audioEdges.worker.ts'),join(dir,'worker.js')]]){
const b=spawnSync('bun',['build',entry,'--target=browser','--define','process.env.NODE_ENV="development"','--outfile',out],{encoding:'utf8'});if(b.status)throw Error(b.stderr)
}
const server=createServer(async(req,res)=>{
if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);writeFileSync(join(dir,req.url.slice(1)),Buffer.concat(chunks));if(req.url==='/fixture.wav'){const encoded=spawnSync('ffmpeg',['-v','error','-y','-i',join(dir,'fixture.wav'),'-c:a','libopus',join(dir,'encoded.webm')]);if(encoded.status)throw Error(encoded.stderr.toString())}res.end('ok');return}
if(req.url==='/encoded.webm'){res.setHeader('Content-Type','audio/webm');res.end(readFileSync(join(dir,'encoded.webm')));return}
if(req.url.includes('/media/')||req.url.includes('/representations/')){res.setHeader('Content-Type','audio/wav');res.end(readFileSync(join(dir,req.url.includes('/representations/')?'chunk.wav':'fixture.wav')));return}
const file=req.url.includes('audioEdges.worker')?'worker.js':req.url==='/bundle.js'?'bundle.js':null;
res.setHeader('Content-Type',file?'text/javascript':'text/html');res.end(file?readFileSync(join(dir,file)):'<div id="root"></div><script type="module" src="/bundle.js"></script>')
})
app.on('quit',()=>{server.close();rmSync(dir,{recursive:true,force:true})})
const deadline=setTimeout(()=>app.exit(1),45000)
app.whenReady().then(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});win.webContents.setAudioMuted(true);win.webContents.on('console-message',(_e,_l,m)=>console.log(m));await win.loadURL('http://127.0.0.1:'+server.address().port);console.log(JSON.stringify(await win.webContents.executeJavaScript('window.check()')));clearTimeout(deadline);win.destroy();app.quit()}).catch(e=>{console.error(e);app.exit(1)})
