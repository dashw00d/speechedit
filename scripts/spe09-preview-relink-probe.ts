/**
 * SPE-09 probe: shared preview-only media blocks the final render.
 *
 * A project whose only A-roll is a shared preview (`proxyOnly: true`) is asked to
 * export the final video. The probe prints what the export path reports and then
 * exercises the in-context relink recovery end to end.
 *
 * Before evidence: evidence/spe09-preview-relink-before.output.txt
 * After evidence:  evidence/spe09-preview-relink-probe.output.txt
 *
 * Run from the repo root:  bun scripts/spe09-preview-relink-probe.ts
 */
import { host } from '../src/renderer/src/host'
import { useEditor } from '../src/renderer/src/store'
import { createDemoProject } from '../src/renderer/src/lib/demo'
import { buildExportJob } from '../src/renderer/src/lib/exportJob'
import { validateExportJob } from '../src/renderer/src/lib/exportGraph'
import {
  exportPrimaryCopy,
  proxyOnlyAssets,
  relinkProxyOriginals,
  videoExportCopy,
  exportVideoAction
} from '../src/renderer/src/lib/exportActions'
import type { ToastEntry } from '../src/renderer/src/lib/toastActions'

const base = createDemoProject()
const project = {
  ...base,
  assets: {
    demo_src: {
      ...base.assets.demo_src,
      path: 'http://localhost/api/reviews/room-1/media/demo_src',
      proxyOnly: true
    }
  }
} as typeof base

const job = buildExportJob(project, '/tmp/out.mp4')
console.log('buildExportJob returned a job:', job !== null)
console.log('validateExportJob:', job ? validateExportJob(job) : '(no job)')
console.log('videoExportCopy:', JSON.stringify(videoExportCopy(project)))
console.log('exportPrimaryCopy(electron=true):', JSON.stringify(exportPrimaryCopy(project, {}, true)))
console.log('exportPrimaryCopy(electron=false):', JSON.stringify(exportPrimaryCopy(project, {}, false)))

useEditor.getState().loadProject(project, { clean: true, persist: false })

const messages: (string | ToastEntry)[] = []
await exportVideoAction((message) => messages.push(message))
console.log('exportVideoAction message:', JSON.stringify(messages[0]))

const openMedia = host.openMedia
const mediaExists = host.mediaExists
const waveform = host.waveform
const thumbnails = host.thumbnails
host.openMedia = async () => '/tmp/spe09-local-recording.wav'
host.mediaExists = async (paths) => paths.map((path) => ({ path, exists: true }))
host.waveform = async () => []
host.thumbnails = async () => []
try {
  const relinked: (string | ToastEntry)[] = []
  let resumed = 0
  await relinkProxyOriginals((message) => relinked.push(message), () => {
    resumed += 1
  })
  console.log('originals still needing relink:', proxyOnlyAssets(useEditor.getState().project).length)
  console.log('export resumed after relink:', resumed === 1)
  console.log('relink follow-up message:', JSON.stringify(relinked[0] ?? null))
} finally {
  host.openMedia = openMedia
  host.mediaExists = mediaExists
  host.waveform = waveform
  host.thumbnails = thumbnails
}
