import { afterAll, beforeAll, expect, test } from "bun:test"
import { connect } from "node:net"

const UPSTREAM_PORT = 31537
const PROXY_PORT = 31538
const PROXY_HOST = "127.0.0.1"

// Must exceed Bun.serve's default 10s idleTimeout, which is what this file guards.
const STREAM_GAP_MS = 12_000
const IDLE_SOCKET_MS = 12_000
const SLOW = { timeout: 30_000 }

const PROXY_PATH = new URL("../src/proxy.ts", import.meta.url).pathname

type Upstream = {
  server: ReturnType<typeof Bun.serve>
  lastBody: () => Record<string, unknown> | undefined
}

let upstream: Upstream
let proxy: ReturnType<typeof Bun.spawn>

function sseChunk(model: string, content: string) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`
}

async function waitForHealth(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/health`)
      if (response.ok) return await response.json() as Record<string, unknown>
    } catch {
      // Proxy not listening yet.
    }
    await Bun.sleep(50)
  }

  throw new Error(`proxy did not become healthy on ${PROXY_HOST}:${PROXY_PORT}`)
}

beforeAll(async () => {
  let lastBody: Record<string, unknown> | undefined

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: UPSTREAM_PORT,
    // The fake upstream must disable its own idle timeout, otherwise it stalls
    // first and these tests fail for the wrong reason.
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)

      if (url.pathname === "/v1/models") {
        return Response.json({
          object: "list",
          data: [{ id: "qwen3.8:27b", object: "model", owned_by: "library" }],
        })
      }

      if (url.pathname !== "/v1/chat/completions") {
        return new Response("not found", { status: 404 })
      }

      lastBody = await request.json() as Record<string, unknown>
      const model = String(lastBody.model)

      if (lastBody.stream !== true) {
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          model,
          choices: [{
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          }],
        })
      }

      const encoder = new TextEncoder()

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(sseChunk(model, "before")))
          await Bun.sleep(STREAM_GAP_MS)
          controller.enqueue(encoder.encode(sseChunk(model, "after")))
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        },
      })

      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })

  upstream = { server, lastBody: () => lastBody }

  proxy = Bun.spawn(["bun", "run", PROXY_PATH], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
    env: {
      ...process.env,
      OLLAMA_URL: `http://127.0.0.1:${UPSTREAM_PORT}`,
      QWEN_THINKING_PROXY_HOST: PROXY_HOST,
      QWEN_THINKING_PROXY_PORT: String(PROXY_PORT),
    },
  })

  await waitForHealth()
})

afterAll(() => {
  proxy?.kill()
  upstream?.server.stop(true)
})

test("reports the disabled idle timeout on /health", async () => {
  const health = await waitForHealth()

  expect(health.ok).toBe(true)
  expect(health.idleTimeout).toBe(0)
})

test("rewrites the effort suffix before forwarding upstream", async () => {
  // Uses a non-streaming request and drains it fully. Abandoning an in-flight
  // streaming request here leaves an aborted connection on the proxy that makes
  // the idle-timeout test below pass regardless of the proxy's configuration.
  const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "qwen3.8:27b-effort-medium",
      messages: [],
      stream: false,
    }),
  })

  expect(response.status).toBe(200)
  await response.text()

  expect(upstream.lastBody()).toMatchObject({
    model: "qwen3.8:27b",
    reasoning_effort: "medium",
  })
})

test("streams a response through a gap longer than the default 10s idle timeout", SLOW, async () => {
  const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "qwen3.8:27b-effort-low",
      messages: [],
      stream: true,
    }),
  })

  expect(response.status).toBe(200)

  // Without idleTimeout disabled this read rejects with ECONNRESET.
  const body = await response.text()

  expect(body).toContain('"content":"before"')
  expect(body).toContain('"content":"after"')
  expect(body).toContain("[DONE]")
})

test("keeps an idle keep-alive socket usable for a second request", SLOW, async () => {
  const socket = connect({ host: PROXY_HOST, port: PROXY_PORT })
  await new Promise((resolve) => socket.once("connect", resolve))

  const sendRequest = (model: string) => {
    const body = JSON.stringify({ model, messages: [], stream: false })
    socket.write(
      `POST /v1/chat/completions HTTP/1.1\r\n` +
      `Host: ${PROXY_HOST}:${PROXY_PORT}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: keep-alive\r\n\r\n${body}`,
    )
  }

  const readResponse = () => new Promise<string>((resolve, reject) => {
    let received = ""
    const onData = (chunk: Buffer) => {
      received += chunk.toString()
      const headerEnd = received.indexOf("\r\n\r\n")
      if (headerEnd === -1) return

      const length = /Content-Length: (\d+)/i.exec(received)?.[1]
      if (length && received.length - headerEnd - 4 >= Number(length)) {
        cleanup()
        resolve(received)
      }
    }
    // Without idleTimeout disabled the proxy closes this socket while it sits
    // idle, so surface that as a failure instead of hanging to the test timeout.
    const onClose = () => {
      cleanup()
      reject(new Error("proxy closed the keep-alive socket while it was idle"))
    }
    const cleanup = () => {
      socket.off("data", onData)
      socket.off("close", onClose)
      socket.off("error", onError)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    socket.on("data", onData)
    socket.once("close", onClose)
    socket.once("error", onError)
  })

  try {
    sendRequest("qwen3.8:27b-effort-low")
    expect(await readResponse()).toStartWith("HTTP/1.1 200")

    // Without idleTimeout disabled the proxy closes this socket first.
    await Bun.sleep(IDLE_SOCKET_MS)

    sendRequest("qwen3.8:27b-effort-high")
    expect(await readResponse()).toStartWith("HTTP/1.1 200")
  } finally {
    socket.destroy()
  }
})
