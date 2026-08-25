export function pad(value: number, width = 2): string {
  return String(Math.floor(Math.abs(value))).padStart(width, '0')
}

export function formatTimecode(seconds: number, fps = 30): string {
  const sign = seconds < 0 ? '-' : ''
  const t = Math.max(0, Math.abs(seconds))
  const frames = Math.floor((t % 1) * fps)
  const s = Math.floor(t) % 60
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  if (h > 0) return `${sign}${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`
  return `${sign}${pad(m)}:${pad(s)}:${pad(frames)}`
}

export function formatClock(seconds: number): string {
  const t = Math.max(0, seconds)
  const s = Math.floor(t) % 60
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`
}
