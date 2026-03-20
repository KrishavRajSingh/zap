import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { NextApiRequest, NextApiResponse } from "next"

import type { AgentRunLog } from "~lib/agent/types"
import { isObject } from "~lib/agent/validation"
import { requireApiAuth } from "~lib/server/auth"

const LOG_ROOT_DIRECTORY = ".zap-logs"
const SHOULD_PERSIST_RUN_LOGS =
  process.env.PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS?.trim().toLowerCase() === "true"

const sanitizeSegment = (value: string) => {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)

  return sanitized.length > 0 ? sanitized : "run"
}

const isValidRunLogBody = (body: unknown): body is AgentRunLog => {
  return (
    isObject(body) &&
    typeof body.runId === "string" &&
    typeof body.command === "string" &&
    typeof body.initialUrl === "string" &&
    typeof body.startedAt === "string" &&
    typeof body.finishedAt === "string" &&
    isObject(body.final) &&
    typeof body.final.success === "boolean" &&
    typeof body.final.message === "string" &&
    Array.isArray(body.steps)
  )
}

const normalizeDayFolder = (timestamp: string) => {
  const parsed = Date.parse(timestamp)

  if (Number.isNaN(parsed)) {
    return new Date().toISOString().slice(0, 10)
  }

  return new Date(parsed).toISOString().slice(0, 10)
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  if (!SHOULD_PERSIST_RUN_LOGS) {
    res.status(200).json({
      ok: true,
      skipped: true,
      message: "Run log saving is disabled by PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS"
    })
    return
  }

  if (!isValidRunLogBody(req.body)) {
    res.status(400).json({ error: "Invalid request body" })
    return
  }

  try {
    const authUser = await requireApiAuth(req, res)

    if (!authUser) {
      return
    }

    const dayFolder = normalizeDayFolder(req.body.finishedAt)
    const directoryPath = join(process.cwd(), LOG_ROOT_DIRECTORY, dayFolder)
    const fileName = `${sanitizeSegment(req.body.runId)}.json`
    const filePath = join(directoryPath, fileName)

    await mkdir(directoryPath, { recursive: true })
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          ...req.body,
          auth: {
            userId: authUser.id,
            email: authUser.email
          },
          savedAt: new Date().toISOString(),
          schemaVersion: 1
        },
        null,
        2
      )}\n`,
      "utf-8"
    )

    res.status(200).json({ ok: true, path: filePath })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(500).json({ error: message })
  }
}
