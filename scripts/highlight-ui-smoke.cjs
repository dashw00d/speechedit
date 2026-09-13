// Exercise the real transcript component in an isolated browser profile.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createServer } = require('node:http')
const dir = mkdtempSync(join(tmpdir(), 'speechedit-highlight-'))
app.setPath('userData', join(dir, 'profile'))
const modulePath = path => JSON.stringify(resolve(path))
writeFileSync(join(dir, 'entry.tsx'), `
import React, { Profiler } from ${modulePath('node_modules/react/index.js')}
import { createRoot } from ${modulePath('node_modules/react-dom/client.js')}
import { Transcript } from ${modulePath('src/renderer/src/components/Transcript.tsx')}
import { useEditor, usePlayback } from ${modulePath('src/renderer/src/store.ts')}
import { createDemoProject } from ${modulePath('src/renderer/src/lib/demo.ts')}
import { applyCommand } from ${modulePath('src/renderer/src/lib/commands.ts')}
import { projectForPlayback } from ${modulePath('src/renderer/src/lib/playbackProject.ts')}
import { projectToExportJob } from ${modulePath('src/renderer/src/lib/exportJob.ts')}
import { sampleProgram } from ${modulePath('src/renderer/src/lib/programLook.ts')}
import { programToSourceOf, sourceToProgramOf } from ${modulePath('src/renderer/src/lib/resolver.ts')}
import { currentWord } from ${modulePath('src/renderer/src/lib/edl.ts')}
import { prepareSharedProject, sharedProject } from ${modulePath('src/shared/collaboration.ts')}
let renders = 0;
createRoot(document.getElementById('root')).render(React.createElement(Profiler, { id: 'transcript', onRender: () => renders++ }, React.createElement(Transcript)));
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
window.check = async () => {
  let samples = 0, differentFromUncut = 0;
  for (const shared of [false, true]) {
    let project = createDemoProject();
    project = applyCommand(project, { type: 'setSpeed', start: 17, end: 22, speed: 1.5 });
    if (shared) project = sharedProject(prepareSharedProject(project));
    useEditor.getState().loadProject(project);
    useEditor.getState().setFollowPlayhead(false);
    for (const safe of [false, true]) {
      useEditor.getState().setPreviewSafeCuts(safe);
      const playbackProject = projectForPlayback(useEditor.getState().project, safe);
      const job = projectToExportJob(playbackProject);
      for (const word of playbackProject.transcript.words.filter(w => !w.deleted).filter((_, i) => i % 5 === 0)) {
        const t = sourceToProgramOf(playbackProject, (word.start + word.end) / 2);
        usePlayback.setState({ programTime: t, playing: false });
        await frame();
        const expected = currentWord(playbackProject.transcript.words, sampleProgram(job, t).sourceTime)?.id;
        const actual = document.querySelector('.word[data-on="true"]')?.getAttribute('data-word-id');
        if (actual !== expected) throw Error(JSON.stringify({ shared, safe, t, expected, actual }));
        if (safe && expected !== currentWord(project.transcript.words, programToSourceOf(project, t))?.id) differentFromUncut++;
        samples++;
      }
    }
  }
  if (!differentFromUncut) throw Error('Fixture did not exercise the safe-cut offset.');
  useEditor.getState().setPreviewSafeCuts(false);
  const project = useEditor.getState().project;
  const word = project.transcript.words.find(w => !w.deleted && w.end - w.start > 0.1);
  const t = sourceToProgramOf(project, word.start + 0.02);
  usePlayback.setState({ programTime: t, playing: false });
  await frame();
  const before = renders;
  for (let i = 1; i <= 10; i++) { usePlayback.setState({ programTime: t + i * 0.001 }); await frame(); }
  if (!before) throw Error('Profiler did not record renders.');
  if (renders !== before) throw Error('Transcript still rerenders inside the same word: ' + (renders - before));
  return { samples, differentFromUncut, localAndShared: true, safeCutAndSpeedAlignment: true, noRenderWithinWord: true };
};
`)
const build = spawnSync('bun', ['build', join(dir, 'entry.tsx'), '--target=browser', '--define', 'process.env.NODE_ENV="development"', '--outfile', join(dir, 'bundle.js')], { encoding: 'utf8' })
if (build.status) throw Error(build.stderr)
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html')
  res.end(req.url === '/bundle.js' ? readFileSync(join(dir, 'bundle.js')) : '<div id="root"></div><script type="module" src="/bundle.js"></script>')
})
app.on('quit', () => { server.close(); rmSync(dir, { recursive: true, force: true }) })
const deadline = setTimeout(() => { console.error('Highlight smoke timed out'); app.exit(1) }, 90_000)
app.whenReady().then(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const win = new BrowserWindow({ show: true, webPreferences: { backgroundThrottling: false } })
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  console.log(JSON.stringify(await win.webContents.executeJavaScript('window.check()')))
  clearTimeout(deadline)
  win.destroy()
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
