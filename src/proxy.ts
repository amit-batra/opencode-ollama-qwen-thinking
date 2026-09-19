import { decodeModel, isQwen38, rewriteRequest } from "./reasoning"

const HOST = process.env.QWEN_THINKING_PROXY_HOST ?? "127.0.0.1"
const PORT = Number(process.env.QWEN_THINKING_PROXY_PORT ?? "11437")
const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "")
const DEBUG = process.env.QWEN_THINKING_DEBUG === "1"

function log(...args: unknown[]) {
  if (DEBUG) console.error("[qwen-thinking-proxy]", ...args)
}

function upstream(path: string): string {
  return `${OLLAMA_URL}${path}`
}

async function jsonResponse(response: Response): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function models(): Promise<Response> {
  const response = await fetch(upstream("/v1/models"))
  if (!response.ok) return jsonResponse(response)

  const payload = await response.json() as { data?: Array<Record<string, unknown>> }
  const data = Array.isArray(payload.data) ? payload.data : []
  const variants: Array<Record<string, unknown>> = []

  for (const model of data) {
    const id = typeof model.id === "string" ? model.id : ""
    if (!isQwen38(id)) continue

    for (const effort of ["none", "low", "medium", "xhigh"]) {
      variants.push({
        ...model,
        id: `${id}-effort-${effort}`,
        owned_by: "ollama-qwen-thinking",
      })
    }
  }

  return Response.json({ ...payload, data: [...data, ...variants] })
}

async function chatCompletions(request: Request): Promise<Response> {
  const original = await request.json() as Record<string, unknown>
  const rewritten = rewriteRequest(original)

  if (DEBUG && original.model !== rewritten.model) {
    log(
      `${String(original.model)} -> ${String(rewritten.model)}`,
      `reasoning_effort=${String(rewritten.reasoning_effort)}`,
    )
  }

  const headers = new Headers(request.headers)
  headers.delete("host")
  headers.delete("content-length")

  const response = await fetch(upstream("/v1/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify(rewritten),
  })

  return jsonResponse(response)
}

async function passthrough(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const target = upstream(url.pathname + url.search)

  const headers = new Headers(request.headers)
  headers.delete("host")
  headers.delete("content-length")

  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : request.body

  return jsonResponse(await fetch(target, {
    method: request.method,
    headers,
    body,
  }))
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/health") {
      return Response.json({ ok: true, upstream: OLLAMA_URL })
    }

    if (url.pathname === "/v1/models" && request.method === "GET") {
      return models()
    }

    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      return chatCompletions(request)
    }

    return passthrough(request)
  },
})

console.error(`[qwen-thinking-proxy] listening on http://${HOST}:${PORT}`)
console.error(`[qwen-thinking-proxy] upstream: ${OLLAMA_URL}`)

process.on("SIGTERM", () => {
  server.stop()
  process.exit(0)
})

process.on("SIGINT", () => {
  server.stop()
  process.exit(0)
})
