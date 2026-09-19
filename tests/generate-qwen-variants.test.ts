import { describe, expect, test } from "bun:test"

const script = await Bun.file("scripts/generate-qwen-variants.ts").text()

describe("generate-qwen-variants script", () => {
  test("defines all four reasoning levels", () => {
    expect(script).toContain('["none", "low", "medium", "xhigh"]')
  })

  test("supports in-place and force modes", () => {
    expect(script).toContain('"in-place"')
    expect(script).toContain('"force"')
  })

  test("updates explicit modelID values", () => {
    expect(script).toContain("entry.modelID = id")
  })
})
