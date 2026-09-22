import { decodeModel, isQwen38, rewriteRequest } from "./reasoning"

const HOST = process.env.QWEN_THINKING_PROXY_HOST ?? "127.0.0.1"
const PORT = Number(process.env.QWEN_THINKING_PROXY_PORT ?? "11437")
const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "")
const DEBUG = process.env.QWEN_THINKING_DEBUG === "1"
const SERVICE = "opencode-ollama-qwen-thinking"

function log(...args: unknown[]) {
  if (DEBUG) console.error("[qwen-thinking-proxy]", ...args)
}

function upstream(path: string): string {
  return `${OLLAMA_URL}${path}`
}

function upstreamError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return String(error)
}

function failureResponse(error: unknown): Response {
  log("upstream request failed:", upstreamError(error))

  return Response.json(
    {
      error: {
        message: "The Ollama upstream connection failed.",
        type: "upstream_connection_error",
      },
    },
    { status: 502 },
  )
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

async function models(request: Request): Promise<Response> {
  try {
    const response = await fetch(upstream("/v1/models"), {
      signal: request.signal,
    })
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
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return failureResponse(error)
  }
}

async function chatCompletions(request: Request): Promise<Response> {
  try {
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
    headers.delete("connection")
    headers.delete("keep-alive")
    headers.delete("proxy-authenticate")
    headers.delete("proxy-authorization")
    headers.delete("te")
    headers.delete("trailer")
    headers.delete("transfer-encoding")
    headers.delete("upgrade")

    // Tie the upstream request to the downstream connection. If OpenCode
    // cancels a generation or disconnects, Ollama is cancelled too.
    const response = await fetch(upstream("/v1/chat/completions"), {
      method: "POST",
      headers,
      body: JSON.stringify(rewritten),
      signal: request.signal,
    })

    return jsonResponse(response)
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return failureResponse(error)
  }
}

async function passthrough(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const target = upstream(url.pathname + url.search)

    const headers = new Headers(request.headers)
    headers.delete("host")
    headers.delete("content-length")
    headers.delete("connection")
    headers.delete("keep-alive")
    headers.delete("proxy-authenticate")
    headers.delete("proxy-authorization")
    headers.delete("te")
    headers.delete("trailer")
    headers.delete("transfer-encoding")
    headers.delete("upgrade")

    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : request.body

    return jsonResponse(await fetch(target, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    }))
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return failureResponse(error)
  }
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch(request) {
    const url = new URL(request.url)

    try {
      if (url.pathname === "/health") {
        return Response.json({
          ok: true,
          service: SERVICE,
          pid: process.pid,
          upstream: OLLAMA_URL,
        })
      }

      if (url.pathname === "/v1/models" && request.method === "GET") {
        return models(request)
      }

      if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
        return chatCompletions(request)
      }

      return passthrough(request)
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 })
      return failureResponse(error)
    }
  },
})

console.error(`[qwen-thinking-proxy] listening on http://${HOST}:${PORT}`)
console.error(`[qwen-thinking-proxy] upstream: ${OLLAMA_URL}`)

function shutdown() {
  server.stop(true)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
