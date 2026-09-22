import type { Plugin } from "@opencode-ai/plugin"

const HOST = process.env.QWEN_THINKING_PROXY_HOST ?? "127.0.0.1"
const PORT = Number(process.env.QWEN_THINKING_PROXY_PORT ?? "11437")
const PROXY_BASE = `http://${HOST}:${PORT}`
const PROXY_URL = `${PROXY_BASE}/v1`
const PROXY_SERVICE = "opencode-ollama-qwen-thinking"

type ProxyHealth = {
  ok?: boolean
  service?: string
  pid?: number
}

let proxyProcess: ReturnType<typeof Bun.spawn> | undefined
let proxyStartup: Promise<void> | undefined

async function getProxyHealth(): Promise<ProxyHealth | undefined> {
  try {
    const response = await fetch(`${PROXY_BASE}/health`)
    if (!response.ok) return undefined

    return await response.json() as ProxyHealth
  } catch {
    return undefined
  }
}

async function waitForProxy(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const health = await getProxyHealth()
    if (health?.ok === true && health.service === PROXY_SERVICE) return true

    await Bun.sleep(100)
  }

  return false
}

function watchProxy(child: ReturnType<typeof Bun.spawn>) {
  void child.exited.then(() => {
    if (proxyProcess === child) {
      proxyProcess = undefined
    }
  })
}

async function startProxy() {
  const existing = await getProxyHealth()
  if (existing?.ok === true && existing.service === PROXY_SERVICE) {
    // A proxy left behind by an earlier OpenCode instance can be adopted.
    // It will be terminated by this plugin's dispose hook.
    return
  }

  const proxyPath = new URL("./proxy.ts", import.meta.url).pathname
  const child = Bun.spawn(["bun", "run", proxyPath], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "inherit",
    env: {
      ...process.env,
    },
  })

  proxyProcess = child
  watchProxy(child)

  const ready = await waitForProxy()
  if (!ready) {
    if (proxyProcess === child) proxyProcess = undefined
    child.kill()
    throw new Error(
      `Qwen thinking proxy failed to start on ${HOST}:${PORT}`,
    )
  }
}

async function ensureProxy() {
  if (process.env.QWEN_THINKING_DISABLE_PROXY === "1") return

  if (await waitForProxy(250)) return

  // Serialize concurrent plugin initialisation so only one child can bind
  // the proxy port.
  if (!proxyStartup) {
    proxyStartup = startProxy()
  }

  try {
    await proxyStartup
  } finally {
    // Keep the promise only while startup is in progress. A subsequent
    // failure can therefore retry normally.
    proxyStartup = undefined
  }

  if (!(await waitForProxy(1000))) {
    throw new Error(
      `Qwen thinking proxy did not become healthy on ${HOST}:${PORT}`,
    )
  }
}

async function stopProxy() {
  const child = proxyProcess
  proxyProcess = undefined

  if (!child) return

  try {
    child.kill("SIGTERM")
  } catch {
    // The process may already have exited.
  }

  await child.exited
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

    // V1 plugin lifecycle hook. OpenCode invokes this when the plugin is
    // unloaded/reloaded, preventing orphaned proxy processes.
    dispose: stopProxy,
  }
}

export default QwenThinkingPlugin
