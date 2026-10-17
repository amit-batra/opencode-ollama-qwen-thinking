#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const FILES = ["README.md", "DEVELOP.md"]

type PackageJson = { name?: string; version?: string }

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson
const name = pkg.name
const version = pkg.version

if (!name || !version) {
  throw new Error("package.json is missing a name or version")
}

if (name !== "opencode-ollama-qwen-thinking") {
  throw new Error(`Unexpected package name "${name}"`)
}

const semver = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

const patterns: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: new RegExp(`(${escape(name)})@${semver}`, "g"),
    replacement: `$1@${version}`,
  },
  {
    pattern: new RegExp(`(${escape(name)}-)(${semver})(\\.tgz)`, "g"),
    replacement: `$1${version}$3`,
  },
]

const changed: string[] = []

for (const file of FILES) {
  const original = readFileSync(file, "utf8")
  let updated = original

  for (const { pattern, replacement } of patterns) {
    updated = updated.replace(pattern, replacement)
  }

  if (updated === original) continue

  writeFileSync(file, updated, "utf8")
  changed.push(file)
}

if (changed.length === 0) {
  console.log(`Version references already match ${version}`)
  process.exit(0)
}

for (const file of changed) {
  try {
    execFileSync("git", ["add", "--", file], { stdio: "ignore" })
  } catch {
    console.error(`Warning: could not stage ${file}. Stage it manually before releasing.`)
  }
}

console.log(`Updated version references to ${version} in: ${changed.join(", ")}`)