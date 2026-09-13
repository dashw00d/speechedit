// Local, private corpus: real transcribed speech through Monitor, Timeline, and Chromium audio.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createServer } = require('node:http')
const corpus = process.env.SPEECHEDIT_SPEECH_CORPUS || '/tmp/speechedit-real-speech'
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
import { projectToExportJob } from ${path('src/renderer/src/lib/exportJob.ts')}
import ${path('src/renderer/src/styles.css')}
import ${path('src/renderer/src/themes/dashwood.css')}
document.documentElement.dataset.theme='dashwood';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(Monitor),React.createElement(Timeline)));
window.check=async()=>{
 let project=projectFromTake({asset:{id:'source',path:location.origin+'/shared.webm',name:'Training speech',kind:'video',duration:25,fps:30,width:640,height:360,waveform:[],sourceOffset:0},words:${JSON.stringify(cues)}.map((w,i)=>({...w,id:'w'+i,deleted:false,speaker:'staff'})),whispered:null,analysis:{silence:[],scenes:{times:[],staticRegions:[]},loudness:[]}});
 project=applyCommand(project,{type:'addCaption',start:0,duration:25,text:'Track eye keeps its place'});
 project=applyCommand(project,{type:'addOverlay',start:0,duration:25,text:'Hidden output'});
 useEditor.getState().loadProject(project,{persist:false});await delay(500);
 const results=[];
 for(const id of ['v1','a1','v2','v3']){
  const label=()=>document.querySelector('[data-track-id="'+id+'"]');
  const before=label().getBoundingClientRect().height;
  const rows=[...document.querySelectorAll('.track-label[data-track-id]')].map(e=>e.dataset.trackId);
  label().querySelector('[aria-label="Hide track"]').click();await delay(100);
  if(!label())throw Error('Eye removed '+id+' from the timeline');
  const after=label().getBoundingClientRect().height;
  const currentRows=[...document.querySelectorAll('.track-label[data-track-id]')].map(e=>e.dataset.trackId);
  if(JSON.stringify(rows)!==JSON.stringify(currentRows) || after>=before || after<28)throw Error('Hidden row did not stay compact and usable '+JSON.stringify({id,before,after}));
  const lane=label().closest('.timeline-row').querySelector('.media-lane');
  if(getComputedStyle(lane).filter!=='grayscale(1)')throw Error('Hidden row was not grayed out');
  if(!useEditor.getState().project.tracks.find(t=>t.id===id).hidden)throw Error('Output was not disabled');
  label().querySelector('[aria-label="Show track"]').click();await delay(100);
  if(label().getBoundingClientRect().height!==before)throw Error('Eye did not restore row height');
  results.push({id,before,hiddenHeight:after,restored:true});
 }
 document.querySelector('[data-track-id="v2"] [aria-label="Hide track"]').click();await delay(100);
 document.querySelector('.timeline-panel').scrollIntoView();
 return {visibleDisabledTracks:true,results};
};
`)
const build=spawnSync('bun',['build',join(dir,'entry.tsx'),'--target=browser','--define','process.env.NODE_ENV="development"','--outdir',dir,'--entry-naming','bundle.[ext]'],{encoding:'utf8'})
if(build.status){console.error(build.stderr);process.exit(1)}
const server=createServer(async(req,res)=>{
 if(req.method==='POST' && /^\/capture-(original|shared|replaced|loaded)\.wav$/.test(req.url)){const chunks=[];for await(const c of req)chunks.push(c);writeFileSync(join(corpus,req.url.slice(1)),Buffer.concat(chunks));res.end('saved');return}
 const name=req.url.slice(1);const file=['source.mp4','shared.webm','replacement.mp3'].includes(name)?join(corpus,name):name==='bundle.js'||name==='bundle.css'?join(dir,name):null;
 if(!file){res.setHeader('Content-Type','text/html');res.end('<link rel="stylesheet" href="/bundle.css"><style>#root{height:100vh;display:grid;grid-template-rows:minmax(0,1fr) auto}</style><div id="root"></div><script type="module" src="/bundle.js"></script>');return}
 const bytes=readFileSync(file),m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=m?Number(m[1]):0,end=m&&m[2]?Math.min(bytes.length-1,Number(m[2])):bytes.length-1;
 res.writeHead(m?206:200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.mp3')?'audio/mpeg':name.endsWith('.mp4')?'video/mp4':'video/webm','Accept-Ranges':'bytes','Content-Length':end-start+1,...(m?{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}:{})});res.end(bytes.subarray(start,end+1));
})
app.on('quit',()=>{server.close();rmSync(dir,{recursive:true,force:true})})
const deadline=setTimeout(()=>{console.error('Real speech playback timed out');app.exit(1)},180000)
app.whenReady().then(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const win=new BrowserWindow({show:true,width:1400,height:1000,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_e,_l,message)=>{console.log(message)});
 await win.loadURL('http://127.0.0.1:'+server.address().port);console.log(JSON.stringify(await win.webContents.executeJavaScript('window.check()')));writeFileSync(join(corpus,'track-visibility.png'),(await win.webContents.capturePage()).toPNG());clearTimeout(deadline);win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1)})
