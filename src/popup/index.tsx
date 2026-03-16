import { useState } from "react"

import "~styles/tailwind.css"

const openSidePanel = async () => {
  return new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "agent/open-panel" }, (response) => {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        reject(new Error(lastError.message))
        return
      }
      resolve(response)
    })
  })
}

function IndexPopup() {
  const [error, setError] = useState<string | null>(null)

  const handleOpen = async () => {
    setError(null)

    try {
      const response = await openSidePanel()

      if (!response.ok) {
        throw new Error(response.error ?? "Could not open side panel")
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to open side panel"
      )
    }
  }

  return (
    <main className="flex min-w-[280px] flex-col gap-[10px] bg-transparent p-[14px] text-neutral-900">
      <p className="m-0 text-[10px] uppercase tracking-[0.1em] text-neutral-500">
        Quick Launch
      </p>
      <h1 className="m-0 text-[18px] tracking-[-0.03em]">Zap Agent</h1>
      <p className="m-0 text-[12px] leading-[1.45] text-neutral-600">
        Open the sidepanel for long-running commands and action confirmations.
      </p>
      <button
        className="rounded-lg border border-neutral-900 bg-neutral-900 px-3 py-2 text-[12px] text-neutral-50 transition hover:-translate-y-px"
        onClick={handleOpen}>
        Open Sidepanel
      </button>
      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-[9px] py-[7px] text-[12px] text-red-800">
          {error}
        </div>
      ) : null}
    </main>
  )
}

export default IndexPopup
