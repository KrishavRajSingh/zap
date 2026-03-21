import Image from "next/image"

import zapIcon from "../../assets/icon.png"

const capabilities = [
  "Open URL",
  "Click + type",
  "Press keys",
  "Scroll",
  "Extract text",
  "Approval gate",
  "Live logs"
]

const whatRows = [
  {
    title: "Understands your command",
    text: "You type a plain-language task. Zap turns it into one concrete next action."
  },
  {
    title: "Acts directly in the tab",
    text: "Zap can open links, click controls, type values, press keys, scroll pages, and extract text."
  },
  {
    title: "Keeps risky actions gated",
    text: "Sensitive clicks trigger a confirmation hold before execution."
  },
  {
    title: "Shows every step live",
    text: "A run log streams planning and execution so you can see exactly what happened."
  }
]

const flowRows = [
  {
    step: "01",
    title: "Snapshot",
    text: "Zap captures the current page state and relevant interactive elements."
  },
  {
    step: "02",
    title: "Plan",
    text: "The planner API chooses one safe next action from the available options."
  },
  {
    step: "03",
    title: "Execute",
    text: "Zap runs the action in the browser and records a result."
  },
  {
    step: "04",
    title: "Approve if needed",
    text: "Create or submit style actions pause until you approve."
  },
  {
    step: "05",
    title: "Repeat to finish",
    text: "Zap loops until the task is complete, then returns a final status."
  }
]

const runRows = [
  {
    badge: "PLAN",
    tone: "border-zinc-300 bg-zinc-100 text-zinc-800",
    text: "Read current page and choose the next best action"
  },
  {
    badge: "GO",
    tone: "border-emerald-300 bg-emerald-50 text-emerald-900",
    text: "Execute open, click, type, scroll, press key, or extract"
  },
  {
    badge: "HOLD",
    tone: "border-amber-300 bg-amber-50 text-amber-900",
    text: "Pause and ask for approval on sensitive actions"
  },
  {
    badge: "DONE",
    tone: "border-emerald-300 bg-emerald-50 text-emerald-900",
    text: "Finish with a final result and full execution log"
  }
]

