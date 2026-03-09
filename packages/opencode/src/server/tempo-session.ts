type UpstreamAuth = {
  token?: string
  cookie?: string
}

const byLocalToken = new Map<string, UpstreamAuth>()
let active: UpstreamAuth | undefined

export namespace TempoSession {
  export function set(localToken: string, auth: UpstreamAuth) {
    byLocalToken.set(localToken, auth)
    active = auth
  }

  export function get(localToken?: string) {
    if (localToken) return byLocalToken.get(localToken) ?? active
    return active
  }

  export function remove(localToken: string) {
    const current = byLocalToken.get(localToken)
    byLocalToken.delete(localToken)
    if (active && current && active === current) {
      active = undefined
    }
  }
}
