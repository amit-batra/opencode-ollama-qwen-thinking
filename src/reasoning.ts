export const EFFORTS = ["none", "low", "medium", "xhigh"] as const

export type ReasoningEffort = (typeof EFFORTS)[number]

const SUFFIX = /-effort-(none|low|medium|xhigh)$/i

export function decodeModel(model: string): {
  upstreamModel: string
  reasoningEffort?: ReasoningEffort
} {
  const match = model.match(SUFFIX)

  if (!match) {
    return { upstreamModel: model }
  }

  return {
    upstreamModel: model.slice(0, -match[0].length),
    reasoningEffort: match[1].toLowerCase() as ReasoningEffort,
  }
}

export function isQwen38(model: string): boolean {
  return model.toLowerCase().startsWith("qwen3.8:")
}

export function rewriteRequest(body: Record<string, unknown>) {
  if (typeof body.model !== "string") return body

  const decoded = decodeModel(body.model)

  if (!decoded.reasoningEffort || !isQwen38(decoded.upstreamModel)) {
    return body
  }

  return {
    ...body,
    model: decoded.upstreamModel,
    reasoning_effort: decoded.reasoningEffort,
  }
}

export function variantModels(baseModel: string): string[] {
  if (!isQwen38(baseModel)) return []

  return EFFORTS.map((effort) => `${baseModel}-effort-${effort}`)
}