function IndexPage() {
  return (
    <main className="min-h-screen px-4 pb-10 pt-5 text-neutral-900 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="animate-rise flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-300/90 bg-white/85 p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <Image
              alt="Zap icon"
              className="h-10 w-10"
              height={40}
              priority
              src={zapIcon}
              width={40}
            />
            <p className="m-0 text-xs uppercase tracking-[0.13em] text-neutral-600">
              Zap
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.1em] text-neutral-700 transition hover:-translate-y-px"
              href="/privacy">
              Privacy
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.1em] text-neutral-700 transition hover:-translate-y-px"
              href="https://github.com/KrishavRajSingh/zap"
              rel="noreferrer"
              target="_blank">
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49C3.78 14.09 3.31 12.73 3.31 12.73c-.36-.92-.88-1.17-.88-1.17-.72-.49.05-.48.05-.48.79.06 1.21.82 1.21.82.71 1.2 1.86.85 2.31.65.07-.51.28-.85.5-1.04-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.58.82-2.14-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.53 7.53 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.14 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                  fill="currentColor"
                />
              </svg>
              GitHub
            </a>
            <a
              className="rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-[11px] uppercase tracking-[0.1em] text-neutral-50 transition hover:-translate-y-px"
              href="https://chromewebstore.google.com"
              rel="noreferrer"
              target="_blank">
              Install Now
            </a>
          </div>
        </header>

        <section className="animate-rise [animation-delay:70ms] [animation-fill-mode:both] rounded-2xl border border-neutral-300 bg-white p-4 shadow-[0_24px_60px_-44px_rgba(0,0,0,0.9)] sm:p-6">
          <div className="grid items-start gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-4">
              <p className="m-0 text-[11px] uppercase tracking-[0.14em] text-neutral-500">
                Open Source Browser Agent
              </p>
              <h1 className="m-0 text-[clamp(40px,8vw,86px)] leading-[0.86] tracking-[-0.065em]">
                <span className="block whitespace-nowrap">Zap It.</span>
                <span className="block whitespace-nowrap">Browse Better.</span>
              </h1>
              <p className="m-0 max-w-[46ch] text-[14px] leading-[1.5] text-neutral-700 sm:text-[15px]">
                Browser automation from plain-language commands. Zap plans each
                next action, runs it in your tab, and asks before risky clicks.
              </p>

              <div className="flex flex-wrap gap-2">
                <a
                  className="rounded-lg border border-neutral-900 bg-neutral-900 px-3.5 py-2 text-xs uppercase tracking-[0.1em] text-neutral-50 transition hover:-translate-y-px"
                  href="#how">
                  See how it works
                </a>
                <a
                  className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs uppercase tracking-[0.1em] text-neutral-700 transition hover:-translate-y-px"
                  href="#demo">
                  Watch run
                </a>
              </div>

              <div className="grid gap-2 text-[11px] uppercase tracking-[0.1em] text-neutral-500 sm:grid-cols-3">
                <p className="m-0 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-center">
                  Plan first
                </p>
                <p className="m-0 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-center">
                  Approval gate
                </p>
                <p className="m-0 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1.5 text-center">
                  Live logs
                </p>
              </div>
            </div>

            <aside
              className="relative overflow-hidden rounded-2xl border border-neutral-300 bg-neutral-50 p-3"
              id="demo">
              <div className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full border border-neutral-300/60 bg-white/70" />
              <div className="pointer-events-none absolute -bottom-10 -left-8 h-24 w-24 rounded-full border border-neutral-300/60 bg-white/70" />

              <div className="relative animate-float-soft rounded-xl border border-neutral-300 bg-white shadow-[0_14px_30px_-26px_rgba(0,0,0,0.9)]">
                <div className="flex items-center gap-2 border-b border-neutral-300 px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-neutral-300" />
                  <span className="h-2 w-2 rounded-full bg-neutral-300" />
                  <span className="h-2 w-2 rounded-full bg-neutral-300" />
                  <div className="ml-1 rounded-md border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                    run preview
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  <div className="rounded-lg border border-neutral-200 bg-neutral-100 px-2.5 py-1.5 text-[11px] text-neutral-600">
                    Command: find startups hiring now
                  </div>
                  {runRows.map((row, index) => (
                    <div
                      className="animate-rise grid grid-cols-[auto_1fr] items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2"
                      key={row.badge}
                      style={{ animationDelay: `${90 + index * 75}ms` }}>
                      <span
                        className={`inline-flex min-w-[52px] items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.09em] ${row.tone}`}>
                        {row.badge}
                      </span>
                      <p className="m-0 text-[12px] leading-[1.45] text-neutral-700">
                        {row.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="animate-rise [animation-delay:140ms] [animation-fill-mode:both] rounded-2xl border border-neutral-300 bg-white p-4">
          <div className="mb-3 flex items-end justify-between gap-2">
            <h2 className="m-0 text-base tracking-[-0.02em]">What Zap does</h2>
            <p className="m-0 text-[11px] uppercase tracking-[0.1em] text-neutral-500">
              Minimal. Direct.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {whatRows.map((row) => (
              <article
                className="rounded-xl border border-neutral-300 bg-neutral-50 p-3"
                key={row.title}>
                <p className="m-0 text-[12px] font-medium text-neutral-900">
                  {row.title}
                </p>
                <p className="m-0 mt-1 text-[12px] leading-[1.5] text-neutral-600">
                  {row.text}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="animate-rise [animation-delay:200ms] [animation-fill-mode:both] rounded-2xl border border-neutral-300 bg-white p-4"
          id="how">
          <div className="mb-3 flex items-end justify-between gap-2">
            <h2 className="m-0 text-base tracking-[-0.02em]">How Zap works</h2>
            <p className="m-0 text-[11px] uppercase tracking-[0.1em] text-neutral-500">
              {"Snapshot -> Plan -> Execute"}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {flowRows.map((row) => (
              <article
                className="rounded-xl border border-neutral-300 bg-neutral-50 p-3"
                key={row.step}>
                <p className="m-0 text-[10px] uppercase tracking-[0.1em] text-neutral-500">
                  {row.step}
                </p>
                <p className="m-0 mt-1 text-[12px] font-medium text-neutral-900">
                  {row.title}
                </p>
                <p className="m-0 mt-1 text-[12px] leading-[1.5] text-neutral-600">
                  {row.text}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="animate-rise [animation-delay:260ms] [animation-fill-mode:both] rounded-2xl border border-neutral-300 bg-white p-4">
          <div className="flex flex-wrap gap-2">
            {capabilities.map((item) => (
              <p
                className="m-0 rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-[12px] text-neutral-700"
                key={item}>
                {item}
              </p>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export default IndexPage
