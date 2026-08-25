import { usePlayback } from '../store'

/** After edits, a 1× default becomes a 1.5× skim. A rate they already picked stays. */
export function watchEditedReel(opts: { skim?: boolean } = {}): { toast: string; rate: number } {
  const playback = usePlayback.getState()
  if (opts.skim && playback.reviewRate === 1) playback.setReviewRate(1.5)
  const rate = usePlayback.getState().reviewRate
  playback.playFromSource(0)
  return {
    toast:
      rate === 1
        ? 'Watching from the start.'
        : `Watching at ${rate}×. Switch to 1× on the monitor to hear a line.`,
    rate
  }
}
