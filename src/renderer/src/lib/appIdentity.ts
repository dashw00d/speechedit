import { host } from '../host'
import type { AppIdentity } from '../../../shared/appIdentity'

export type { AppIdentity } from '../../../shared/appIdentity'
export { formatAppIdentity, formatAppIdentityDiagnostic } from '../../../shared/appIdentity'

let cached: AppIdentity | null = null
let inflight: Promise<AppIdentity> | null = null

export function resetAppIdentityCache(): void {
  cached = null
  inflight = null
}

export async function loadAppIdentity(force = false): Promise<AppIdentity> {
  if (!force && cached) return cached
  if (!force && inflight) return inflight
  const pending = host.appIdentity().then((identity) => {
    cached = identity
    return identity
  })
  inflight = pending
  try {
    return await pending
  } finally {
    if (inflight === pending) inflight = null
  }
}
