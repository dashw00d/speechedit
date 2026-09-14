// Local, private corpus: real transcribed speech through Monitor, Timeline, and Chromium audio.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createServer } = require('node:http')
const corpus = process.env.SPEECHEDIT_SPEECH_CORPUS || '/tmp/speechedit-real-speech'
const stallPicture = process.env.SPEECHEDIT_STALL_VIDEO === '1'
const cutStress = process.env.SPEECHEDIT_CUTS === '1'
const dir = mkdtempSync(join(tmpdir(), 'speechedit-real-playback-'))
app.setPath('userData', join(dir, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const path = value => JSON.stringify(resolve(value))
const cues = JSON.parse(readFileSync(join(corpus, 'transcript.log'), 'utf8')).cues
writeFileSync(join(dir, 'entry.tsx'), `
import React from ${path('node_modules/react/index.js')}
import { createRoot } from ${path('node_modules/react-dom/client.js')}
import { Monitor } from ${path('src/renderer/src/components/Monitor.tsx')}
import { Timeline } from ${path('src/renderer/src/components/Timeline.tsx')}
import { useEditor, usePlayback } from ${path('src/renderer/src/store.ts')}
import { projectFromTake } from ${path('src/renderer/src/lib/importMedia.ts')}
import { applyCommand } from ${path('src/renderer/src/lib/commands.ts')}
import { pcmWave } from ${path('src/renderer/src/lib/recording.ts')}
import { programLengthOf } from ${path('src/renderer/src/lib/resolver.ts')}
import { projectToExportJob } from ${path('src/renderer/src/lib/exportJob.ts')}
import ${path('src/renderer/src/styles.css')}
import ${path('src/renderer/src/themes/dashwood.css')}
document.documentElement.dataset.theme='dashwood';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async fn=>{for(let i=0;i<2500;i++){if(fn())return;await delay(20)}throw Error('Playback failed to settle '+JSON.stringify({program:usePlayback.getState().programTime,playing:usePlayback.getState().playing,media:[...document.querySelectorAll('video,audio')].map(e=>({src:e.src,time:e.currentTime,ended:e.ended,paused:e.paused,ready:e.readyState,seeking:e.seeking}))}))};
const root=createRoot(document.getElementById('root'));
const render=key=>root.render(React.createElement(React.Fragment,{key},React.createElement(Monitor),React.createElement(Timeline)));
render('initial');
window.check=async()=>{
 const results=[];
 for(const kind of ${JSON.stringify((process.env.SPEECHEDIT_CASES || 'original,shared,replaced,loaded').split(','))}){
  console.log('Starting '+kind);render(kind);await delay(100);
  const source=location.origin+(kind==='original'?'/source.mp4':'/shared.webm');
  let project=projectFromTake({asset:{id:'source',path:source,name:'Training speech',kind:'video',duration:25,fps:30,width:640,height:360,waveform:[],sourceOffset:0},words:${JSON.stringify(cues)}.map((w,i)=>({...w,id:'w'+i,deleted:false,speaker:'staff'})),whispered:null,analysis:{silence:[],scenes:{times:[],staticRegions:[]},loudness:[]}});
  if(kind==='replaced')for(const id of ['owner','collaborator'])project=applyCommand(project,{type:'replaceRangeAudio',start:0,end:4.56,asset:{id,path:location.origin+'/replacement.mp3',name:id,kind:'audio',duration:4.56,waveform:[],isRecording:true}});
  if(${JSON.stringify(cutStress)})for(const start of [2,4,6,8,10,12,14,16,18,20,22])project=applyCommand(project,{type:'deleteRange',start,end:start+0.2});
  const expected=programLengthOf(project);
  useEditor.getState().loadProject(project,{persist:false});usePlayback.setState({playing:false,programTime:0,loop:false,loopFrom:null,playUntil:null,pixelsPerSecond:160});
  await wait(()=>document.querySelector('.monitor video')?.readyState>=2 && [...document.querySelectorAll('audio')].every(e=>e.readyState>=2));
  const nodes=[...document.querySelectorAll('.monitor video,.monitor audio')];
  const context=new AudioContext({sampleRate:48000});await context.resume();
  const sources=nodes.filter(e=>e.src).map(e=>context.createMediaElementSource(e));
  const worklet=URL.createObjectURL(new Blob(["class Capture extends AudioWorkletProcessor { constructor(){super();this.live=false;this.buffer=new Float32Array(4096);this.used=0;this.port.onmessage=e=>{if(e.data==='start')this.live=true;else{this.live=false;this.flush();this.port.postMessage({done:true})}}} flush(){if(this.used){const pcm=this.buffer.slice(0,this.used);this.port.postMessage({pcm},[pcm.buffer]);this.used=0}} process(inputs){if(this.live&&inputs[0]?.[0]){const a=inputs[0][0],b=inputs[0][1]||a;for(let i=0;i<a.length;i++){this.buffer[this.used++]=(a[i]+b[i])/2;if(this.used===4096)this.flush()}}return true}} registerProcessor('capture-output',Capture);"],{type:'text/javascript'}));
  await context.audioWorklet.addModule(worklet);URL.revokeObjectURL(worklet);
  const processor=new AudioWorkletNode(context,'capture-output'),chunks=[];
  let finishCapture;const captured=new Promise(resolve=>finishCapture=resolve);
  processor.port.onmessage=e=>{if(e.data.pcm)chunks.push(e.data.pcm);if(e.data.done)finishCapture()};
  sources.forEach(s=>s.connect(processor));processor.connect(context.destination);
  const seeks=[], plays=[]; const desc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
  nodes.forEach((el,index)=>{Object.defineProperty(el,'currentTime',{configurable:true,get(){return desc.get.call(this)},set(to){if(usePlayback.getState().playing)seeks.push({index,from:desc.get.call(this),to});desc.set.call(this,to)}});const play=el.play.bind(el);el.play=()=>{plays.push(index);return play()}});
  const timeline=document.querySelector('.timeline-body'),outside=[];let maxScroll=0,samples=0,outsideCount=0;
  if(!timeline.clientWidth)throw Error('The test must show the timeline pane');
  const follow=setInterval(()=>{if(!usePlayback.getState().playing)return;const bounds=document.querySelector('.timeline-overlay').getBoundingClientRect(),marker=document.querySelector('.playhead').getBoundingClientRect();maxScroll=Math.max(maxScroll,timeline.scrollLeft);samples++;if(marker.left<bounds.left-2||marker.left>bounds.right-2){outsideCount++;if(outside.length<5)outside.push({time:usePlayback.getState().programTime,left:marker.left,bounds:[bounds.left,bounds.right]})}},50);
  const visualBacksteps=[];let markerRaf=0,lastMarker=null;
  const measureMarker=()=>{
    if(usePlayback.getState().playing){
      const current={time:usePlayback.getState().programTime,left:document.querySelector('.playhead').getBoundingClientRect().left};
      if(lastMarker && current.time>=lastMarker.time && current.left<lastMarker.left-0.05)visualBacksteps.push({before:lastMarker,after:current});
      lastMarker=current;
    }
    markerRaf=requestAnimationFrame(measureMarker);
  };
  markerRaf=requestAnimationFrame(measureMarker);
  let buffering=false,stalls=0;
  const picturePlay=nodes[0].play.bind(nodes[0]);nodes[0].play=()=>buffering?Promise.resolve():picturePlay();
  const stall=${JSON.stringify(stallPicture)}&&kind==='replaced'?setInterval(()=>{
    if(!usePlayback.getState().playing||usePlayback.getState().programTime>4.4||buffering)return;
    stalls++;buffering=true;nodes[0].pause();setTimeout(()=>{buffering=false;if(usePlayback.getState().playing)void nodes[0].play()},300);
  },600):null;
  let blocked=false;
  const load=kind==='loaded'?setInterval(()=>{
    // Put the delayed frame across a spoken cut, rather than depending on the
    // periodic load happening to land inside a deleted interval.
    if(${JSON.stringify(cutStress)}){const time=nodes[0]?.currentTime;if(blocked||time<5.8||time>=6)return;blocked=true;}
    const end=performance.now()+300;while(performance.now()<end){}
  },${cutStress ? 5 : 600}):null;
  processor.port.postMessage('start');usePlayback.getState().playFromSource(0);await wait(()=>!usePlayback.getState().playing);if(load)clearInterval(load);if(stall)clearInterval(stall);clearInterval(follow);cancelAnimationFrame(markerRaf);processor.port.postMessage('stop');await captured;
  const pcm=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;chunks.forEach(c=>{pcm.set(c,offset);offset+=c.length});
  await fetch('/capture-'+kind+'.wav',{method:'POST',body:pcmWave(pcm,48000)});
  const backwards=seeks.filter(s=>s.to<s.from-0.04);
  const result={kind,seeks,plays,backwards,stalls,follow:{samples,maxScroll,outsideCount,outside,visualBacksteps},capturedSeconds:pcm.length/48000,expected,program:usePlayback.getState().programTime};results.push(result);console.log(JSON.stringify(result));
  if(stall && (!stalls || seeks.some(s=>s.index>0)))throw Error('Picture buffering sought replacement audio: '+JSON.stringify(result));
  if(backwards.length || Math.abs(pcm.length/48000-expected)>1)throw Error('Speech repeated or playback stalled: '+JSON.stringify(result));
  if(!samples||!maxScroll||outside.length||visualBacksteps.length)throw Error('Timeline lost the playhead: '+JSON.stringify(result.follow));
  timeline.scrollLeft=123;usePlayback.getState().seekProgram(0);await delay(100);
  if(Math.abs(timeline.scrollLeft-123)>1)throw Error('Paused seeking moved the timeline');
  usePlayback.getState().playFromSource(0);await delay(200);
  if(timeline.scrollLeft>10)throw Error('Restart did not bring the playhead back into view');
  usePlayback.getState().setPixelsPerSecond(220);await delay(100);
  usePlayback.getState().pause();
  processor.disconnect();sources.forEach(s=>s.disconnect());await context.close();
  // Remount so each real media element has only one Web Audio source.
  useEditor.getState().loadProject({...project,assets:{}},{persist:false});await delay(100);
 }
 return results;
};
`)
const build=spawnSync('bun',['build',join(dir,'entry.tsx'),'--target=browser','--define','process.env.NODE_ENV="development"','--outdir',dir,'--entry-naming','bundle.[ext]'],{encoding:'utf8'})
if(build.status){console.error(build.stderr);process.exit(1)}
const server=createServer(async(req,res)=>{
 if(req.method==='POST' && /^\/capture-(original|shared|replaced|loaded)\.wav$/.test(req.url)){const chunks=[];for await(const c of req)chunks.push(c);writeFileSync(join(corpus,req.url.slice(1)),Buffer.concat(chunks));res.end('saved');return}
 const name=req.url.slice(1);const file=['source.mp4','shared.webm','replacement.mp3'].includes(name)?join(corpus,name):name==='bundle.js'||name==='bundle.css'?join(dir,name):null;
 if(!file){res.setHeader('Content-Type','text/html');res.end('<link rel="stylesheet" href="/bundle.css"><style>#root{height:100vh;display:grid;grid-template-rows:minmax(0,1fr) auto}</style><div id="root" class="app" data-mobile-pane="timeline"></div><script type="module" src="/bundle.js"></script>');return}
 const bytes=readFileSync(file),m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=m?Number(m[1]):0,end=m&&m[2]?Math.min(bytes.length-1,Number(m[2])):bytes.length-1;
 res.writeHead(m?206:200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.mp3')?'audio/mpeg':name.endsWith('.mp4')?'video/mp4':'video/webm','Accept-Ranges':'bytes','Content-Length':end-start+1,...(m?{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}:{})});res.end(bytes.subarray(start,end+1));
})
app.on('quit',()=>{server.close();rmSync(dir,{recursive:true,force:true})})
const deadline=setTimeout(()=>{console.error('Real speech playback timed out');app.exit(1)},180000)
app.whenReady().then(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const win=new BrowserWindow({show:true,width:Number(process.env.SPEECHEDIT_VIEWPORT_WIDTH||1400),webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_e,_l,message)=>{console.log(message)});
 win.webContents.setAudioMuted(true);
 await win.loadURL('http://127.0.0.1:'+server.address().port);console.log(JSON.stringify(await win.webContents.executeJavaScript('window.check()')));clearTimeout(deadline);win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)})
