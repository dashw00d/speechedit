const { app, BrowserWindow } = require('electron')
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const dir=mkdtempSync(join(tmpdir(),'speechedit-progressive-')), corpus=process.env.SPEECHEDIT_SPEECH_CORPUS || '/tmp/speechedit-real-speech'
const origin=process.argv.find(a=>/^https?:/.test(a)) || 'http://127.0.0.1:5187'
app.setPath('userData',join(dir,'profile'));app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
app.on('window-all-closed',()=>{})
app.on('quit',()=>rmSync(dir,{recursive:true,force:true}))
const wait=async(win,expression)=>{for(let i=0;i<1200;i++){if(await win.webContents.executeJavaScript(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out: '+expression+' '+await win.webContents.executeJavaScript('document.body.innerText'))}
let senderWindow
async function cleanup(){if(senderWindow&&!senderWindow.isDestroyed()){const bindings=await senderWindow.webContents.executeJavaScript('window.test?.rooms || []').catch(()=>[]);await Promise.all(bindings.map(b=>fetch(origin+'/api/reviews/'+b.id,{method:'DELETE',headers:{Authorization:'Bearer '+b.ownerKey}}).catch(()=>undefined)))}}
const deadline=setTimeout(()=>app.exit(1),120000)
app.whenReady().then(async()=>{
 const sender=new BrowserWindow({show:true,webPreferences:{partition:'sender',backgroundThrottling:false}})
 senderWindow=sender
 await sender.loadURL(origin)
 const bytes=readFileSync(join(corpus,'source.mp4')).toString('base64'),cues=JSON.parse(readFileSync(join(corpus,'transcript.log'),'utf8')).cues
 await sender.webContents.executeJavaScript(`(async()=>{
  const {registerBrowserMedia}=await import('/src/lib/browserMediaStore.ts'),{projectFromTake}=await import('/src/lib/importMedia.ts'),{snapshotForReview}=await import('/src/lib/reviewProject.ts'),{scopeReviewSnapshot}=await import('/@fs${resolve('src/shared/reviewMedia.ts')}'),api=await import('/src/lib/reviewApi.ts'),{deliverReview}=await import('/src/lib/reviewDelivery.ts');
  const file=new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],'Training.mp4',{type:'video/mp4',lastModified:1}),path=await registerBrowserMedia(file);
  const project=projectFromTake({asset:{id:'source',path,name:'Real speech',kind:'video',duration:25,sourceOffset:0,waveform:[]},words:${JSON.stringify(cues)}.filter(w=>w.start<25).map((w,i)=>({...w,start:Math.max(0,w.start),end:Math.min(25,w.end),id:'w'+i,deleted:false,speaker:'staff'})),whispered:null,analysis:{silence:[],scenes:{times:[],staticRegions:[]},loudness:[]}});
  const snapshot=scopeReviewSnapshot(snapshotForReview(project),{start:5,end:17}),controller=new AbortController(),made=await api.createReview(snapshot,controller.signal,undefined,true);
  const binding={id:made.room.id,projectId:project.id,ownerKey:made.ownerKey,reviewerKey:made.reviewerKey,mode:'audit'};window.test={binding,project,snapshot,updates:[],done:false,rooms:[binding]};
  const nativeFetch=window.fetch;window.test.nativeFetch=nativeFetch;window.fetch=async(url,options)=>{if(options?.headers?.['X-Review-Representation']){const r=JSON.parse(options.headers['X-Review-Representation']);if(r.kind==='audio'&&r.start>5000000)await new Promise(r=>setTimeout(r,4000))}return nativeFetch(url,options)};
  window.test.promise=deliverReview(project,snapshot,binding,controller.signal,(room,ratio,metrics)=>{window.test.room=room;window.test.updates.push({state:room.delivery.state,audio:room.delivery.representations.filter(r=>r.kind==='audio').length,metrics});if(room.published)window.test.link=api.reviewLink(binding)}).then(room=>{window.test.room=room;window.test.done=true}).catch(e=>{window.test.error=e.message});
 })()`)
 await wait(sender,'window.test?.link || window.test?.error')
 const initial=await sender.webContents.executeJavaScript('({link:window.test.link,error:window.test.error,done:window.test.done,room:window.test.room})')
 if(initial.error)throw Error(initial.error)
 if(initial.done || initial.room.delivery.representations.filter(r=>r.kind==='audio').length!==1)throw Error('Review was not published early')
 const friend=new BrowserWindow({show:true,webPreferences:{partition:'friend',backgroundThrottling:false}})
 await friend.loadURL(process.env.SPEECHEDIT_REVIEW_RECIPIENT_ORIGIN ? initial.link.replace(origin, process.env.SPEECHEDIT_REVIEW_RECIPIENT_ORIGIN) : initial.link)
 await wait(friend,"!!document.querySelector('.review-player button')")
 await friend.webContents.executeJavaScript(`(async()=>{
  const resume=AudioContext.prototype.resume,connect=AudioNode.prototype.connect;window.captured=[];
  AudioContext.prototype.resume=async function(){await resume.call(this);if(this.testCapture)return;const context=this;window.captureRate=this.sampleRate;
   const code="class Capture extends AudioWorkletProcessor{process(inputs,outputs){const channel=inputs[0]?.[0];if(channel){outputs[0][0].set(channel);this.port.postMessage(channel.slice())}return true}}registerProcessor('capture',Capture)";
   const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));await this.audioWorklet.addModule(url);URL.revokeObjectURL(url);
   this.testCapture=new AudioWorkletNode(this,'capture');this.testCapture.port.onmessage=e=>window.captured.push(e.data);connect.call(this.testCapture,this.destination);
  };
  AudioNode.prototype.connect=function(target,...args){return connect.call(this,target===this.context.destination&&this instanceof AudioBufferSourceNode ? this.context.testCapture : target,...args)};
 })()`)
 await friend.webContents.executeJavaScript("window.audioSchedules=[];const original=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const node=original.call(this),start=node.start.bind(node);node.start=(at,offset,duration)=>{window.audioSchedules.push({at,offset,duration});return start(at,offset,duration)};return node};document.querySelector('.review-player button').click()")
 await wait(friend,"document.querySelector('.review-player [role=status]')?.textContent.includes('Waiting') || Number(document.querySelector('.review-player input').value)>5.1")
 await wait(sender,'window.test.done || window.test.error')
 const result=await sender.webContents.executeJavaScript('({room:window.test.room,updates:window.test.updates,error:window.test.error})')
 if(result.error)throw Error(result.error)
 if(result.room.snapshot.words.some(w=>w.start<5||w.end>17)||result.room.snapshot.assets.some(a=>a.waveform.length))throw Error('Private context leaked')
 const rows=result.room.delivery.representations;if(rows.some(r=>r.start<5000000||r.end>17000000))throw Error('Media outside selected passage')
 await wait(friend,"Number(document.querySelector('.review-player input').value)===17 && document.querySelector('.review-player button').textContent==='Play audio'")
 const capture=await friend.webContents.executeJavaScript(`({rate:window.captureRate,samples:window.captured.flatMap(c=>Array.from(c))})`)
 const wav=Buffer.alloc(44+capture.samples.length*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(capture.rate,24);wav.writeUInt32LE(capture.rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);capture.samples.forEach((x,i)=>wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),44+i*2));writeFileSync(join(corpus,'capture-progressive.wav'),wav)
 const recipient=await friend.webContents.executeJavaScript(`({readyMs:performance.getEntriesByName('review-open-to-first-audio-and-image')[0]?.duration,schedules:window.audioSchedules,editorDownloaded:performance.getEntriesByType('resource').some(r=>/\\/(?:src\\/App\\.tsx|assets\\/App-)/.test(r.name))})`)
 if(recipient.editorDownloaded || !recipient.readyMs || recipient.schedules.some((r,i,a)=>i&&r.at<a[i-1].at+a[i-1].duration-0.00001)||Math.abs(recipient.schedules.reduce((n,r)=>n+r.duration,0)-12)>0.001)throw Error('Recipient audio overlaps or does not fill the passage: '+JSON.stringify(recipient))
 const extra=await sender.webContents.executeJavaScript(`(async()=>{
  window.fetch=window.test.nativeFetch;const api=await import('/src/lib/reviewApi.ts'),{deliverReview}=await import('/src/lib/reviewDelivery.ts'),{provideReviewVideo}=await import('/src/lib/useReviewDetails.ts');
  const {project,snapshot}=window.test,created=await api.createReview(snapshot,undefined,undefined,true),binding={...window.test.binding,id:created.room.id,ownerKey:created.ownerKey,reviewerKey:created.reviewerKey};window.test.rooms.push(binding);
  const controller=new AbortController();let partial;try{await deliverReview(project,snapshot,binding,controller.signal,room=>{partial=room;if(room.published)controller.abort()})}catch(e){if(!controller.signal.aborted)throw e}
  partial=await api.reviewRequest('/'+binding.id+'/delivery',binding.ownerKey,'POST',{state:'partial'});
  await api.reviewRequest('/'+binding.id+'/proposals',binding.reviewerKey,'POST',{revision:partial.revision,author:'Smoke reviewer',text:'Feedback survives resume',start:6,end:7});
  partial=await api.reviewRequest('/'+binding.id,binding.ownerKey);const ids=partial.delivery.representations.map(r=>r.id);let metrics;const resumed=await deliverReview(project,snapshot,binding,new AbortController().signal,(_r,_p,m)=>metrics=m,partial);
  if(resumed.proposals.length!==1||!ids.every(id=>resumed.delivery.representations.some(r=>r.id===id))||!metrics.cached)throw Error('Resume lost feedback, media, or cached work');
  let room=await api.reviewRequest('/'+window.test.binding.id+'/details',window.test.binding.reviewerKey,'POST',{kind:'motion',start:5,end:7});const request=room.delivery.requests.at(-1);
  room=await provideReviewVideo(project,window.test.binding,room,request,'motion',new AbortController().signal);room=await api.reviewRequest('/'+room.id+'/details',window.test.binding.ownerKey,'POST',{id:request.id,status:'ready'});
  room=await provideReviewVideo(project,window.test.binding,room,{start:5,end:7},'detail',new AbortController().signal);
  window.test.room=room;return {resumed:true,cachedRepresentations:metrics.cached,feedbackRetained:true,detailReady:room.delivery.requests[0].status==='ready'};
 })()`)
 await friend.reload();await wait(friend,"!!document.querySelector('.review-player button')")
 await friend.webContents.executeJavaScript("[...document.querySelectorAll('.review-player button')].find(b=>b.textContent==='Watch this section').click()")
 await wait(friend,"document.querySelector('.review-player video')?.readyState>=2")
 const detail=await friend.webContents.executeJavaScript(`(async()=>{const v=document.querySelector('.review-player video');await v.play();await new Promise(r=>setTimeout(r,300));return {playing:!v.paused,time:v.currentTime,audioPaused:document.querySelector('.review-player button').textContent==='Play audio'}})()`)
 if(!detail.playing||!detail.audioPaused)throw Error('Video/audio switching failed '+JSON.stringify(detail))
 writeFileSync(join(corpus,'progressive-review.png'),(await friend.webContents.capturePage()).toPNG())
 const media=await sender.webContents.executeJavaScript(`(async()=>{const out=[];for(const row of window.test.room.delivery.representations){const r=await fetch('/api/reviews/'+window.test.binding.id+'/representations/'+row.id,{headers:{Authorization:'Bearer '+window.test.binding.ownerKey}});const bytes=new Uint8Array(await r.arrayBuffer());out.push({row,bytes:Array.from(bytes)})}return out})()`)
 for(const item of media)writeFileSync(join(corpus,item.row.id+(item.row.kind==='thumbnail'?'.webp':'.webm')),Buffer.from(item.bytes))
 await sender.webContents.executeJavaScript(`(async()=>{const {useEditor}=await import('/src/store.ts');useEditor.getState().loadProject(window.test.project,{persist:false});useEditor.setState({selectedWordIds:window.test.project.transcript.words.filter(w=>w.start>=5&&w.end<=17).map(w=>w.id)})})()`)
 await wait(sender,"[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Share')")
 await sender.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Share').click()")
 await wait(sender,"[...document.querySelectorAll('button')].some(b=>b.textContent==='Create review link')")
 await sender.webContents.executeJavaScript("[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Include video sections')).querySelector('input').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Create review link').click()")
 await wait(sender,"!!document.querySelector('.review-link-box input') && ![...document.querySelectorAll('button')].some(b=>b.textContent==='Cancel sharing')")
 const ui=await sender.webContents.executeJavaScript(`(async()=>{const api=await import('/src/lib/reviewApi.ts'),b=api.reviewBindings(window.test.project.id).at(-1);window.test.rooms.push(b);const room=await api.reviewRequest('/'+b.id,b.ownerKey);return {scope:room.snapshot.scope,words:room.snapshot.words.length,complete:room.delivery.state==='complete',offlineVideo:room.delivery.offlineMotion && room.delivery.representations.some(r=>r.kind==='motion'),link:!!document.querySelector('.review-link-box input')?.value}})()`)
 if(!ui.offlineVideo||!ui.complete||!ui.link||ui.scope.start<5||ui.scope.end>17)throw Error('Share sheet did not share selected speech '+JSON.stringify(ui))
 writeFileSync(join(corpus,'progressive-share-sheet.png'),(await sender.webContents.capturePage()).toPNG())
 await sender.webContents.executeJavaScript(`Promise.all(window.test.rooms.map(b=>fetch('/api/reviews/'+b.id,{method:'DELETE',headers:{Authorization:'Bearer '+b.ownerKey}})))`)
 console.log(JSON.stringify({earlyPlayable:true,passageOnly:true,progressivePlaybackReachedEnd:true,recipient,extra,detail,ui,scope:result.room.snapshot.scope,updates:result.updates,representations:rows},null,2))
 clearTimeout(deadline);sender.destroy();friend.destroy();app.quit()
}).catch(async e=>{console.error(e);await cleanup();app.exit(1)})
