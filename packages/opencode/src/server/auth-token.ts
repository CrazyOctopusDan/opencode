import { Flag } from "@opencode-ai/core/flag/flag"

type Session = {
  username: string
  expiresAt: number
}

const DEFAULT_TTL_SECONDS = 8 * 60 * 60
const sessions = new Map<string, Session>()

const now = () => Date.now()

function ttlMs() {
  const value = Number(Flag.OPENCODE_AUTH_TOKEN_TTL_SECONDS)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TTL_SECONDS * 1000
  return Math.floor(value) * 1000
}

function prune() {
  const ts = now()
  for (const [token, session] of sessions) {
    if (session.expiresAt > ts) continue
    sessions.delete(token)
  }
}

export namespace AuthToken {
  export function create(username: string) {
    prune()
    const token = crypto.randomUUID().replace(/-/g, "")
    const expiresIn = ttlMs()
    sessions.set(token, {
      username,
      expiresAt: now() + expiresIn,
    })
    return {
      access_token: token,
      token_type: "Bearer" as const,
      expires_in: Math.floor(expiresIn / 1000),
    }
  }

  export function verify(token: string) {
    prune()
    const session = sessions.get(token)
    if (!session) return
    return session
  }

  export function revoke(token: string) {
    sessions.delete(token)
  }
}
