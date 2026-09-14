import { syncMediaPlayback, mediaPlaybackExhausted } from './lib/mediaPlayback'
import { useEffect, useMemo, useRef } from 'react'
import { programLength } from './lib/commands'
import { projectToExportJob, type ProgramExportJob } from './lib/exportJob'
import { projectForPlayback } from './lib/playbackProject'
import { sampleProgram, type ProgramLook } from './lib/programLook'
import { programToSourceOf, resolveProgram, segmentAtProgram } from './lib/resolver'
import {
  boundPlayhead,
  readMediaClock,
  shouldHardSeek,
  stepProgramPlayback
} from './lib/seek'
import { primaryAssetAt, sourceOffsetOf } from './lib/takes'
import { useEditor, usePlayback } from './store'

function applyGain(video: HTMLVideoElement | null, gain: number) {
  if (!video) return
  // Volume is the continuous program gain. Do not toggle the element's binary
  // mute state at cuts/fades: Chromium may have to re-authorize audible media
  // after an asynchronous seek. Keeping the audio path live also avoids a
  // frame of accidental full-volume audio when a source loads.
  video.muted = false
  video.volume = Math.min(1, Math.max(0, gain))
}

function reviewRateOf() {
  return usePlayback.getState().reviewRate || 1
}

function syncVideo(
  video: HTMLVideoElement | null,
  sourceTime: number,
  speed: number,
  playing: boolean,
  gain: number,
  fps = 30,
  hard = false
) {
  if (video) syncMediaPlayback(video, sourceTime, playing, speed * reviewRateOf(), gain, fps, hard)
}

function bedElement(bed: ProgramExportJob['beds'][number]): HTMLAudioElement | null {
  const id = bed.id ?? bed.path
  return document.querySelector(`audio[data-bed="${id}"]`)
}

function replacementClock(job: ProgramExportJob, time: number) {
  const bed = job.beds.find(bed => bed.replaceVoice && bed.volume > 0.001 && time >= bed.start && time < bed.start + bed.duration)
  if (!bed) return undefined
  const el = bedElement(bed)
  if (!el?.src) return undefined
  const read = readMediaClock(el)
  return {
    program: read.source == null || el.paused ? null : bed.start + read.source - bed.inPoint,
    end: bed.start + bed.duration,
    exhausted: el.ended || mediaPlaybackExhausted(el)
  }
}

function syncBeds(look: ProgramLook, playing: boolean, fps = 30, hard = false) {
  for (const item of look.beds) {
    const el = bedElement(item.bed)
    if (!el) continue
    if (!item.active) { if (!el.paused) el.pause(); continue }
    syncMediaPlayback(el, item.sourceTime, playing, reviewRateOf(), item.gain, fps, hard)
  }
}

function syncOverlays(look: ProgramLook, playing: boolean, fps = 30, hard = false) {
  const active = new Map(look.layers.filter((l) => l.layer.id && l.layer.kind === 'image' && !l.layer.loop).map((l) => [l.layer.id!, l]))
  for (const node of document.querySelectorAll('video[data-overlay]')) {
    const el = node as HTMLVideoElement
    const item = active.get(el.dataset.overlay ?? '')
    if (!item || !playing) {
      if (!el.paused) el.pause()
      continue
    }
    syncMediaPlayback(el, item.sourceTime, playing, (item.layer.speed || 1) * reviewRateOf(), 0, fps, hard)
  }
}

function syncProgram(
  video: HTMLVideoElement | null,
  under: HTMLVideoElement | null,
  look: ProgramLook,
  playing: boolean,
  fps = 30,
  hard = false,
  audioHard = hard
) {
  syncVideo(video, look.incomingSource, look.incomingSpeed, playing, look.voice.incomingGain, fps, hard)
  if (look.outgoing && under) {
    syncVideo(under, look.outgoingSource ?? look.incomingSource, look.outgoingSpeed, playing, look.voice.outgoingGain, fps, hard)
  } else if (under && !under.paused) {
    under.pause()
  }
  syncBeds(look, playing, fps, audioHard)
  syncOverlays(look, playing, fps, hard)
}

