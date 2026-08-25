/** JS-facing theme values — keep speaker palette in sync with theme.css */
export const SPEAKER_PALETTE = [
  '#C4452D',
  '#2F6F8F',
  '#3d7a52',
  '#8a5a32',
  '#6b4c9a',
  '#b4532a'
] as const

export const DEFAULT_SPEAKER_COLOR = SPEAKER_PALETTE[0]

export function speakerColor(
  speakers: { id: string; color?: string }[],
  speakerId: string
): string {
  return speakers.find((s) => s.id === speakerId)?.color ?? DEFAULT_SPEAKER_COLOR
}
