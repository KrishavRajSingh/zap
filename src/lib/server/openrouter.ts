import type {
  AgentPlan,
  AgentStepRecord,
  PageSnapshot,
  PlannerMemoryEntry
} from "~lib/agent/types"
import { isAgentPlan, safeJsonParse } from "~lib/agent/validation"

type PlanInput = {
  command: string
  snapshot: PageSnapshot
  history: AgentStepRecord[]
  memory?: PlannerMemoryEntry[]
}

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

const SYSTEM_PROMPT = `You are a browser automation planner.
Return valid JSON only.

Rules:
1) Choose exactly one next action.
2) Use only the provided eids for click/type/extract actions.
3) Prefer safe exploration when uncertain.
4) Do not invent data not present in the snapshot.
5) Use finish with success=true only when the user request is verifiably complete from the page state.
6) If blocked (login required, missing permission, captcha, or no valid path), use finish with success=false and explain the blocker.
7) Avoid unproductive loops: do not repeat the same click target more than twice in a row.
8) Prefer direct navigation to canonical pages (for example, /new create pages) instead of exploratory menu clicking.
9) For Enter/search submissions, include the input eid in press_key so the key is sent to the correct field.
10) Optional memory entries may be included as { id, question, answer, updatedAt }.
11) When memory exists, semantically map form labels/placeholders/questions to the best matching memory.question and use memory.answer in type_text.
12) Never invent personal profile data (name, email, phone, address, DOB, IDs, payment, passwords, OTP). If a required value is missing from memory and the page state, use finish with success=false.
13) For each form field, use questionText/label/placeholder/describedBy/nameAttr/idAttr/forAttr/context to choose the correct eid; avoid writing long prose into short-summary fields.
14) For checkbox/radio/yes-no fields, use click actions (never type_text). You may click either the control eid or a label-option eid that represents the same choice.
15) Use checked when available for checkbox/radio fields; avoid clicking an option that is already selected unless you must change it.
16) Respect maxLength and character-limit hints (for example "50 characters or less"). If memory text is too long for a field, choose finish with success=false and explain the mismatch.
17) Do not attempt to type into file inputs. File uploads require manual user action; if a required file is missing, choose finish with success=false and explain.
18) Prefer filling required fields before optional ones.

Allowed action schema:
{
  "rationale": "short reason",
  "action": {
    "type": "open_url|click|type_text|press_key|scroll|wait|extract_text|finish",
    "url": "https://... (open_url)",
    "eid": "e12 (click/type_text/extract_text, optional for press_key)",
    "text": "... (type_text)",
    "clearFirst": true,
    "key": "Enter (press_key)",
    "direction": "down|up (scroll)",
    "amount": 700,
    "ms": 1200,
    "message": "done details (finish)",
    "success": true
  }
}`

const getApiBase = () => {
  return process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1"
}

export const requestPlanFromOpenRouter = async (
  input: PlanInput
): Promise<AgentPlan> => {
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing")
  }

  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-pro"

  const response = await fetch(`${getApiBase()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify(input)
        }
      ]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `OpenRouter request failed: ${response.status} ${errorText}`
    )
  }

  const data = (await response.json()) as OpenRouterResponse
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error("OpenRouter response has no message content")
  }

  const parsed = safeJsonParse(content)

  if (!isAgentPlan(parsed)) {
    throw new Error("OpenRouter response is not a valid AgentPlan JSON")
  }

  return parsed
}
