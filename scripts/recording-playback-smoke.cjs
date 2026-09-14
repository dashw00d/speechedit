// Actual Chromium media elements and the application playback engine at EOF.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createServer } = require('node:http')
const dir = mkdtempSync(join(tmpdir(), 'speechedit-recording-playback-'))
app.setPath('userData', join(dir, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
const path = value => JSON.stringify(resolve(value))
writeFileSync(join(dir, 'entry.tsx'), `
import React from ${path('node_modules/react/index.js')}
import { createRoot } from ${path('node_modules/react-dom/client.js')}
import { Monitor } from ${path('src/renderer/src/components/Monitor.tsx')}
import { useEditor, usePlayback } from ${path('src/renderer/src/store.ts')}
import { projectFromTake } from ${path('src/renderer/src/lib/importMedia.ts')}
import { applyCommand } from ${path('src/renderer/src/lib/commands.ts')}
import { pcmWave } from ${path('src/renderer/src/lib/recording.ts')}
import { programLengthOf } from ${path('src/renderer/src/lib/resolver.ts')}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async fn => { for(let i=0;i<300;i++){ if(fn())return; await delay(20); } throw Error('Playback failed to settle: '+JSON.stringify({playing:usePlayback.getState().playing,time:usePlayback.getState().programTime,media:[...document.querySelectorAll('video,audio')].map(e=>({tag:e.tagName,src:e.src,time:e.currentTime,duration:e.duration,paused:e.paused,ended:e.ended,seeking:e.seeking,ready:e.readyState}))})); };
createRoot(document.getElementById('root')).render(React.createElement(Monitor));
const audio = duration => URL.createObjectURL(pcmWave(new Float32Array(Math.round(duration*48000)).fill(0.1),48000));
window.check = async () => {
  const results=[];
  for (const { recorded, stallPicture } of [{recorded:0.25}, {recorded:1.49}, {recorded:1.49,stallPicture:true}]) {
    // Source metadata and MP3 decoders can disagree by a fraction of a frame.
    const source=audio(1.99), first=audio(1.5), second=audio(recorded);
    let project=projectFromTake({asset:{id:'source',path:source,name:'Source',kind:'audio',duration:2,waveform:[],sourceOffset:0},words:[{id:'w',text:'Replace this passage',start:0.5,end:2,deleted:false,speaker:'s'}],whispered:null,analysis:{silence:[],scenes:{times:[],staticRegions:[]},loudness:[]}});
    for(const [id,url] of [['owner',first],['collaborator',second]]) project=applyCommand(project,{type:'replaceRangeAudio',start:0.5,end:2,asset:{id,path:url,name:id,kind:'audio',duration:1.5,waveform:[],isRecording:true}});
    if(project.tracks.find(t=>t.id==='voice_replacements').clips.length!==1 || programLengthOf(project)!==2)throw Error('Second take did not replace the full slot');
    useEditor.getState().loadProject(project,{persist:false}); usePlayback.setState({playing:false,programTime:0,loop:false,loopFrom:null,playUntil:null});
    await wait(()=>document.querySelector('audio[data-bed]')?.readyState>=2 && document.querySelector('.monitor video')?.readyState>=2);
    const bed=document.querySelector('audio[data-bed]'), video=document.querySelector('.monitor video');
    let bedEnds=0, videoEnds=0, plays=0, backward=0, silenceFrames=0, last=0, audioSeeks=0, stalls=0;
    const timeProperty=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
    Object.defineProperty(bed,'currentTime',{configurable:true,get(){return timeProperty.get.call(this)},set(value){if(usePlayback.getState().playing&&!this.paused)audioSeeks++;timeProperty.set.call(this,value)}});
    let buffering=false;
    const picturePlay=video.play.bind(video);
    video.play=()=>buffering?Promise.resolve():picturePlay();
    const stall=stallPicture?setInterval(()=>{
      const time=usePlayback.getState().programTime;
      if(!usePlayback.getState().playing||time<0.6||time>1.6||buffering)return;
      stalls++;buffering=true;video.pause();setTimeout(()=>{buffering=false;if(usePlayback.getState().playing)void video.play()},250);
    },300):null;
    bed.addEventListener('ended',()=>bedEnds++); video.addEventListener('ended',()=>videoEnds++);
    const nativePlay=bed.play.bind(bed); bed.play=()=>{plays++;return nativePlay();};
    const unsub=usePlayback.subscribe(state=>{
      if(state.playing && state.programTime+0.001<last)backward++;
      last=state.programTime;
      if(state.playing && state.programTime>0.5+recorded+0.04 && state.programTime<2){
        silenceFrames++;
        if(video.volume!==0 || bed.volume!==0 || !bed.paused)throw Error('Replacement tail was not silent');
      }
    });
    usePlayback.getState().playFromSource(0);
    await wait(()=>!usePlayback.getState().playing);
    unsub();if(stall)clearInterval(stall);
    if(stallPicture && (!stalls || audioSeeks))throw Error('Picture buffering interrupted replacement audio: '+JSON.stringify({stalls,audioSeeks}));
    if(usePlayback.getState().programTime!==2 || bedEnds>1 || videoEnds>1 || plays!==1 || backward || (recorded===0.25 && !silenceFrames))throw Error(JSON.stringify({recorded,time:usePlayback.getState().programTime,bedEnds,videoEnds,plays,backward,silenceFrames}));
    // Seeking back intentionally must still replay an exhausted recording.
    usePlayback.getState().seekProgram(0); await delay(50); usePlayback.getState().playFromSource(0);
    await wait(()=>!usePlayback.getState().playing);
    if(bedEnds>2 || videoEnds>2 || plays!==2)throw Error('Intentional replay failed: '+JSON.stringify({bedEnds,videoEnds,plays}));
    results.push({recorded,stallPicture:!!stallPicture,stalls,audioSeeks,fullSlot:1.5,plays,bedEnds,videoEnds,silenceFrames,backward});
    for(const url of [source,first,second])URL.revokeObjectURL(url);
  }
  return {sequentialOwnerAndCollaboratorTakes:true,shortTailSilent:true,programStops:true,intentionalReplay:true,results};
};
`)
const build = spawnSync('bun', ['build', join(dir, 'entry.tsx'), '--target=browser', '--define', 'process.env.NODE_ENV="development"', '--outfile', join(dir, 'bundle.js')], { encoding: 'utf8' })
if (build.status) throw Error(build.stderr)
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html')
  res.end(req.url === '/bundle.js' ? readFileSync(join(dir, 'bundle.js')) : '<div id="root"></div><script type="module" src="/bundle.js"></script>')
})
app.on('quit', () => { server.close(); rmSync(dir, { recursive: true, force: true }) })
const deadline = setTimeout(() => { console.error('Recording playback smoke timed out'); app.exit(1) }, 60_000)
app.whenReady().then(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const win = new BrowserWindow({ show: true, webPreferences: { backgroundThrottling: false } })
  win.webContents.setAudioMuted(true);
  await win.loadURL('http://127.0.0.1:'+server.address().port)
  console.log(JSON.stringify(await win.webContents.executeJavaScript('window.check()')))
  clearTimeout(deadline); win.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
