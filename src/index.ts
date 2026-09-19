import type { Plugin } from "@opencode-ai/plugin"

const HOST = process.env.QWEN_THINKING_PROXY_HOST ?? "127.0.0.1"
const PORT = Number(process.env.QWEN_THINKING_PROXY_PORT ?? "11437")
const PROXY_URL = `http://${HOST}:${PORT}/v1`

let proxyProcess: ReturnType<typeof Bun.spawn> | undefined

async function waitForProxy(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${HOST}:${PORT}/health`)
      if (response.ok) return true
    } catch {
      // Proxy is not ready yet.
    }

    await Bun.sleep(100)
  }

  return false
}

async function ensureProxy() {
  if (process.env.QWEN_THINKING_DISABLE_PROXY === "1") return

  if (await waitForProxy()) return

  const proxyPath = new URL("./proxy.ts", import.meta.url).pathname

  proxyProcess = Bun.spawn(["bun", "run", proxyPath], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
    },
  })

  const ready = await waitForProxy()
  if (!ready) {
    proxyProcess.kill()
    throw new Error(
      `Qwen thinking proxy failed to start on ${HOST}:${PORT}`,
    )
  }
}

export const QwenThinkingPlugin: Plugin = async () => {
  await ensureProxy()

  return {
    config: async (config: any) => {
      if (process.env.QWEN_THINKING_DISABLE_PROXY === "1") return

      config.provider ??= {}
      config.provider.ollama ??= {}
      config.provider.ollama.options ??= {}

      // Keep Ollama's provider/model definitions intact. Only redirect
      // the OpenAI-compatible HTTP endpoint through our localhost proxy.
      config.provider.ollama.options.baseURL = PROXY_URL
    },
  }
}

export default QwenThinkingPlugin
