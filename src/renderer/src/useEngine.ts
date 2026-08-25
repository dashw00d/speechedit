import { useEffect, useRef } from 'react'
import { programLength } from './lib/commands'
import { projectToExportJob } from './lib/exportJob'
import { nextProgramAfterCut, sampleProgram, type ProgramLook } from './lib/programLook'
import { useEditor, usePlayback } from './store'

function applyGain(video: HTMLVideoElement | null, gain: number) {
  if (!video) return
  video.muted = gain <= 0.0001
  video.volume = Math.min(1, Math.max(0, gain))
}

function syncVideo(
  video: HTMLVideoElement | null,
  sourceTime: number,
  speed: number,
  playing: boolean,
  gain: number
) {
  if (!video?.src) return
  video.playbackRate = speed
  applyGain(video, gain)
  if (Math.abs(video.currentTime - sourceTime) > 0.16) video.currentTime = sourceTime
  if (playing && video.paused) void video.play().catch(() => undefined)
  if (!playing && !video.paused) video.pause()
}

function syncBeds(look: ProgramLook, playing: boolean) {
  for (const item of look.beds) {
    const id = item.bed.id ?? item.bed.path
    const el = document.querySelector(`audio[data-bed="${id}"]`) as HTMLAudioElement | null
    if (!el) continue
    el.muted = item.gain <= 0.0001
    el.volume = Math.min(1, Math.max(0, item.gain))
    if (!item.active || !playing) {
      if (!el.paused) el.pause()
      continue
    }
    if (Math.abs(el.currentTime - item.sourceTime) > 0.16) el.currentTime = item.sourceTime
    if (el.paused) void el.play().catch(() => undefined)
  }
}

function syncOverlays(look: ProgramLook, playing: boolean) {
  const active = new Map(look.layers.filter((l) => l.layer.id && l.layer.kind === 'image' && !l.layer.loop).map((l) => [l.layer.id!, l]))
  for (const node of document.querySelectorAll('video[data-overlay]')) {
    const el = node as HTMLVideoElement
    const item = active.get(el.dataset.overlay ?? '')
    if (!item || !playing) {
      if (!el.paused) el.pause()
      continue
    }
    el.playbackRate = item.layer.speed || 1
    if (Math.abs(el.currentTime - item.sourceTime) > 0.16) el.currentTime = item.sourceTime
    if (el.paused) void el.play().catch(() => undefined)
  }
}

function syncProgram(
  video: HTMLVideoElement | null,
  under: HTMLVideoElement | null,
  look: ProgramLook,
  playing: boolean
) {
  syncVideo(video, look.incomingSource, look.incomingSpeed, playing, look.voice.incomingGain)
  if (look.outgoing && under) {
    syncVideo(under, look.outgoingSource ?? look.incomingSource, look.outgoingSpeed, playing, look.voice.outgoingGain)
  } else if (under && !under.paused) {
    under.pause()
  }
  syncBeds(look, playing)
  syncOverlays(look, playing)
}

export function useEngine(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  underRef?: React.RefObject<HTMLVideoElement | null>
) {
  const playing = usePlayback((s) => s.playing)
  const programTime = usePlayback((s) => s.programTime)
  const project = useEditor((s) => s.project)
  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => {
    const prime = () => {
      const video = videoRef.current
      if (video && usePlayback.getState().playing && video.paused) {
        const look = sampleProgram(projectToExportJob(projectRef.current), usePlayback.getState().programTime)
        applyGain(video, look.voice.incomingGain)
        void video.play().catch(() => undefined)
      }
    }
    window.addEventListener('pointerdown', prime)
    window.addEventListener('keydown', prime)
    return () => {
      window.removeEventListener('pointerdown', prime)
      window.removeEventListener('keydown', prime)
    }
  }, [videoRef])

  useEffect(() => {
    if (playing) return
    const look = sampleProgram(projectToExportJob(projectRef.current), programTime)
    syncProgram(videoRef.current, underRef?.current ?? null, look, false)
  }, [playing, programTime, videoRef, underRef])

  useEffect(() => {
    if (!playing) {
      const video = videoRef.current
      if (video && !video.paused) video.pause()
      const under = underRef?.current
      if (under && !under.paused) under.pause()
      const look = sampleProgram(projectToExportJob(projectRef.current), usePlayback.getState().programTime)
      syncBeds(look, false)
      syncOverlays(look, false)
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
    const video = videoRef.current
    if (video && video.src && video.paused) {
      const look = sampleProgram(projectToExportJob(projectRef.current), nowPlay.programTime)
      applyGain(video, look.voice.incomingGain)
      void video.play().catch(() => undefined)
    }

    const step = (now: number) => {
      const dt = Math.min(0.08, (now - last) / 1000)
      last = now
      const proj = projectRef.current
      const job = projectToExportJob(proj)
      const duration = job.duration && job.duration > 0 ? job.duration : programLength(proj)
      const state = usePlayback.getState()
      let program = state.programTime + dt

      const markA =
        proj.markIn != null && proj.markOut != null ? Math.min(proj.markIn, proj.markOut) : 0
      const markB =
        proj.markIn != null && proj.markOut != null ? Math.max(proj.markIn, proj.markOut) : duration
      if (state.playUntil != null && program >= state.playUntil) {
        usePlayback.setState({ playing: false, programTime: state.playUntil, playUntil: null })
        video?.pause()
        underRef?.current?.pause()
        const look = sampleProgram(job, state.playUntil)
        syncBeds(look, false)
        syncOverlays(look, false)
        return
      }
      if (state.loop && proj.markIn != null && proj.markOut != null && program >= markB) {
        program = markA
      } else if (program >= duration) {
        if (state.loop) program = 0
        else {
          usePlayback.setState({ playing: false, programTime: duration })
          video?.pause()
          underRef?.current?.pause()
          const look = sampleProgram(job, duration)
          syncBeds(look, false)
          syncOverlays(look, false)
          return
        }
      }

      const skipped = nextProgramAfterCut(job, program)
      if (skipped != null) program = skipped
      const look = sampleProgram(job, program)
      syncProgram(videoRef.current, underRef?.current ?? null, look, true)
      usePlayback.setState({ programTime: program })
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, videoRef, underRef])
}
