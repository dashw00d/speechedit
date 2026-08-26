export function shouldPreventWindowClose(dirty: boolean, desktop: boolean): boolean {
  return dirty && !desktop
}
