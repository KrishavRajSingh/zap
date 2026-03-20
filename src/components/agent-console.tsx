import type { Session } from "@supabase/supabase-js"
import { useEffect, useMemo, useState } from "react"

import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentRuntimeMessage
} from "~lib/agent/messages"
import type { AgentMemoryEntry } from "~lib/agent/types"
import {
  getSupabaseBrowserClient,
  getSupabaseEmailRedirectUrl,
  hasSupabaseBrowserEnv
} from "~lib/client/supabase"

const sendRuntimeMessage = async <T,>(message: AgentRuntimeMessage) => {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const lastError = chrome.runtime.lastError

      if (lastError) {
        reject(new Error(lastError.message))
        return
      }

      resolve(response)
    })
  })
}

const actionSummary = (event: AgentEvent) => {
  if (event.type === "step_planned") {
    return `Step ${event.step}: ${event.action.type}`
  }

  if (event.type === "step_result") {
    return `Step ${event.step}: ${event.record.result} - ${event.record.details}`
  }

  if (event.type === "run_started") {
    return `Run started on ${event.url}`
  }

  if (event.type === "run_error") {
    return `Error: ${event.message}`
  }

  if (event.type === "confirmation_required") {
    return `Confirmation needed for ${event.action.type}`
  }

  if (event.type === "run_finished") {
    return event.success
      ? `Done: ${event.message}`
      : `Stopped: ${event.message}`
  }

  if (event.type === "run_log_saved") {
    return event.message
  }

  return ""
}

const eventLabel = (event: AgentEvent) => {
  if (event.type === "run_started") {
    return "RUN"
  }

  if (event.type === "step_planned") {
    return "PLAN"
  }

  if (event.type === "step_result") {
    return event.record.result === "success" ? "OK" : "FAIL"
  }

  if (event.type === "confirmation_required") {
    return "HOLD"
  }

  if (event.type === "run_finished") {
    return event.success ? "DONE" : "STOP"
  }

  if (event.type === "run_log_saved") {
    return event.ok ? "LOG" : "WARN"
  }

  return "ERROR"
}

const eventTone = (event: AgentEvent) => {
  if (event.type === "step_result") {
    return event.record.result === "success"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-red-300 bg-red-50 text-red-800"
  }

  if (event.type === "run_error") {
    return "border-red-300 bg-red-50 text-red-800"
  }

  if (event.type === "confirmation_required") {
    return "border-amber-300 bg-amber-50 text-amber-900"
  }

  if (event.type === "run_finished") {
    return event.success
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-amber-300 bg-amber-50 text-amber-900"
  }

  if (event.type === "run_log_saved") {
    return event.ok
      ? "border-sky-300 bg-sky-50 text-sky-900"
      : "border-amber-300 bg-amber-50 text-amber-900"
  }

  return "border-zinc-300 bg-zinc-100 text-zinc-800"
}

type StartResponse =
  | {
      ok: true
      runId: string
    }
  | {
      ok: false
      error: string
    }

type GenericResponse = {
  ok: boolean
  error?: string
}

type HealthResponse =
  | {
      ok: true
      health: {
        ok: boolean
        hasOpenRouterKey: boolean
        model: string
        authRequired: boolean
        hasSupabaseConfig: boolean
      }
    }
  | {
      ok: false
      error: string
    }

type MemoryListResponse =
  | {
      ok: true
      entries: AgentMemoryEntry[]
    }
  | {
      ok: false
      error: string
    }

type MemoryMutateResponse =
  | {
      ok: true
      entries: AgentMemoryEntry[]
    }
  | {
      ok: false
      error: string
    }

