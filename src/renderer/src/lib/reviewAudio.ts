import type { ReviewRoom, ReviewSpan } from '../../../shared/review'
import { reviewScope, REVIEW_TIMEBASE } from '../../../shared/reviewMedia'

type Scheduled = { node: AudioBufferSourceNode; at: number; start: number; end: number }
/** Audio-thread scheduling gives adjacent files one continuous clock. Missing files wait silently. */
export class ReviewAudioTransport {
  private context?: AudioContext
  private nodes: Scheduled[] = []
  private cache = new Map<string, Promise<AudioBuffer>>()
  private controller?: AbortController
  private generation = 0
  private wanted = false
  private filling = false
  private cursor = 0
  private position = 0
  private until = Infinity
  private nextAt = 0
  private timer?: ReturnType<typeof setInterval>
  constructor(private read: () => { room: ReviewRoom; key: string; cuts: ReviewSpan[] }, private change: (time: number, playing: boolean, buffering: boolean) => void, private error: (message: string) => void) { this.position = reviewScope(read().room.snapshot).start }
  pause() {
    this.tick(); this.wanted = false; this.generation++; this.controller?.abort(); this.controller = undefined
    for (const item of this.nodes) { try { item.node.stop() } catch { /* Already ended. */ } item.node.disconnect() }
    this.nodes = []; this.cache.clear(); clearInterval(this.timer); this.timer = undefined
    this.change(this.position, false, false)
  }
  async seek(time: number, play = false, until = Infinity) {
    this.pause()
    const range = reviewScope(this.read().room.snapshot)
    this.position = this.cursor = Math.min(range.end, Math.max(range.start, time)); this.until = Math.min(range.end, until)
    this.change(this.position, false, false)
    if (!play || this.position >= this.until) return
    this.context ||= new AudioContext()
    const generation = this.generation
    await this.context.resume()
    if (generation !== this.generation) return
    this.wanted = true; this.controller = new AbortController(); this.nextAt = this.context.currentTime + 0.04
    this.timer = setInterval(() => { this.tick(); void this.fill() }, 30)
    void this.fill()
  }
  close() { this.pause(); void this.context?.close(); this.context = undefined }
  private tick() {
    if (!this.wanted || !this.context) return
    const now = this.context.currentTime
    while (this.nodes.length && this.nodes[0].at + this.nodes[0].end - this.nodes[0].start <= now) {
      const ended = this.nodes.shift()!; this.position = ended.end; ended.node.disconnect()
    }
    const current = this.nodes[0]
    if (current && now >= current.at) this.position = Math.min(current.end, current.start + now - current.at)
    if (!this.nodes.length && this.cursor >= this.until) {
      this.position = this.until; this.wanted = false; clearInterval(this.timer); this.timer = undefined
    }
    this.change(this.position, this.wanted, this.wanted && (!current || now < current.at))
  }
  private async fill() {
    if (!this.wanted || this.filling || !this.context || !this.controller) return
    const generation = this.generation, signal = this.controller.signal, context = this.context
    this.filling = true
    try {
      while (this.wanted && generation === this.generation && this.nodes.length < 3 && this.cursor < this.until) {
        const { room, key, cuts } = this.read()
        const cut = cuts.find(c => this.cursor >= c.start && this.cursor < c.end)
        if (cut) { this.cursor = Math.min(cut.end, this.until); if (!this.nodes.length) this.position = this.cursor; continue }
        const rows = room.delivery?.representations || []
        const row = rows.find(r => r.kind === 'audio' && r.start / REVIEW_TIMEBASE <= this.cursor + 1e-7 && r.end / REVIEW_TIMEBASE > this.cursor + 1e-7)
        if (!row) break
        if (!this.cache.has(row.id)) {
          this.cache.set(row.id, (async () => {
            const response = await fetch(`/api/reviews/${room.id}/representations/${row.id}`, { headers: { Authorization: `Bearer ${key}` }, signal })
            if (!response.ok) throw new Error('This audio section could not load. Press Play to retry.')
            return context.decodeAudioData(await response.arrayBuffer())
          })())
        }
        const buffer = await this.cache.get(row.id)!
        if (generation !== this.generation || signal.aborted) break
        const start = this.cursor, upcoming = cuts.filter(c => c.start > start).reduce((n, c) => Math.min(n, c.start), Infinity)
        const end = Math.min(this.until, row.end / REVIEW_TIMEBASE, upcoming)
        const offset = Math.max(0, start - row.start / REVIEW_TIMEBASE)
        const at = Math.max(this.nextAt, context.currentTime + 0.02)
        // Pad a decoder-short segment with silence, never loop it or reveal source audio.
        const padded = context.createBuffer(buffer.numberOfChannels, Math.max(buffer.length, Math.ceil((row.end - row.start) / REVIEW_TIMEBASE * buffer.sampleRate)), buffer.sampleRate)
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) padded.copyToChannel(buffer.getChannelData(ch), ch)
        const node = context.createBufferSource(); node.buffer = padded; node.connect(context.destination)
        node.start(at, offset, end - start)
        this.nodes.push({ node, at, start, end }); this.cursor = end; this.nextAt = at + end - start
        for (const id of this.cache.keys()) if (id !== row.id) this.cache.delete(id)
      }
    } catch (e) { if (!signal.aborted && generation === this.generation) { this.pause(); this.error(e instanceof Error ? e.message : 'Audio playback failed.') } }
    finally { this.filling = false }
  }
}
