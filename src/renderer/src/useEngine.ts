import { useEffect, useRef } from 'react'
import { programLength } from './lib/commands'
import { audioBeds, bedGainAt, programVolume } from './lib/exportJob'
import { programToSourceOf, resolveSegments, segmentsAtProgram, sourceToProgramOf } from './lib/resolver'
import { useEditor, usePlayback } from './store'

function applyProgramAudio(video: HTMLVideoElement | null, programTime: number) {
  if (!video) return
  const project = useEditor.getState().project
  const { gain } = programVolume(project, programTime)
  video.muted = project.audioMaster.muted || gain <= 0.0001
  video.volume = Math.min(1, Math.max(0, gain))
}

function syncVideo(
  video: HTMLVideoElement | null,
  sourceTime: number,
  speed: number,
  playing: boolean,
  programTime: number,
  withAudio = true
) {
  if (!video?.src) return
  video.playbackRate = speed
  if (withAudio) applyProgramAudio(video, programTime)
  else video.muted = true
  if (Math.abs(video.currentTime - sourceTime) > 0.16) video.currentTime = sourceTime
  if (playing && video.paused) void video.play().catch(() => undefined)
  if (!playing && !video.paused) video.pause()
}

function syncBeds(playing: boolean, programTime: number) {
  const project = useEditor.getState().project
  for (const bed of audioBeds(project)) {
    const el = document.querySelector(`audio[data-bed="${bed.id}"]`) as HTMLAudioElement | null
    if (!el) continue
    const local = programTime - bed.start
    const active = local >= -0.04 && local < bed.duration
    el.muted = project.audioMaster.muted
    el.volume = Math.min(1, Math.max(0, bedGainAt(project, bed, programTime)))
    if (!active || !playing) {
      if (!el.paused) el.pause()
      continue
    }
    const want = bed.inPoint + Math.max(0, local)
    if (Math.abs(el.currentTime - want) > 0.16) el.currentTime = want
    if (el.paused) void el.play().catch(() => undefined)
  }
}

function syncOverlays(playing: boolean, programTime: number) {
  const project = useEditor.getState().project
  for (const track of project.tracks) {
    if (track.type !== 'overlay' || track.hidden || track.muted) continue
    for (const clip of track.clips) {
      if (clip.muted) continue
      const el = document.querySelector(`video[data-overlay="${clip.id}"]`) as HTMLVideoElement | null
      if (!el) continue
      const local = programTime - clip.start
      const active = local >= -0.04 && local < clip.duration
      if (!active || !playing) {
        if (!el.paused) el.pause()
        continue
      }
      const want = clip.inPoint + Math.max(0, local) * (clip.speed || 1)
      el.playbackRate = clip.speed || 1
      if (Math.abs(el.currentTime - want) > 0.16) el.currentTime = want
      if (el.paused) void el.play().catch(() => undefined)
    }
  }
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
        applyProgramAudio(video, usePlayback.getState().programTime)
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
    const proj = projectRef.current
    const hits = segmentsAtProgram(proj, programTime)
    const incoming = hits[hits.length - 1]
    const outgoing = hits.length > 1 ? hits[0] : undefined
    const source = incoming
      ? incoming.inPoint + (programTime - incoming.start) * incoming.speed
      : programToSourceOf(proj, programTime)
    syncVideo(videoRef.current, source, incoming?.speed ?? 1, false, programTime)
    if (outgoing && underRef?.current) {
      const underSource = outgoing.inPoint + (programTime - outgoing.start) * outgoing.speed
      syncVideo(underRef.current, underSource, outgoing.speed, false, programTime, false)
    } else if (underRef?.current && !underRef.current.paused) {
      underRef.current.pause()
    }
    syncBeds(false, programTime)
    syncOverlays(false, programTime)
  }, [playing, programTime, videoRef, underRef])

  useEffect(() => {
    if (!playing) {
      const video = videoRef.current
      if (video && !video.paused) video.pause()
      const under = underRef?.current
      if (under && !under.paused) under.pause()
      syncBeds(false, usePlayback.getState().programTime)
      syncOverlays(false, usePlayback.getState().programTime)
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
      applyProgramAudio(video, nowPlay.programTime)
      void video.play().catch(() => undefined)
    }

    const step = (now: number) => {
      const dt = Math.min(0.08, (now - last) / 1000)
      last = now
      const proj = projectRef.current
      const duration = programLength(proj)
      const state = usePlayback.getState()
      let program = state.programTime + dt

      const markA =
        proj.markIn != null && proj.markOut != null ? Math.min(proj.markIn, proj.markOut) : 0
      const markB =
        proj.markIn != null && proj.markOut != null ? Math.max(proj.markIn, proj.markOut) : duration
      if (state.loop && proj.markIn != null && proj.markOut != null && program >= markB) {
        program = markA
      } else if (program >= duration) {
        if (state.loop) program = 0
        else {
          usePlayback.setState({ playing: false, programTime: duration })
          video?.pause()
          underRef?.current?.pause()
          syncBeds(false, duration)
          syncOverlays(false, duration)
          return
        }
      }

      const source = programToSourceOf(proj, program)
      const segs = resolveSegments(proj)
      const cut = segs.every((s) => source < s.inPoint || source >= s.outPoint)
      if (cut) {
        const next = segs.find((s) => s.inPoint >= source)
        if (next) program = sourceToProgramOf(proj, next.inPoint)
      }
      const hits = segmentsAtProgram(proj, program)
      const incoming = hits[hits.length - 1]
      const outgoing = hits.length > 1 ? hits[0] : undefined
      const incomingSource = incoming
        ? incoming.inPoint + (program - incoming.start) * incoming.speed
        : programToSourceOf(proj, program)
      syncVideo(videoRef.current, incomingSource, incoming?.speed ?? 1, true, program)
      if (outgoing && underRef?.current) {
        const underSource = outgoing.inPoint + (program - outgoing.start) * outgoing.speed
        syncVideo(underRef.current, underSource, outgoing.speed, true, program, false)
      } else if (underRef?.current && !underRef.current.paused) {
        underRef.current.pause()
      }
      syncBeds(true, program)
      syncOverlays(true, program)
      usePlayback.setState({ programTime: program })
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, videoRef, underRef])
}
