import { expect, test, describe } from "bun:test"
import { decodeModel, isQwen38, rewriteRequest, variantModels } from "../src/reasoning"

describe("decodeModel", () => {
  test("decodes all supported effort levels", () => {
    for (const effort of ["none", "low", "medium", "xhigh"]) {
      expect(decodeModel(`qwen3.8:27b-mlx-effort-${effort}`)).toEqual({
        upstreamModel: "qwen3.8:27b-mlx",
        reasoningEffort: effort,
      })
    }
  })

  test("leaves ordinary model IDs untouched", () => {
    expect(decodeModel("qwen3.8:27b-mlx")).toEqual({
      upstreamModel: "qwen3.8:27b-mlx",
    })
  })
})

describe("rewriteRequest", () => {
  test("rewrites a Qwen3.8 reasoning variant", () => {
    expect(rewriteRequest({
      model: "qwen3.8:27b-mlx-effort-medium",
      messages: [],
      stream: true,
    })).toEqual({
      model: "qwen3.8:27b-mlx",
      messages: [],
      stream: true,
      reasoning_effort: "medium",
    })
  })

  test("does not rewrite non-Qwen models", () => {
    const body = { model: "llama3.2:latest", messages: [] }
    expect(rewriteRequest(body)).toEqual(body)
  })
})

test("variantModels", () => {
  expect(variantModels("qwen3.8:27b-mlx")).toHaveLength(4)
  expect(isQwen38("qwen3.8:27b-mlx")).toBe(true)
})
