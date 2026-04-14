import * as prompts from "@clack/prompts"

type Ok = {
  access_token: string
  token_type: "Bearer"
  expires_in: number
}

function parse(input: unknown) {
  if (!input || typeof input !== "object") return
  const item = input as Record<string, unknown>
  if (typeof item.access_token !== "string" || !item.access_token) return
  if (item.token_type !== "Bearer") return
  if (typeof item.expires_in !== "number" || !Number.isFinite(item.expires_in)) return
  return {
    access_token: item.access_token,
    token_type: "Bearer",
    expires_in: Math.floor(item.expires_in),
  } satisfies Ok
}

function fail(input: unknown) {
  if (!input || typeof input !== "object") return "登录失败"
  const item = input as Record<string, unknown>
  if (typeof item.message === "string" && item.message) return item.message
  if (typeof item.error === "string" && item.error) return item.error
  return "登录失败"
}

export async function request(input: {
  base: string
  user: string
  pass: string
  fetch?: typeof fetch
}) {
  const fn = input.fetch ?? globalThis.fetch
  const res = await fn(`${input.base}/global/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: input.user,
      password: input.pass,
    }),
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Login request failed: ${msg}`)
  })
  const body = await res.json().catch(() => undefined)
  const data = parse(body)
  if (res.ok && data) return data
  throw new Error(fail(body))
}

export async function prompt(input: { base: string; fetch?: typeof fetch }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("TravelSky login requires an interactive terminal")
  }

  while (true) {
    const user = await prompts.text({
      message: "TravelSky username",
      placeholder: "username",
      validate: (item) => (item?.trim() ? undefined : "Required"),
    })
    if (prompts.isCancel(user)) return

    const pass = await prompts.password({
      message: "TravelSky password",
      validate: (item) => (item?.trim() ? undefined : "Required"),
    })
    if (prompts.isCancel(pass)) return

    const name = user.trim()
    const token = await request({
      base: input.base,
      user: name,
      pass: pass,
      fetch: input.fetch,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      prompts.log.error(msg)
      return
    })
    if (token) {
      prompts.log.success("Login successful")
      return {
        ...token,
        username: name,
      }
    }

    const pick = await prompts.select({
      message: "Login failed",
      options: [
        { label: "Retry", value: "retry" },
        { label: "Exit", value: "exit" },
      ],
    })
    if (prompts.isCancel(pick) || pick === "exit") return
  }
}
