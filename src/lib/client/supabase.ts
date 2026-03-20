import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL =
  process.env.PLASMO_PUBLIC_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ""
const SUPABASE_ANON_KEY =
  process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ""
const AGENT_API_BASE =
  process.env.PLASMO_PUBLIC_AGENT_API_BASE ??
  process.env.NEXT_PUBLIC_AGENT_API_BASE ??
  "http://localhost:1947"
const AUTH_CONFIRM_PATH = "/auth/confirmed"

let browserSupabaseClient: ReturnType<typeof createClient> | null = null

export const hasSupabaseBrowserEnv = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const getSupabaseEmailRedirectUrl = () => {
  try {
    return new URL(AUTH_CONFIRM_PATH, AGENT_API_BASE).toString()
  } catch {
    return `http://localhost:1947${AUTH_CONFIRM_PATH}`
  }
}

export const getSupabaseBrowserClient = () => {
  if (!hasSupabaseBrowserEnv) {
    throw new Error(
      "Supabase is not configured. Set PLASMO_PUBLIC_SUPABASE_URL and PLASMO_PUBLIC_SUPABASE_ANON_KEY."
    )
  }

  if (!browserSupabaseClient) {
    browserSupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce"
      }
    })
  }

  return browserSupabaseClient
}
