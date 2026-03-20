import type { NextApiRequest, NextApiResponse } from "next"

import type {
  AgentStepRecord,
  PageSnapshot,
  PlannerMemoryEntry
} from "~lib/agent/types"
import { isObject } from "~lib/agent/validation"
import { requireApiAuth } from "~lib/server/auth"
import { requestPlanFromOpenRouter } from "~lib/server/openrouter"

type RequestBody = {
  command: string
  snapshot: PageSnapshot
  history: AgentStepRecord[]
  memory?: PlannerMemoryEntry[]
}

const isValidMemoryEntry = (value: unknown): value is PlannerMemoryEntry => {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.question === "string" &&
    typeof value.answer === "string" &&
    typeof value.updatedAt === "string"
  )
}

const isValidBody = (body: unknown): body is RequestBody => {
  return (
    isObject(body) &&
    typeof body.command === "string" &&
    isObject(body.snapshot) &&
    Array.isArray(body.history) &&
    (body.memory === undefined ||
      (Array.isArray(body.memory) && body.memory.every(isValidMemoryEntry)))
  )
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  if (!isValidBody(req.body)) {
    res.status(400).json({ error: "Invalid request body" })
    return
  }

  try {
    if (!(await requireApiAuth(req, res))) {
      return
    }

    const plan = await requestPlanFromOpenRouter(req.body)
    res.status(200).json(plan)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(500).json({ error: message })
  }
}
