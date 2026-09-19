# OpenCode Ollama Qwen Thinking

An OpenCode plugin + local proxy that makes Qwen3.8 reasoning levels work transparently with Ollama.

OpenCode's Ollama integration uses the OpenAI-compatible `/v1/chat/completions` endpoint. OpenCode 1.18.x does not reliably forward arbitrary `reasoning_effort` request-body fields through the AI SDK. This project solves that at the HTTP boundary: the plugin starts a small localhost proxy and points the Ollama provider at it; the proxy rewrites Qwen3.8 model-name suffixes into Ollama's `reasoning_effort` field.

## Supported models

The proxy is model-agnostic and will rewrite any Qwen3.8 model:

- `qwen3.8:27b-mlx`
- `qwen3.8:27b-mtp-q4_K_M`

and exposes reasoning variants:

- `qwen3.8:27b-mlx-effort-none`
- `qwen3.8:27b-mlx-effort-low`
- `qwen3.8:27b-mlx-effort-medium`
- `qwen3.8:27b-mlx-effort-xhigh`
- `qwen3.8:27b-mtp-q4_K_M-effort-none`
- `qwen3.8:27b-mtp-q4_K_M-effort-low`
- `qwen3.8:27b-mtp-q4_K_M-effort-medium`
- `qwen3.8:27b-mtp-q4_K_M-effort-xhigh`

The unsuffixed model is passed through unchanged.

## Architecture

```
OpenCode
   |
   | OpenAI-compatible request
   v
Qwen Thinking Proxy :11437
   |
   | qwen3.8:27b-mlx-effort-medium
   |        -> model=qwen3.8:27b-mlx
   |        -> reasoning_effort=medium
   v
Ollama :11434
```

The proxy is started automatically by the OpenCode plugin. No separate service manager is required.

## Installation

### From this repository

Clone it:

```bash
git clone https://github.com/amit-batra/opencode-ollama-qwen-thinking.git
```

Then add the plugin path to your OpenCode configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "/absolute/path/to/opencode-ollama-qwen-thinking"
  ]
}
```

OpenCode supports global and project plugins. If you prefer a global installation, place the repository under `~/.config/opencode/plugins/` and configure it according to your OpenCode version.

### npm package

This repository is structured so it can later be published as an npm package. Until a package release is published, use the local repository path.

## Using the models

After restarting OpenCode, select one of the following model IDs:

```
ollama/qwen3.8:27b-mlx-effort-none
ollama/qwen3.8:27b-mlx-effort-low
ollama/qwen3.8:27b-mlx-effort-medium
ollama/qwen3.8:27b-mlx-effort-xhigh

ollama/qwen3.8:27b-mtp-q4_K_M-effort-none
ollama/qwen3.8:27b-mtp-q4_K_M-effort-low
ollama/qwen3.8:27b-mtp-q4_K_M-effort-medium
ollama/qwen3.8:27b-mtp-q4_K_M-effort-xhigh
```

The original model IDs remain valid:

```
ollama/qwen3.8:27b-mlx
ollama/qwen3.8:27b-mtp-q4_K_M
```

For an unsuffixed model, the request is forwarded without a `reasoning_effort` override, preserving Ollama's default behavior.

## Configuration

Environment variables:

| Variable | Default | Purpose |
|---|---:|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama upstream |
| `QWEN_THINKING_PROXY_HOST` | `127.0.0.1` | Proxy bind address |
| `QWEN_THINKING_PROXY_PORT` | `11437` | Proxy port |
| `QWEN_THINKING_DEBUG` | `0` | Log request rewrites |
| `QWEN_THINKING_DISABLE_PROXY` | `0` | Do not auto-start the proxy |

For example:

```bash
QWEN_THINKING_DEBUG=1 opencode
```

## How it works

A request for:

```
qwen3.8:27b-mlx-effort-medium
```

is transformed into:

```json
{
  "model": "qwen3.8:27b-mlx",
  "reasoning_effort": "medium"
}
```

and forwarded to:

```
http://127.0.0.1:11434/v1/chat/completions
```

The proxy does not alter messages, tools, sampling parameters, streaming, or response bodies.

For `none`, the proxy sends `reasoning_effort: "none"`. This is important for Qwen3.8 because recent Ollama reports show that `think: false` can be intermittent through the OpenAI-compatible endpoint while `reasoning_effort: "none"` is reliable.

## Health check

Once OpenCode has started the plugin:

```bash
curl http://127.0.0.1:11437/health
```

Expected:

```json
{"ok":true}
```

List models through the proxy:

```bash
curl -s http://127.0.0.1:11437/v1/models | jq
```

## Debugging

Enable request logging:

```bash
QWEN_THINKING_DEBUG=1 opencode
```

You should see entries similar to:

```
[proxy] qwen3.8:27b-mlx-effort-medium
        -> qwen3.8:27b-mlx
        reasoning_effort=medium
```

This gives a direct way to verify that the thinking level is actually reaching Ollama.

## Requirements

- macOS or Linux
- OpenCode 1.18.x
- Ollama with an OpenAI-compatible `/v1` endpoint
- Bun (OpenCode itself uses Bun for its plugin runtime)
- Qwen3.8 model support in your Ollama version

## Why a proxy?

OpenCode plugins expose `chat.params`, but that hook is intended for parameters such as temperature, top-p, and provider options. The OpenAI-compatible provider controls which request-body fields ultimately reach Ollama. A localhost HTTP proxy operates after that filtering, so it can reliably rewrite the actual request sent to Ollama.

This is also why the plugin and proxy live in one repository: the plugin is just the lifecycle/bootstrapping layer; the proxy contains the protocol logic.

## Development

Install dependencies:

```bash
bun install
```

Run the proxy directly:

```bun
bun run src/proxy.ts
```

Run tests:

```bash
bun test
```

## License

MIT
