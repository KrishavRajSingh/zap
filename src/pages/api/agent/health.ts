import type { NextApiRequest, NextApiResponse } from "next"

import { hasSupabaseServerEnv } from "~lib/server/auth"

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    ok: true,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
    authRequired: true,
    hasSupabaseConfig: hasSupabaseServerEnv()
  })
}
