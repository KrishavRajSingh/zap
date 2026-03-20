import { useEffect, useState } from "react"

type ViewState = {
  kind: "success" | "error"
  title: string
  message: string
}

const readParamValue = (key: string) => {
  if (typeof window === "undefined") {
    return null
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  const query = new URLSearchParams(window.location.search)

  return hash.get(key) ?? query.get(key)
}

const deriveViewState = (): ViewState => {
  const errorDescription = readParamValue("error_description")
  const errorCode = readParamValue("error_code")

  if (errorDescription || errorCode) {
    return {
      kind: "error",
      title: "Could not confirm email",
      message: errorDescription ?? "Authentication redirect returned an error."
    }
  }

  const flowType = readParamValue("type")

  if (flowType === "signup") {
    return {
      kind: "success",
      title: "Email confirmed",
      message:
        "Your account is ready. Return to the Zap sidepanel and sign in with your email and password."
    }
  }

  return {
    kind: "success",
    title: "Authentication complete",
    message:
      "You can close this tab and continue in the Zap extension sidepanel."
  }
}

function AuthConfirmedPage() {
  const [viewState, setViewState] = useState<ViewState>({
    kind: "success",
    title: "Finishing sign-in",
    message: "Processing authentication response..."
  })

  useEffect(() => {
    setViewState(deriveViewState())

    if (window.location.hash) {
      window.history.replaceState(
        null,
        document.title,
        `${window.location.pathname}${window.location.search}`
      )
    }
  }, [])

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-xl rounded-2xl border border-neutral-300 bg-white p-5 shadow-[0_24px_60px_-46px_rgba(0,0,0,0.9)]">
        <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-neutral-500">
          Zap Account
        </p>
        <h1 className="m-0 mt-2 text-[28px] tracking-[-0.03em]">
          {viewState.title}
        </h1>
        <p className="m-0 mt-2 text-[14px] leading-[1.55] text-neutral-700">
          {viewState.message}
        </p>

        <div className="mt-4 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-700">
          Next step: open the extension sidepanel and continue from there.
        </div>

        <a
          className={`mt-4 inline-flex rounded-lg border px-3 py-2 text-[12px] transition hover:-translate-y-px ${
            viewState.kind === "error"
              ? "border-neutral-300 bg-neutral-50 text-neutral-900"
              : "border-neutral-900 bg-neutral-900 text-neutral-50"
          }`}
          href="/">
          Open Zap Home
        </a>
      </div>
    </main>
  )
}

export default AuthConfirmedPage
