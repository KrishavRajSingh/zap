import { createClient } from "@supabase/supabase-js"
import type { NextApiRequest, NextApiResponse } from "next"

type ApiErrorPayload = {
  error: string
}

export type AuthenticatedApiUser = {
  id: string
  email: string | null
}

const getSupabaseServerEnv = () => {
  const url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.PLASMO_PUBLIC_SUPABASE_URL ??
    ""
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY ??
    ""

  return {
    url: url.trim(),
    anonKey: anonKey.trim()
  }
}

export const hasSupabaseServerEnv = () => {
  const { url, anonKey } = getSupabaseServerEnv()
  return Boolean(url && anonKey)
}

let serverSupabaseClient: ReturnType<typeof createClient> | null = null

const getServerSupabaseClient = () => {
  if (serverSupabaseClient) {
    return serverSupabaseClient
  }

  const { url, anonKey } = getSupabaseServerEnv()

  if (!url || !anonKey) {
    throw new Error(
      "Supabase auth is not configured. Set SUPABASE_URL/SUPABASE_ANON_KEY or PLASMO_PUBLIC_SUPABASE_URL/PLASMO_PUBLIC_SUPABASE_ANON_KEY."
    )
  }

  serverSupabaseClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  return serverSupabaseClient
}

const readBearerToken = (req: NextApiRequest) => {
  const headerValue = req.headers.authorization

  if (typeof headerValue !== "string") {
    return null
  }

  const [scheme, token] = headerValue.split(" ")

  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null
  }

  const trimmedToken = token.trim()
  return trimmedToken.length > 0 ? trimmedToken : null
}

export const requireApiAuth = async (
  req: NextApiRequest,
  res: NextApiResponse<ApiErrorPayload>
): Promise<AuthenticatedApiUser | null> => {
  if (!hasSupabaseServerEnv()) {
    res.status(500).json({
      error:
        "Supabase auth is not configured. Set SUPABASE_URL/SUPABASE_ANON_KEY or PLASMO_PUBLIC_SUPABASE_URL/PLASMO_PUBLIC_SUPABASE_ANON_KEY."
    })
    return null
  }

  const token = readBearerToken(req)

  if (!token) {
    res.status(401).json({ error: "Authentication required" })
    return null
  }

  const supabase = getServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired access token" })
    return null
  }

  return {
    id: data.user.id,
    email: data.user.email ?? null
  }
}