export const AgentConsole = ({ compact = false }: { compact?: boolean }) => {
  const [command, setCommand] = useState("")
  const [runId, setRunId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] =
    useState<AgentEvent | null>(null)
  const [memoryEntries, setMemoryEntries] = useState<AgentMemoryEntry[]>([])
  const [memoryQuestion, setMemoryQuestion] = useState("")
  const [memoryAnswer, setMemoryAnswer] = useState("")
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null)
  const [memoryExpanded, setMemoryExpanded] = useState(false)
  const [authEmail, setAuthEmail] = useState("")
  const [authPassword, setAuthPassword] = useState("")
  const [authBusy, setAuthBusy] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const handler = (message: AgentEventEnvelope) => {
      if (message?.type !== "agent/event") {
        return
      }

      const event = message.event

      if (runId && "runId" in event && event.runId !== runId) {
        return
      }

      setEvents((previous) => [...previous, event])

      if (event.type === "confirmation_required") {
        setPendingConfirmation(event)
      }

      if (event.type === "run_finished") {
        setBusy(false)
        setPendingConfirmation(null)

        if (!event.success) {
          setError(event.message)
        }
      }

      if (event.type === "run_error") {
        setError(event.message)
      }

      if (event.type === "run_log_saved" && !event.ok) {
        setError(event.message)
      }
    }

    chrome.runtime.onMessage.addListener(handler)

    return () => {
      chrome.runtime.onMessage.removeListener(handler)
    }
  }, [runId])

  const logs = useMemo(() => {
    return events
      .filter(
        (event) => !(event.type === "run_log_saved" && event.skipped === true)
      )
      .map((event, index) => ({
        key: `${index}-${event.type}`,
        text: actionSummary(event),
        event
      }))
  }, [events])

  const syncAuthSessionToRuntime = async (session: Session | null) => {
    const response = await sendRuntimeMessage<GenericResponse>({
      type: "agent/auth/session",
      session: session
        ? {
            accessToken: session.access_token,
            expiresAt: session.expires_at ?? null,
            userId: session.user.id,
            email: session.user.email ?? null
          }
        : null
    })

    if (!response.ok) {
      throw new Error(response.error ?? "Could not sync auth session")
    }
  }

  useEffect(() => {
    if (!hasSupabaseBrowserEnv) {
      setAuthReady(true)
      return
    }

    const supabase = getSupabaseBrowserClient()
    let mounted = true

    const bootstrap = async () => {
      try {
        const {
          data: { session },
          error: sessionError
        } = await supabase.auth.getSession()

        if (sessionError) {
          throw sessionError
        }

        if (!mounted) {
          return
        }

        setAuthUserEmail(session?.user.email ?? null)
        await syncAuthSessionToRuntime(session)
      } catch (cause) {
        if (mounted) {
          setAuthError(
            cause instanceof Error
              ? cause.message
              : "Could not load auth session"
          )
        }
      } finally {
        if (mounted) {
          setAuthReady(true)
        }
      }
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_, session) => {
      setAuthUserEmail(session?.user.email ?? null)
      setAuthError(null)
      syncAuthSessionToRuntime(session).catch((cause) => {
        if (!mounted) {
          return
        }

        setAuthError(
          cause instanceof Error ? cause.message : "Could not sync auth session"
        )
      })
    })

    bootstrap().catch(() => undefined)

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async () => {
    if (!hasSupabaseBrowserEnv) {
      setAuthError(
        "Supabase is not configured. Set PLASMO_PUBLIC_SUPABASE_URL and PLASMO_PUBLIC_SUPABASE_ANON_KEY."
      )
      return
    }

    const email = authEmail.trim()
    const password = authPassword.trim()

    if (!email || !password) {
      setAuthError("Email and password are required")
      return
    }

    setAuthBusy(true)
    setAuthStatus(null)
    setAuthError(null)

    try {
      const supabase = getSupabaseBrowserClient()
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email,
          password
        })

      if (signInError) {
        throw signInError
      }

      await syncAuthSessionToRuntime(data.session)
      setAuthUserEmail(data.user?.email ?? email)
      setAuthPassword("")
      setAuthStatus(`Signed in as ${data.user?.email ?? email}`)
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Could not sign in")
    } finally {
      setAuthBusy(false)
    }
  }

  const signUp = async () => {
    if (!hasSupabaseBrowserEnv) {
      setAuthError(
        "Supabase is not configured. Set PLASMO_PUBLIC_SUPABASE_URL and PLASMO_PUBLIC_SUPABASE_ANON_KEY."
      )
      return
    }

    const email = authEmail.trim()
    const password = authPassword.trim()

    if (!email || !password) {
      setAuthError("Email and password are required")
      return
    }

    setAuthBusy(true)
    setAuthStatus(null)
    setAuthError(null)

    try {
      const supabase = getSupabaseBrowserClient()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getSupabaseEmailRedirectUrl()
        }
      })

      if (signUpError) {
        throw signUpError
      }

      if (data.session && data.user) {
        await syncAuthSessionToRuntime(data.session)
        setAuthUserEmail(data.user.email ?? email)
        setAuthPassword("")
        setAuthStatus(
          `Account ready and signed in as ${data.user.email ?? email}`
        )
      } else {
        setAuthStatus("Check your email to confirm the account, then sign in")
      }
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Could not sign up")
    } finally {
      setAuthBusy(false)
    }
  }

  const signOut = async () => {
    if (!hasSupabaseBrowserEnv) {
      return
    }

    setAuthBusy(true)
    setAuthStatus(null)
    setAuthError(null)

    try {
      const supabase = getSupabaseBrowserClient()
      const { error: signOutError } = await supabase.auth.signOut()

      if (signOutError) {
        throw signOutError
      }

      await syncAuthSessionToRuntime(null)
      setAuthUserEmail(null)
      setAuthPassword("")
      setAuthStatus(null)
      setRunId(null)
      setEvents([])
      setPendingConfirmation(null)
      setMemoryExpanded(false)
      setMemoryStatus(null)
      setError(null)
      setHealth(null)
    } catch (cause) {
      setAuthError(
        cause instanceof Error ? cause.message : "Could not sign out"
      )
    } finally {
      setAuthBusy(false)
    }
  }

  const loadMemoryEntries = async () => {
    setMemoryBusy(true)

    try {
      const response = await sendRuntimeMessage<MemoryListResponse>({
        type: "agent/memory/list"
      })

      if (!response.ok) {
        throw new Error(
          "error" in response ? response.error : "Could not load saved answers"
        )
      }

      setMemoryEntries(response.entries)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load saved answers"
      )
    } finally {
      setMemoryBusy(false)
    }
  }

  const saveMemoryEntry = async () => {
    const question = memoryQuestion.trim()
    const answer = memoryAnswer.trim()

    if (!question || !answer) {
      setError("Field label and answer are required")
      return
    }

    setMemoryBusy(true)
    setMemoryStatus(null)
    setError(null)

    try {
      const response = await sendRuntimeMessage<MemoryMutateResponse>({
        type: "agent/memory/upsert",
        entry: {
          question,
          answer
        }
      })

      if (!response.ok) {
        throw new Error(
          "error" in response ? response.error : "Could not save answer"
        )
      }

      setMemoryEntries(response.entries)
      setMemoryQuestion("")
      setMemoryAnswer("")
      setMemoryStatus("Saved answer")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save answer")
    } finally {
      setMemoryBusy(false)
    }
  }

  const removeMemoryEntry = async (id: string) => {
    setMemoryBusy(true)
    setMemoryStatus(null)
    setError(null)

    try {
      const response = await sendRuntimeMessage<MemoryMutateResponse>({
        type: "agent/memory/delete",
        id
      })

      if (!response.ok) {
        throw new Error(
          "error" in response ? response.error : "Could not delete answer"
        )
      }

      setMemoryEntries(response.entries)
      setMemoryStatus("Removed saved answer")
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete answer"
      )
    } finally {
      setMemoryBusy(false)
    }
  }

  useEffect(() => {
    if (!authUserEmail) {
      return
    }

    loadMemoryEntries().catch(() => undefined)
  }, [authUserEmail])

  const startRun = async () => {
    const trimmed = command.trim()

    if (!trimmed || busy) {
      return
    }

    if (!authReady) {
      setError("Auth session is still loading")
      return
    }

    if (!authUserEmail) {
      setError("Sign in required before running commands")
      return
    }

    setError(null)
    setHealth(null)
    setEvents([])
    setPendingConfirmation(null)
    setBusy(true)

    try {
      const response = await sendRuntimeMessage<StartResponse>({
        type: "agent/start",
        command: trimmed
      })

      if (!response.ok) {
        throw new Error(
          "error" in response ? response.error : "Failed to start"
        )
      }

      setRunId(response.runId)
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : "Failed to start run")
    }
  }

  const checkHealth = async () => {
    setError(null)

    try {
      const response = await sendRuntimeMessage<HealthResponse>({
        type: "agent/health"
      })

      if (!response.ok) {
        throw new Error(
          "error" in response ? response.error : "Health check failed"
        )
      }

      const missingParts: string[] = []

      if (!response.health.hasOpenRouterKey) {
        missingParts.push("OPENROUTER_API_KEY")
      }

      if (!response.health.hasSupabaseConfig) {
        missingParts.push(
          "SUPABASE_URL/SUPABASE_ANON_KEY or PLASMO_PUBLIC_SUPABASE_*"
        )
      }

      const label =
        missingParts.length > 0
          ? `API reachable but missing ${missingParts.join(" + ")}`
          : response.health.authRequired && !authUserEmail
            ? `API OK - sign in required - model: ${response.health.model}`
            : `API OK - model: ${response.health.model}`

      setHealth(label)
    } catch (cause) {
      setHealth(null)
      setError(cause instanceof Error ? cause.message : "Health check failed")
    }
  }

  const resolveConfirmation = async (approve: boolean) => {
    if (!runId) {
      return
    }

    try {
      const response = await sendRuntimeMessage<GenericResponse>({
        type: "agent/confirm",
        runId,
        approve
      })

      if (!response.ok) {
        throw new Error(response.error ?? "Could not resolve confirmation")
      }

      setPendingConfirmation(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confirmation failed")
    }
  }

  const shellClass = compact
    ? "min-h-screen min-w-[280px] p-3"
    : "min-h-screen min-w-[360px] p-[18px]"
  const buttonBaseClass =
    "rounded-lg border px-3 py-2 text-[12px] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
  const isSignedIn = Boolean(authUserEmail)

  return (
    <div className={`${shellClass} flex flex-col gap-3 text-neutral-900`}>
      <header className="flex flex-col gap-1">
        <p className="m-0 text-[11px] uppercase tracking-[0.1em] text-neutral-500">
          Automation Console
        </p>
        <h1 className="m-0 text-[21px] tracking-[-0.02em]">Zap Agent</h1>
        <p className="m-0 text-[12px] leading-[1.45] text-neutral-600">
          {isSignedIn
            ? "Queue a command and watch each step execute in real time."
            : "Sign in or create an account to start running commands."}
        </p>

        {isSignedIn ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="m-0 inline-flex min-w-0 max-w-[220px] items-center gap-2 rounded-full border border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate">{authUserEmail}</span>
            </p>
            <button
              className="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-900 transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45"
              disabled={authBusy}
              onClick={signOut}>
              {authBusy ? "Signing out..." : "Sign out"}
            </button>
          </div>
        ) : null}
      </header>

      {!isSignedIn ? (
        <section className="flex flex-col gap-2 rounded-xl border border-neutral-300 bg-white p-[10px]">
          <p className="m-0 text-[11px] uppercase tracking-[0.09em] text-neutral-500">
            Account
          </p>

          {!hasSupabaseBrowserEnv ? (
            <p className="m-0 text-[12px] leading-[1.45] text-neutral-600">
              Set PLASMO_PUBLIC_SUPABASE_URL and
              PLASMO_PUBLIC_SUPABASE_ANON_KEY, then reload extension.
            </p>
          ) : (
            <>
              <input
                className="box-border w-full rounded-lg border border-neutral-300 bg-neutral-100 p-[10px] text-[12px] text-neutral-900 outline-none focus:border-neutral-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-neutral-800"
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                value={authEmail}
              />
              <input
                className="box-border w-full rounded-lg border border-neutral-300 bg-neutral-100 p-[10px] text-[12px] text-neutral-900 outline-none focus:border-neutral-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-neutral-800"
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="Password"
                type="password"
                value={authPassword}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className={`${buttonBaseClass} border-neutral-900 bg-neutral-900 text-neutral-50`}
                  disabled={authBusy || !authReady}
                  onClick={signIn}>
                  {authBusy ? "Working..." : "Sign In"}
                </button>
                <button
                  className={`${buttonBaseClass} border-neutral-300 bg-neutral-50 text-neutral-900`}
                  disabled={authBusy || !authReady}
                  onClick={signUp}>
                  {authBusy ? "Working..." : "Sign Up"}
                </button>
              </div>
            </>
          )}

          {authStatus ? (
            <p className="m-0 rounded-[10px] border border-sky-300 bg-sky-50 px-[10px] py-2 text-[12px] text-sky-900">
              {authStatus}
            </p>
          ) : null}

          {authError ? (
            <p className="m-0 rounded-[10px] border border-red-300 bg-red-50 px-[10px] py-2 text-[12px] text-red-800">
              {authError}
            </p>
          ) : null}
        </section>
      ) : null}

      {isSignedIn ? (
        <>
          {authError ? (
            <div className="rounded-[10px] border border-red-300 bg-red-50 px-[10px] py-2 text-[12px] text-red-800">
              {authError}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 rounded-xl border border-neutral-300 bg-white p-[10px]">
            <label
              className="text-[11px] uppercase tracking-[0.09em] text-neutral-500"
              htmlFor="agent-command">
              Command
            </label>
            <textarea
              className="box-border w-full max-w-full resize-y rounded-lg border border-neutral-300 bg-neutral-100 p-[10px] text-[12px] text-neutral-900 outline-none focus:border-neutral-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-neutral-800"
              id="agent-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="Example: open github and create repo named zap"
              rows={compact ? 3 : 4}
            />

            <div className="flex flex-wrap gap-2">
              <button
                className={`${buttonBaseClass} border-neutral-900 bg-neutral-900 text-neutral-50`}
                disabled={
                  busy ||
                  !authReady ||
                  !authUserEmail ||
                  command.trim().length === 0
                }
                onClick={startRun}>
                {busy ? "Running..." : "Run Command"}
              </button>
              <button
                className={`${buttonBaseClass} border-neutral-400 bg-neutral-50 text-neutral-900`}
                disabled={busy}
                onClick={checkHealth}>
                Check Health
              </button>
            </div>
          </div>

          <section className="flex flex-col gap-2 rounded-xl border border-neutral-300 bg-white p-[10px]">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="m-0 text-[11px] uppercase tracking-[0.09em] text-neutral-500">
                  Saved Answers
                </p>
                <p className="m-0 text-[11px] text-neutral-500">
                  {memoryEntries.length} saved
                </p>
              </div>

              <div className="flex items-center gap-2">
                {memoryExpanded ? (
                  <button
                    className={`${buttonBaseClass} border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700`}
                    disabled={memoryBusy}
                    onClick={loadMemoryEntries}>
                    Refresh
                  </button>
                ) : null}

                <button
                  className={`${buttonBaseClass} border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700`}
                  onClick={() => setMemoryExpanded((previous) => !previous)}>
                  {memoryExpanded ? "Hide" : "Manage"}
                </button>
              </div>
            </div>

            {memoryExpanded ? (
              <>
                <p className="m-0 text-[12px] leading-[1.45] text-neutral-600">
                  Save reusable answers for common form fields. Zap uses them
                  when a step looks like form filling.
                </p>

                <input
                  className="box-border w-full rounded-lg border border-neutral-300 bg-neutral-100 p-[10px] text-[12px] text-neutral-900 outline-none focus:border-neutral-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-neutral-800"
                  onChange={(event) => setMemoryQuestion(event.target.value)}
                  placeholder="Field label or question (for example: What is your email?)"
                  value={memoryQuestion}
                />
                <textarea
                  className="box-border w-full max-w-full resize-y rounded-lg border border-neutral-300 bg-neutral-100 p-[10px] text-[12px] text-neutral-900 outline-none focus:border-neutral-500 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-neutral-800"
                  onChange={(event) => setMemoryAnswer(event.target.value)}
                  placeholder="Saved answer"
                  rows={compact ? 2 : 3}
                  value={memoryAnswer}
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    className={`${buttonBaseClass} border-neutral-900 bg-neutral-900 text-neutral-50`}
                    disabled={
                      memoryBusy ||
                      memoryQuestion.trim().length === 0 ||
                      memoryAnswer.trim().length === 0
                    }
                    onClick={saveMemoryEntry}>
                    {memoryBusy ? "Saving..." : "Save Answer"}
                  </button>
                </div>

                {memoryStatus ? (
                  <p className="m-0 rounded-[10px] border border-sky-300 bg-sky-50 px-[10px] py-2 text-[12px] text-sky-900">
                    {memoryStatus}
                  </p>
                ) : null}

                <div className="flex max-h-[200px] flex-col gap-2 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                  {memoryEntries.length === 0 ? (
                    <p className="m-0 text-[12px] text-neutral-600">
                      No saved answers yet.
                    </p>
                  ) : (
                    memoryEntries.map((entry) => (
                      <article
                        className="rounded-lg border border-neutral-200 bg-white p-2"
                        key={entry.id}>
                        <p className="m-0 text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                          {entry.question}
                        </p>
                        <p className="m-0 mt-1 break-words text-[12px] leading-[1.45] text-neutral-800">
                          {entry.answer}
                        </p>
                        <div className="mt-2 flex justify-end">
                          <button
                            className={`${buttonBaseClass} border-neutral-300 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-700`}
                            disabled={memoryBusy}
                            onClick={() => removeMemoryEntry(entry.id)}>
                            Delete
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </section>

          {error ? (
            <div className="rounded-[10px] border border-red-300 bg-red-50 px-[10px] py-2 text-[12px] text-red-800">
              {error}
            </div>
          ) : null}
          {health ? (
            <div className="rounded-[10px] border border-emerald-300 bg-emerald-50 px-[10px] py-2 text-[12px] text-emerald-900">
              {health}
            </div>
          ) : null}

          {pendingConfirmation?.type === "confirmation_required" ? (
            <section className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-100 p-[10px]">
              <p className="m-0 text-[12px] uppercase tracking-[0.08em]">
                Confirmation required
              </p>
              <p className="m-0 text-[12px] leading-[1.45] text-neutral-600">
                {pendingConfirmation.reason}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={`${buttonBaseClass} border-neutral-900 bg-neutral-900 text-neutral-50`}
                  onClick={() => resolveConfirmation(true)}>
                  Approve
                </button>
                <button
                  className={`${buttonBaseClass} border-neutral-400 bg-neutral-50 text-neutral-900`}
                  onClick={() => resolveConfirmation(false)}>
                  Reject
                </button>
              </div>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-neutral-300 bg-white">
            <div className="flex items-center justify-between border-b border-neutral-300 bg-neutral-50 px-[10px] py-[9px]">
              <p className="m-0 text-[11px] uppercase tracking-[0.09em] text-neutral-500">
                Execution Log
              </p>
              <p className="m-0 text-[11px] uppercase tracking-[0.09em] text-neutral-500">
                {logs.length} events
              </p>
            </div>

            <div className="flex max-h-[320px] flex-col gap-[7px] overflow-auto p-2 max-[720px]:max-h-[240px]">
              {logs.length === 0 ? (
                <p className="m-0 text-[12px] text-neutral-600">
                  No run logs yet.
                </p>
              ) : (
                logs.map((log) => {
                  const event = log.event

                  return (
                    <div
                      className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-[7px]"
                      key={log.key}>
                      <span
                        className={`inline-flex min-w-[50px] items-center justify-center rounded-full border px-[6px] py-[2px] text-[10px] uppercase tracking-[0.08em] ${eventTone(event)}`}>
                        {eventLabel(event)}
                      </span>
                      <p className="m-0 text-[12px] leading-[1.45] text-neutral-900">
                        {log.text}
                      </p>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
