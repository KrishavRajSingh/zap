# Zap

Agentic browser automation extension built with Plasmo + Next.js.

## What is implemented

- Sidepanel agent console + popup launcher
- Background automation loop (snapshot -> plan -> execute -> verify)
- Confirmation gate for sensitive click actions
- Next.js planner APIs backed by OpenRouter (`google/gemini-2.5-pro` by default)

## Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Add your OpenRouter key in `.env`.

3. Install and run:

```bash
pnpm install
pnpm dev
```

This runs both:

- Plasmo extension dev server
- Next.js server on `http://localhost:1947`

4. Load extension from `build/chrome-mv3-dev` in `chrome://extensions`.

## Key paths

- `src/background/index.ts` - core agent loop and action execution
- `src/sidepanel/index.tsx` - sidepanel command UI
- `src/components/agent-console.tsx` - shared popup/sidepanel console
- `src/pages/api/agent/plan.ts` - planner endpoint
- `src/pages/api/agent/health.ts` - health endpoint

## Notes

- This version is website-automation first (no direct GitHub/Sheets API connectors).
- Keep `.env` private. Only `OPENROUTER_API_KEY` is required to start planning.
- Set `PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS=true` to write run logs into `.zap-logs/`.
- Planner API health check: `http://localhost:1947/api/agent/health`
