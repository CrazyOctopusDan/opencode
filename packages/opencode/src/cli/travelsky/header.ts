import type { Token } from "./auth-store"

export function bearer(input: Pick<Token, "access_token"> | undefined) {
  if (!input?.access_token) return
  return `Bearer ${input.access_token}`
}

export function headers(input: string | undefined) {
  if (!input) return
  return {
    Authorization: input,
  }
}

