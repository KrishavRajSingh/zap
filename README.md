# Zap

Agentic browser automation extension built with Plasmo + Next.js.

## What is implemented

- Sidepanel agent console + popup launcher
- Background automation loop (snapshot -> plan -> execute -> verify)
- Confirmation gate for sensitive click actions
- Supabase email/password auth in sidepanel
- Next.js planner APIs backed by OpenRouter (`google/gemini-2.5-flash` by default)

## Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Add keys in `.env`:

- `OPENROUTER_API_KEY`
- `PLASMO_PUBLIC_SUPABASE_URL`
- `PLASMO_PUBLIC_SUPABASE_ANON_KEY`

For API route verification you can either set:

- `SUPABASE_URL` + `SUPABASE_ANON_KEY`

or rely on the `PLASMO_PUBLIC_SUPABASE_*` values.

Also configure Supabase Auth URL settings:

- `Site URL`: `http://localhost:1947`
- `Redirect URLs`: `http://localhost:1947/auth/confirmed`

If you want Google sign-in in the extension sidepanel:

- Enable the Google auth provider in Supabase.
- Add your extension redirect URL (from `chrome.identity.getRedirectURL()`) to Supabase Redirect URLs.
- Add the same redirect URL to your Google OAuth client.
- You can find the extension id in `chrome://extensions` and build the URL as `https://<extension-id>.chromiumapp.org/`.

3. Install and run:

```bash
pnpm install
pnpm dev
```

This runs both:

- Plasmo extension dev server
- Next.js server on `http://localhost:1947`

4. Load extension from `build/chrome-mv3-dev` in `chrome://extensions`.

5. Open the sidepanel and sign in (Google or email/password) before running commands.

## Key paths

- `src/background/index.ts` - core agent loop and action execution
- `src/sidepanel/index.tsx` - sidepanel command UI
- `src/components/agent-console.tsx` - shared popup/sidepanel console
- `src/pages/auth/confirmed.tsx` - email-confirmation callback page
- `src/pages/api/agent/plan.ts` - planner endpoint
- `src/pages/api/agent/health.ts` - health endpoint

## Notes

- This version is website-automation first (no direct GitHub/Sheets API connectors).
- Planner and run-log APIs require a valid Supabase bearer token.
- Keep `.env` private. Never commit your OpenRouter or Supabase keys.
- Set `PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS=true` to write run logs into `.zap-logs/`.
- Planner traces now persist the exact LLM input/output for each step at `.zap-logs/<day>/planner-traces/<runId>/step-XX-attempt-YY.json`.
- Planner API health check: `http://localhost:1947/api/agent/health`
