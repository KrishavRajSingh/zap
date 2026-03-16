import type { NextApiRequest, NextApiResponse } from "next"

import { requestPlanFromOpenRouter } from "~lib/server/openrouter"
import type { AgentStepRecord, PageSnapshot } from "~lib/agent/types"
import { isObject } from "~lib/agent/validation"

type RequestBody = {
  command: string
  snapshot: PageSnapshot
  history: AgentStepRecord[]
}

const isValidBody = (body: unknown): body is RequestBody => {
  return (
    isObject(body) &&
    typeof body.command === "string" &&
    isObject(body.snapshot) &&
    Array.isArray(body.history)
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
    const plan = await requestPlanFromOpenRouter(req.body)
    res.status(200).json(plan)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(500).json({ error: message })
  }
}
