const updatedAt = "March 21, 2026"

function PrivacyPage() {
  return (
    <main className="min-h-screen px-4 pb-10 pt-5 text-neutral-900 sm:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <header className="animate-rise rounded-xl border border-neutral-300 bg-white p-4">
          <p className="m-0 text-[11px] uppercase tracking-[0.1em] text-neutral-500">
            Zap
          </p>
          <h1 className="m-0 mt-1 text-2xl tracking-[-0.02em]">
            Privacy Policy
          </h1>
          <p className="m-0 mt-2 text-[13px] text-neutral-600">
            Last updated: {updatedAt}
          </p>
        </header>

        <section className="animate-rise [animation-delay:70ms] [animation-fill-mode:both] rounded-xl border border-neutral-300 bg-white p-4 text-[13px] leading-[1.6] text-neutral-700">
          <h2 className="m-0 text-base text-neutral-900">Overview</h2>
          <p className="m-0 mt-2">
            Zap is a browser automation extension. It executes user-requested
            web tasks and sends only the data needed to plan and run those
            tasks.
          </p>
        </section>

        <section className="animate-rise [animation-delay:120ms] [animation-fill-mode:both] rounded-xl border border-neutral-300 bg-white p-4 text-[13px] leading-[1.6] text-neutral-700">
          <h2 className="m-0 text-base text-neutral-900">Data We Collect</h2>
          <ul className="m-0 mt-2 list-disc space-y-1.5 pl-5">
            <li>
              Account data from authentication providers (for example email and
              user id).
            </li>
            <li>Commands you enter into Zap.</li>
            <li>
              Active-tab page context while a run is in progress, including URL,
              page title, timestamp, visible text preview, and interactive
              element metadata.
            </li>
            <li>
              Run activity data, including planned actions, execution results,
              and step timestamps.
            </li>
            <li>
              If run-log persistence is enabled by deployment configuration, run
              logs may be saved on the server.
            </li>
          </ul>
        </section>

        <section className="animate-rise [animation-delay:170ms] [animation-fill-mode:both] rounded-xl border border-neutral-300 bg-white p-4 text-[13px] leading-[1.6] text-neutral-700">
          <h2 className="m-0 text-base text-neutral-900">How We Use Data</h2>
          <ul className="m-0 mt-2 list-disc space-y-1.5 pl-5">
            <li>Authenticate users and protect access to API routes.</li>
            <li>Plan and execute requested automation steps.</li>
            <li>
              Display step-by-step status and results in the extension UI.
            </li>
            <li>Diagnose failures and improve reliability.</li>
          </ul>
        </section>

        <section className="animate-rise [animation-delay:220ms] [animation-fill-mode:both] rounded-xl border border-neutral-300 bg-white p-4 text-[13px] leading-[1.6] text-neutral-700">
          <h2 className="m-0 text-base text-neutral-900">
            Data Sharing and Processors
          </h2>
          <p className="m-0 mt-2">
            Zap uses third-party services to operate, including Supabase (for
            authentication) and OpenRouter-backed models (for planning). Data is
            shared with these providers only as needed to provide extension
            functionality.
          </p>
          <p className="m-0 mt-2">
            Zap does not sell personal data and does not share data for
            unrelated advertising purposes.
          </p>
        </section>

        <section className="animate-rise [animation-delay:270ms] [animation-fill-mode:both] rounded-xl border border-neutral-300 bg-white p-4 text-[13px] leading-[1.6] text-neutral-700">
          <h2 className="m-0 text-base text-neutral-900">Your Controls</h2>
          <ul className="m-0 mt-2 list-disc space-y-1.5 pl-5">
            <li>You can sign out at any time from the extension sidepanel.</li>
            <li>
              You can remove local extension data by clearing extension storage
              or uninstalling the extension.
            </li>
          </ul>
        </section>

        <section className="animate-rise [animation-delay:320ms] [animation-fill-mode:both] rounded-xl border border-neutral-300 bg-white p-4 text-[13px] leading-[1.6] text-neutral-700">
          <h2 className="m-0 text-base text-neutral-900">Contact</h2>
          <p className="m-0 mt-2">
            For privacy questions, open an issue at{" "}
            <a
              className="text-neutral-900 underline decoration-neutral-400 underline-offset-2"
              href="https://github.com/KrishavRajSingh/zap/issues"
              rel="noreferrer"
              target="_blank">
              github.com/KrishavRajSingh/zap/issues
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}

export default PrivacyPage
