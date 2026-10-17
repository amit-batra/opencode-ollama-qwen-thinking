import { describe, expect, test } from "bun:test"

const script = await Bun.file("scripts/sync-version.ts").text()
const pkg = await Bun.file("package.json").json()
const docs = await Promise.all(
  ["README.md", "DEVELOP.md"].map(async (file) => [file, await Bun.file(file).text()] as const),
)

describe("sync-version script", () => {
  test("is wired into the npm version lifecycle", () => {
    expect(pkg.scripts.version).toBe("bun run sync:version")
    expect(pkg.scripts["sync:version"]).toBe("bun run scripts/sync-version.ts")
  })

  test("rewrites and stages the documentation it owns", () => {
    expect(script).toContain('"README.md"')
    expect(script).toContain('"DEVELOP.md"')
    expect(script).toContain('["add", "--", file]')
  })
})

describe("version references", () => {
  for (const [file, contents] of docs) {
    test(`${file} pins the published version`, () => {
      const pinned = contents.match(/opencode-ollama-qwen-thinking@\d+\.\d+\.\d+/g) ?? []
      const tarballs = contents.match(/opencode-ollama-qwen-thinking-\d+\.\d+\.\d+\.tgz/g) ?? []

      expect(pinned.length).toBeGreaterThan(0)

      for (const reference of [...pinned, ...tarballs]) {
        expect(reference).toContain(pkg.version)
      }
    })
  }
})