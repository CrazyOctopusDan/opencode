import * as prompts from "@clack/prompts"
import { clear, current, write } from "./auth-store"
import { bearer } from "./header"
import { prompt } from "./login"
import { isTravelSky } from "./provider"

type ProviderItem = {
  id?: string
  name?: string
}

type ProviderList = {
  all?: ProviderItem[]
}

type ConfigList = {
  providers?: ProviderItem[]
}

function has(input: ProviderItem[]) {
  return input.some((item) => isTravelSky(item.id) || isTravelSky(item.name))
}

async function readProvider(input: {
  base: string
  auth: string
  fetch?: typeof fetch
}) {
  const fn = input.fetch ?? globalThis.fetch
  const res = await fn(`${input.base}/provider`, {
    method: "GET",
    headers: {
      Authorization: input.auth,
    },
  }).catch(() => undefined)
  if (!res?.ok) return false
  const body = (await res.json().catch(() => undefined)) as ProviderList | undefined
  const all = body?.all ?? []
  return has(all)
}

async function readConfig(input: {
  base: string
  auth: string
  fetch?: typeof fetch
}) {
  const fn = input.fetch ?? globalThis.fetch
  const res = await fn(`${input.base}/config/providers`, {
    method: "GET",
    headers: {
      Authorization: input.auth,
    },
  }).catch(() => undefined)
  if (!res?.ok) return false
  const body = (await res.json().catch(() => undefined)) as ConfigList | undefined
  const all = body?.providers ?? []
  return has(all)
}

async function ready(input: {
  base: string
  auth: string
  fetch?: typeof fetch
}) {
  if (await readProvider(input)) return true
  if (await readConfig(input)) return true
  return false
}

export async function ensureLogin(input: { base: string; fetch?: typeof fetch }) {
  const old = await current()
  const key = bearer(old)
  if (key && (await ready({ ...input, auth: key }))) return key
  if (old) await clear()

  while (true) {
    const next = await prompt(input)
    if (!next) return
    const item = await write(next)
    const auth = bearer(item)
    if (!auth) continue
    if (await ready({ ...input, auth })) return auth

    await clear()
    prompts.log.error("TravelSky provider is unavailable after login")
    const pick = await prompts.select({
      message: "Provider unavailable",
      options: [
        { label: "Retry", value: "retry" },
        { label: "Exit", value: "exit" },
      ],
    })
    if (prompts.isCancel(pick) || pick === "exit") return
  }
}

