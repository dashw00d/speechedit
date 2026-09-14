import type { Project } from '../types'
import type { ReviewRoom } from '../../../shared/review'
import { mergeSharedProjects, prepareSharedProject } from '../../../shared/collaboration'
import { useEditor, usePlayback } from '../store'
import { reviewRequest, uploadReviewPreview } from './reviewApi'
import { mountSharedProject, readSharedState, writeSharedState, sharedSession } from './sharedSession'
import { remountBrowserAssets } from './browserMediaStore'
import { encodeReviewProxy } from './reviewProxy'
import { recordingPreview } from './recordingClient'

export interface CollaborationStatus { message: string; error?: string; conflicts?: string[]; revision: number; history: NonNullable<ReviewRoom['history']> }
interface Draft { base: Project; project: Project; conflicts?: string[] }
const same = (a: Project, b: Project) => JSON.stringify(a) === JSON.stringify(b)
export class CollaborationClient {
  private base!: Project
  private revision = 0
  private latest?: ReviewRoom
  private applying = false
  private stopped = false
  private running?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private queue: Promise<void> = Promise.resolve()
  private pendingConflicts: string[] = []
  private abort = new AbortController()
  constructor(readonly id: string, readonly key: string, private author: () => string, private status: (status: CollaborationStatus) => void) {}
  private report(message: string, error?: string) {
    if (!this.stopped) this.status({ message, error, conflicts: this.pendingConflicts, revision: this.revision, history: this.latest?.history || [] })
  }
  private remember(project: Project) {
    const draft = { base: this.base, project, conflicts: [...this.pendingConflicts] }
    this.queue = this.queue.catch(() => undefined).then(() => writeSharedState(`draft:${this.id}`, draft))
    return this.queue
  }
  private apply(project: Project, clean: boolean, reset = false) {
    this.applying = true
    try {
      if (reset) useEditor.getState().loadProject(project, { clean })
      else useEditor.getState().applySharedProject(project, clean)
    } finally { this.applying = false }
  }
  async open() {
    const room = await reviewRequest<ReviewRoom>(`/${this.id}`, this.key, 'GET', undefined, this.abort.signal)
    if (room.mode !== 'edit' || !room.project) throw new Error('This is an audit link. Open its review page to leave feedback.')
    const draft = await readSharedState<Draft>(`draft:${this.id}`)
    if (this.stopped) return
    this.latest = room; this.base = room.project; this.revision = room.projectRevision!
    let project = mountSharedProject(room.project, this.id), clean = true
    if (draft && draft.base.id === room.project.id && !same(prepareSharedProject(draft.project), draft.base)) {
      const merged = mergeSharedProjects(draft.base, prepareSharedProject(draft.project), room.project)
      project = mountSharedProject(merged.project, this.id, draft.project)
      project.assets = (await remountBrowserAssets(project.assets)).assets
      if (this.stopped) return
      this.pendingConflicts = [...new Set([...(draft.conflicts || []), ...merged.conflicts])]; clean = false
    }
    sharedSession.projectId = room.project.id
    this.apply(project, clean, true)
    sharedSession.persist = project => {
      if (this.applying || this.stopped || project.id !== this.base.id) return
      void this.remember(project).catch(() => this.report('Edits need saving', 'Browser draft storage is unavailable. Keep this tab open until changes reach the server.'))
      if (!this.pendingConflicts.length) this.report('Unsaved changes')
    }
    sharedSession.save = async () => { await this.sync(); if (useEditor.getState().dirty || this.pendingConflicts.length) throw new Error('Changes are not saved yet. Check the shared editing bar.'); return 'Shared project' }
    this.report(clean ? 'All changes saved' : this.pendingConflicts.length ? 'Resolve simultaneous edits' : 'Recovered unsaved edits')
    this.timer = setInterval(() => { void this.sync() }, 3000)
  }
  stop() { this.stopped = true; clearInterval(this.timer); this.abort.abort(); sharedSession.persist = undefined; sharedSession.save = undefined; sharedSession.projectId = undefined }
  sync(): Promise<void> {
    if (this.running) return this.running
    this.running = this.performSync().catch(error => { if (!this.stopped) this.report('Changes waiting to sync', error instanceof Error ? error.message : String(error)) }).finally(() => { this.running = undefined })
    return this.running
  }
  private async performSync() {
    if (this.stopped || !this.base || this.pendingConflicts.length) return
    // Import/transcription can still be assembling a new media asset. Save after that job finishes.
    if (useEditor.getState().analyzing) { this.report('Waiting for media preparation'); return }
    let room = await reviewRequest<ReviewRoom>(`/${this.id}`, this.key, 'GET', undefined, this.abort.signal)
    if (!room.project || room.mode !== 'edit') throw new Error('Editing access is no longer available.')
    this.latest = room
    let current = useEditor.getState().project
    let local = prepareSharedProject(current)
    if (room.projectRevision !== this.revision) {
      const merged = mergeSharedProjects(this.base, local, room.project)
      this.pendingConflicts = merged.conflicts
      if (merged.conflicts.length) { await this.remember(current); this.report('Resolve simultaneous edits'); return }
      local = merged.project; current = mountSharedProject(local, this.id, current)
      this.base = room.project; this.revision = room.projectRevision!
      this.apply(current, same(local, this.base))
      await this.remember(current)
    }
    if (same(local, this.base)) { useEditor.setState({ dirty: false }); this.report('All changes saved'); return }
    this.report('Saving changes…')
    await this.remember(current)
    for (const asset of Object.values(current.assets)) {
      if (room.media[asset.id]) continue
      room = await reviewRequest<ReviewRoom>(`/${this.id}/assets`, this.key, 'POST', { asset: local.assets[asset.id] }, this.abort.signal)
      if (room.media[asset.id]) continue
      this.report(`Compressing ${asset.name}…`)
      let encodingMode = 'fast encoder'
      const blob = await recordingPreview(asset, this.abort.signal) || await encodeReviewProxy(asset, this.abort.signal, ratio => this.report(`Compressing ${asset.name} · ${Math.round(ratio * 100)}% · ${encodingMode}`), status => { encodingMode = status.mode === 'cached' ? 'saved preview' : status.mode === 'playback' ? 'playback speed' : `${status.mode} encoder`; this.report(`${asset.name} · ${encodingMode}`, status.mode === 'playback' ? status.detail : undefined) })
      this.report(`Uploading ${asset.name}…`)
      await uploadReviewPreview({ id: this.id, ownerKey: this.key, reviewerKey: this.key, projectId: this.base.id }, asset.id, blob, this.abort.signal)
    }
    // A new keystroke during upload stays dirty and is sent on the following save.
    room = await reviewRequest<ReviewRoom>(`/${this.id}/project`, this.key, 'PUT', { revision: this.revision, project: local, author: this.author().trim() || 'Editor' }, this.abort.signal)
    this.latest = room; this.base = room.project!; this.revision = room.projectRevision!
    const after = useEditor.getState().project, clean = same(prepareSharedProject(after), local)
    useEditor.setState({ dirty: !clean })
    await this.remember(after)
    this.report(clean ? 'All changes saved' : 'Unsaved changes')
  }
  async resolve(keepLocal: boolean) {
    if (!this.latest?.project || !this.pendingConflicts.length) return
    const current = useEditor.getState().project
    const merged = mergeSharedProjects(this.base, prepareSharedProject(current), this.latest.project)
    // Preserve a durable copy even when choosing the server version.
    await writeSharedState(`conflict-backup:${this.id}`, current)
    this.base = this.latest.project; this.revision = this.latest.projectRevision!
    this.pendingConflicts = []
    usePlayback.getState().pause()
    this.apply(mountSharedProject(keepLocal ? merged.project : this.base, this.id, current), !keepLocal, true)
    await this.remember(useEditor.getState().project)
    await this.sync()
  }
}