export function useEngine(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  underRef?: React.RefObject<HTMLVideoElement | null>
) {
  const playing = usePlayback((s) => s.playing)
  const programTime = usePlayback((s) => s.programTime)
  const reviewRate = usePlayback((s) => s.reviewRate)
  const project = useEditor((s) => s.project)
  const previewSafeCuts = useEditor((s) => s.previewSafeCuts)
  const playbackProject = useMemo(
    () => projectForPlayback(project, previewSafeCuts),
    [project, previewSafeCuts]
  )
  const job = useMemo(() => projectToExportJob(playbackProject), [playbackProject])
  const projectRef = useRef(playbackProject)
  const jobRef = useRef(job)
  projectRef.current = playbackProject
  jobRef.current = job

  useEffect(() => {
    const prime = () => {
      const video = videoRef.current
      if (video && usePlayback.getState().playing && video.paused && !video.ended && !mediaPlaybackExhausted(video)) {
        const look = sampleProgram(jobRef.current, usePlayback.getState().programTime)
        applyGain(video, look.voice.incomingGain)
        void video.play().catch(() => undefined)
      }
    }
    window.addEventListener('pointerdown', prime)
    // A Hear/review button updates the Zustand playback state in its click handler.
    // Re-check on the bubbling click so video.play() still happens inside the
    // same trusted gesture instead of relying on a later React effect.
    window.addEventListener('click', prime)
    window.addEventListener('keydown', prime)
    return () => {
      window.removeEventListener('pointerdown', prime)
      window.removeEventListener('click', prime)
      window.removeEventListener('keydown', prime)
    }
  }, [videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onLoaded = () => {
      const look = sampleProgram(jobRef.current, usePlayback.getState().programTime)
      syncProgram(
        video,
        underRef?.current ?? null,
        look,
        usePlayback.getState().playing,
        projectRef.current.fps || 30,
        true,
        false
      )
    }
    video.addEventListener('loadeddata', onLoaded)
    return () => video.removeEventListener('loadeddata', onLoaded)
  }, [videoRef, underRef])

  useEffect(() => {
    if (playing) return
    const look = sampleProgram(jobRef.current, programTime)
    syncProgram(videoRef.current, underRef?.current ?? null, look, false, projectRef.current.fps || 30)
  }, [playing, programTime, videoRef, underRef, previewSafeCuts, project])

  useEffect(() => {
    if (!playing) {
      const video = videoRef.current
      if (video && !video.paused) video.pause()
      const under = underRef?.current
      if (under && !under.paused) under.pause()
      const look = sampleProgram(jobRef.current, usePlayback.getState().programTime)
      syncBeds(look, false, projectRef.current.fps || 30)
      syncOverlays(look, false, projectRef.current.fps || 30)
      return
    }

    const startup = projectRef.current
    const nowPlay = usePlayback.getState()
    if (nowPlay.loop && startup.markIn != null && startup.markOut != null) {
      const a = Math.min(startup.markIn, startup.markOut)
      const b = Math.max(startup.markIn, startup.markOut)
      if (nowPlay.programTime < a || nowPlay.programTime >= b) {
        usePlayback.setState({ programTime: a })
      }
    }

    let raf = 0
    let last = performance.now()
    let lastSource: number | null = null
    let lastInput: string | undefined
    let lastProgram = nowPlay.programTime
    const video = videoRef.current
    if (video && video.src && video.paused && !video.ended && !mediaPlaybackExhausted(video)) {
      const look = sampleProgram(jobRef.current, nowPlay.programTime)
      applyGain(video, look.voice.incomingGain)
      void video.play().catch(() => undefined)
    }

    const stopAt = (job: ProgramExportJob, time: number, clearUntil = false) => {
      usePlayback.setState({
        playing: false,
        programTime: time,
        ...(clearUntil ? { playUntil: null } : {})
      })
      video?.pause()
      underRef?.current?.pause()
      const look = sampleProgram(job, time)
      syncBeds(look, false, projectRef.current.fps || 30)
      syncOverlays(look, false, projectRef.current.fps || 30)
    }

    const step = (now: number) => {
      const wall = Math.min(0.08, (now - last) / 1000)
      last = now
      const proj = projectRef.current
      const job = jobRef.current
      const duration = job.duration && job.duration > 0 ? job.duration : programLength(proj)
      const state = usePlayback.getState()
      const fps = proj.fps || 30
      const rate = state.reviewRate || 1
      const take = primaryAssetAt(proj, programToSourceOf(proj, state.programTime))
      const offset = sourceOffsetOf(take)
      const video = videoRef.current
      const onSlug = segmentAtProgram(proj, state.programTime)?.kind === 'slug'
      const clockRead =
        onSlug || video?.ended || mediaPlaybackExhausted(video)
          ? { source: null, present: false }
          : readMediaClock(video)
      const dt = wall * rate
      const advanced = stepProgramPlayback({
        lastProgram,
        requestedProgram: state.programTime,
        dt,
        mediaSource: clockRead.source,
        mediaPresent: clockRead.present,
        sourceOffset: offset,
        audioClock: replacementClock(job, state.programTime),
        resolved: resolveProgram(proj),
        fps
      })
      const bounded = boundPlayhead(advanced.program, {
        duration,
        playUntil: state.playUntil,
        loopFrom: state.loopFrom,
        loop: state.loop,
        markIn: proj.markIn,
        markOut: proj.markOut
      })
      if (bounded.stop) {
        stopAt(job, bounded.program, state.playUntil != null)
        return
      }
      const program = bounded.program
      const look = sampleProgram(job, program)
      const switched = lastInput != null && look.incomingInput != null && lastInput !== look.incomingInput
      const hard =
        advanced.hard ||
        switched ||
        shouldHardSeek({
          lastSource: switched ? null : lastSource,
          nextSource: look.incomingSource,
          dt,
          speed: look.incomingSpeed * rate,
          fps,
          clock: advanced.clock,
          looped: bounded.looped,
          cut: advanced.hard && advanced.clock === 'wall'
        })
      // A picture cut or decoder catch-up does not move a continuous audio clip.
      const audioHard = lastSource == null || advanced.clock === 'jump' || bounded.looped
      lastSource = look.incomingSource
      lastInput = look.incomingInput
      lastProgram = program
      syncProgram(videoRef.current, underRef?.current ?? null, look, true, fps, hard, audioHard)
      usePlayback.setState({ programTime: program })
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, videoRef, underRef, previewSafeCuts, reviewRate])
}
