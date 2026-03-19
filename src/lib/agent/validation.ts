import type { AgentAction, AgentPlan, ElementCandidate } from "~lib/agent/types"

const ACTION_TYPES = new Set([
  "open_url",
  "click",
  "type_text",
  "press_key",
  "scroll",
  "wait",
  "extract_text",
  "finish"
])

export const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

export const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    const firstBrace = text.indexOf("{")
    const lastBrace = text.lastIndexOf("}")

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null
    }

    const sliced = text.slice(firstBrace, lastBrace + 1)

    try {
      return JSON.parse(sliced)
    } catch {
      return null
    }
  }
}

const isAction = (input: unknown): input is AgentAction => {
  if (!isObject(input) || typeof input.type !== "string") {
    return false
  }

  if (!ACTION_TYPES.has(input.type)) {
    return false
  }

  switch (input.type) {
    case "open_url":
      return typeof input.url === "string"
    case "click":
      return typeof input.eid === "string"
    case "type_text":
      return typeof input.eid === "string" && typeof input.text === "string"
    case "press_key":
      return typeof input.key === "string"
    case "scroll":
      return (
        (input.direction === "up" || input.direction === "down") &&
        (input.amount === undefined || typeof input.amount === "number")
      )
    case "wait":
      return typeof input.ms === "number"
    case "extract_text":
      return typeof input.eid === "string"
    case "finish":
      return (
        typeof input.message === "string" &&
        (input.success === undefined || typeof input.success === "boolean")
      )
    default:
      return false
  }
}

export const isAgentPlan = (input: unknown): input is AgentPlan => {
  return (
    isObject(input) &&
    typeof input.rationale === "string" &&
    isAction(input.action)
  )
}

export const findCandidate = (
  candidates: ElementCandidate[],
  eid: string
): ElementCandidate | undefined => {
  return candidates.find((candidate) => candidate.eid === eid)
}

export const isSensitiveAction = (
  action: AgentAction,
  candidates: ElementCandidate[]
): boolean => {
  if (action.type !== "click") {
    return false
  }

  const candidate = findCandidate(candidates, action.eid)

  if (!candidate) {
    return true
  }

  const text = `${candidate.text} ${candidate.label}`.toLowerCase()

  return /create|delete|remove|submit|publish|save|confirm|pay|send/.test(text)
}
