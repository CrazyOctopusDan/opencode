import path from "path"
import { rm } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { Filesystem } from "@/util/filesystem"

export type Token = {
  access_token: string
  expires_at: number
  username: string
}

export const FILE = path.join(Global.Path.data, "travelsky-auth.json")

function parse(input: unknown) {
  if (!input || typeof input !== "object") return
  const item = input as Record<string, unknown>
  if (typeof item.access_token !== "string" || !item.access_token) return
  if (typeof item.username !== "string" || !item.username) return
  if (typeof item.expires_at !== "number" || !Number.isFinite(item.expires_at)) return
  return {
    access_token: item.access_token,
    expires_at: Math.floor(item.expires_at),
    username: item.username,
  } satisfies Token
}

export function alive(input: Token) {
  return input.expires_at > Date.now()
}

export async function read() {
  return parse(await Filesystem.readJson(FILE).catch(() => undefined))
}

export async function current() {
  const item = await read()
  if (!item || !alive(item)) return
  return item
}

export async function write(input: {
  access_token: string
  expires_in: number
  username: string
}) {
  const ttl = Math.max(1, Math.floor(input.expires_in))
  const item = {
    access_token: input.access_token,
    expires_at: Date.now() + ttl * 1000,
    username: input.username,
  } satisfies Token
  await Filesystem.writeJson(FILE, item, 0o600)
  return item
}

export async function clear() {
  await rm(FILE, { force: true }).catch(() => undefined)
}
