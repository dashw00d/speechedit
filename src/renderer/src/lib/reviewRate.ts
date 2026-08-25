export const REVIEW_RATES = [0.5, 1, 1.5, 2] as const

export type ReviewRate = (typeof REVIEW_RATES)[number]

export function clampReviewRate(value: number): ReviewRate {
  return (REVIEW_RATES as readonly number[]).includes(value) ? (value as ReviewRate) : 1
}

export function describeReviewRate(rate: number): string {
  if (rate === 1) return 'Play at normal speed'
  if (rate === 1.5) return 'Skim the cut at 1.5×'
  return `Review at ${rate}×`
}
