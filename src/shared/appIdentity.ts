/** Build identity shared by the window title, Inspector, and later support bundles. */

export type AppChannel = 'dev' | 'packaged' | 'web'

export type AppIdentity = {
  name: string
  version: string
  commit: string | null
  dirty: boolean
  channel: AppChannel
  electron: string
  platform: string
  arch: string
}

export function formatAppIdentity(id: AppIdentity): string {
  const parts = [id.version]
  if (id.commit) parts.push(id.dirty ? `${id.commit}+` : id.commit)
  if (id.channel === 'dev') parts.push('dev')
  if (id.channel === 'web') parts.push('web')
  return `${id.name} ${parts.join(' · ')}`
}

/** Pasteable block for a dogfood run record. */
export function formatAppIdentityDiagnostic(id: AppIdentity): string {
  const commit = id.commit ? `commit ${id.commit}${id.dirty ? ' dirty' : ''}` : 'commit unknown'
  const runtime = [id.platform, id.arch, id.electron ? `Electron ${id.electron}` : null, id.channel]
    .filter(Boolean)
    .join(' · ')
  return `${id.name} ${id.version}\n${commit}\n${runtime}`
}
