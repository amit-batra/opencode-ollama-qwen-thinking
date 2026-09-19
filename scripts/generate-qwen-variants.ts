#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"

const EFFORTS = ["none", "low", "medium", "xhigh"] as const
type Effort = (typeof EFFORTS)[number]

type JsonObject = Record<string, unknown>

function usage(): never {
  console.error(`
Usage:
  bun run scripts/generate-qwen-variants.ts --input <opencode.json> [options]

Options:
  --input <path>       Existing OpenCode JSON file (required)
  --output <path>      Output file. Defaults to <input>.qwen-thinking.json
  --in-place            Replace the input file instead of creating a new file
  --provider <id>      Provider ID. Defaults to "ollama"
  --model <id>         Base Qwen3.8 model ID. If omitted, auto-detects the
                       only Qwen3.8 model in the provider's models map.
  --force              Replace existing generated variant entries
  --help               Show this help

Examples:
  bun run scripts/generate-qwen-variants.ts --input ~/.config/opencode/opencode.json

  bun run scripts/generate-qwen-variants.ts \
    --input ./opencode.json \
    --output ./opencode-qwen-thinking.json \
    --model qwen3.8:27b-mlx

  bun run scripts/generate-qwen-variants.ts \
    --input ./opencode.json --in-place --force
`)
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") usage()
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`)

    const key = arg.slice(2)
    if (key === "in-place" || key === "force") {
      args[key] = true
      continue
    }

    const value = argv[++i]
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`)
    }
    args[key] = value
  }

  return args
}

function isQwen38(modelId: string) {
  return /^qwen3\.8:/i.test(modelId)
}

function variantId(baseModel: string, effort: Effort) {
  return `${baseModel}-effort-${effort}`
}

function variantName(baseName: string | undefined, effort: Effort) {
  const label = effort === "none"
    ? "No Thinking"
    : `${effort[0].toUpperCase()}${effort.slice(1)} Thinking`
  return baseName ? `${baseName} — ${label}` : `${effort} — Qwen3.8`
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const args = parseArgs(process.argv.slice(2))
const input = typeof args.input === "string" ? args.input : undefined
const inPlace = args["in-place"] === true

if (!input) {
  console.error("Error: --input is required.")
  usage()
}

if (inPlace && args.output) {
  throw new Error("--output cannot be combined with --in-place")
}

const providerId = typeof args.provider === "string" ? args.provider : "ollama"
const requestedModel = typeof args.model === "string" ? args.model : undefined

let source: JsonObject
try {
  source = JSON.parse(readFileSync(input, "utf8")) as JsonObject
} catch (error) {
  throw new Error(`Could not read/parse JSON file "${input}": ${String(error)}`)
}

const providerContainer =
  (source.provider as JsonObject | undefined) ??
  (source.providers as JsonObject | undefined)

if (!providerContainer || typeof providerContainer !== "object") {
  throw new Error('The config does not contain a "provider" or "providers" object.')
}

const provider = providerContainer[providerId] as JsonObject | undefined
if (!provider || typeof provider !== "object") {
  throw new Error(`Provider "${providerId}" was not found.`)
}

const models = provider.models as JsonObject | undefined
if (!models || typeof models !== "object") {
  throw new Error(`Provider "${providerId}" does not contain a "models" object.`)
}

let baseModel = requestedModel

if (!baseModel) {
  const candidates = Object.keys(models).filter(
    (modelId) => isQwen38(modelId) && !/-effort-(none|low|medium|xhigh)$/i.test(modelId),
  )

  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? `Could not auto-detect a Qwen3.8 base model in provider "${providerId}". Use --model <id>.`
        : `Found multiple Qwen3.8 base models (${candidates.join(", ")}). Use --model <id>.`,
    )
  }

  baseModel = candidates[0]
}

if (!isQwen38(baseModel)) {
  throw new Error(`Model "${baseModel}" is not a Qwen3.8 model.`)
}

const baseEntry = models[baseModel] as JsonObject | undefined
if (!baseEntry || typeof baseEntry !== "object") {
  throw new Error(`Model "${baseModel}" was not found under provider "${providerId}".`)
}

const force = args.force === true
const generated: string[] = []
const skipped: string[] = []

for (const effort of EFFORTS) {
  const id = variantId(baseModel, effort)

  if (models[id] !== undefined && !force) {
    skipped.push(id)
    continue
  }

  const entry = clone(baseEntry)
  const originalName = typeof entry.name === "string" ? entry.name : undefined

  if ("modelID" in entry) {
    entry.modelID = id
  }

  entry.name = variantName(originalName, effort)
  models[id] = entry
  generated.push(id)
}

const output = inPlace
  ? input
  : typeof args.output === "string"
    ? args.output
    : `${input}.qwen-thinking.json`

writeFileSync(output, JSON.stringify(source, null, 2) + "\n", "utf8")

console.log(`Generated ${generated.length} Qwen3.8 reasoning entries in ${output}`)
for (const id of generated) console.log(`  + ${id}`)
for (const id of skipped) console.log(`  = ${id} (already exists; use --force to replace)`)
