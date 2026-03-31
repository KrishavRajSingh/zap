import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type {
  AgentPlan,
  AgentStepRecord,
  PageSnapshot,
  PlannerMemoryEntry,
  PlannerSnapshotSummary,
  PlannerTraceReference,
  PlannerTraceRequestMeta
} from "~lib/agent/types"
import {
  isObject,
  normalizeAgentPlan,
  safeJsonParse
} from "~lib/agent/validation"

type PlanInput = {
  command: string
  snapshot: PageSnapshot
  history: AgentStepRecord[]
  memory?: PlannerMemoryEntry[]
}

type RequestPlanOptions = {
  trace?: PlannerTraceRequestMeta
}

type RequestPlanResult = {
  plan: AgentPlan
  planner?: PlannerTraceReference
}

type OpenRouterResponse = {
  id?: string
  model?: string
  usage?: Record<string, unknown>
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

const LOG_ROOT_DIRECTORY = ".zap-logs"
const SHOULD_PERSIST_RUN_LOGS =
  process.env.PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS?.trim().toLowerCase() === "true"
const PLANNER_TOP_CANDIDATE_LIMIT = 12
const PLANNER_IFRAME_PREVIEW_LIMIT = 8

const SYSTEM_PROMPT = `You are a browser automation planner.
Return valid JSON only. Return exactly one JSON object, never an array.

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
16) controlKind="custom_select" means the field behaves like a picker, not a freeform text box.
17) Respect maxLength and character-limit hints (for example "50 characters or less"). If memory text is too long for a field, choose finish with success=false and explain the mismatch.
18) Do not attempt to type into file inputs. File uploads require manual user action; if a required file is missing, choose finish with success=false and explain.
19) Prefer filling required fields before optional ones.
20) Elements may come from iframes. Use frameTitle/frameUrl/context when choosing the best eid.
21) If frameCapture reports likely missed iframe content on the current page, avoid navigating away just because top-level fields are missing unless the current page clearly has no path forward.
22) Use controlKind and popupState when present. For controlKind="custom_select", do not type arbitrary text into the field. Click the field to open it first; when controlKind="select_option" candidates are visible, click the matching option.
23) If a dropdown is already open (popupState="open" or visible select_option candidates exist), prefer clicking an exact visible option instead of any type_text action.
24) If the same custom select has already been clicked repeatedly and no select_option candidates appear, do not keep clicking it forever. Try a different recovery step or finish with success=false and explain that the dropdown options never became available.
25) For clear/reset commands, use current valuePreview and checked to identify what still contains user data. Do not issue type_text with empty text for a field whose valuePreview is already empty, and do not click unchecked options just to "clear" them.
26) For clear/reset commands, prefer controls that visibly still have content or selection. If all remaining visible fields are already empty/unchecked, either move to another uncleared field or finish successfully if the form appears cleared.
27) For fill/complete-form commands, prefer fields that are still empty or unanswered. If a field already has a non-empty valuePreview or an option was just selected successfully, treat it as filled and move on unless you are explicitly correcting it.
28) If a dropdown option click succeeded for a question, do not immediately reopen the same dropdown or click the same option again unless the current snapshot shows the field is still unanswered.
29) For commands like "fill this form", "fill the rest", or "fill all remaining fields", continue through visible empty optional fields before submit when practical, not just required fields.
30) Do not choose Submit/finish=true while any required field or required radio group is still unresolved in the snapshot. If the command implies filling the rest, also avoid submit while visible empty optional fields remain.

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

const sanitizeSegment = (value: string) => {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)

  return sanitized.length > 0 ? sanitized : "run"
}

const normalizeDayFolder = (timestamp: string) => {
  const parsed = Date.parse(timestamp)

  if (Number.isNaN(parsed)) {
    return new Date().toISOString().slice(0, 10)
  }

  return new Date(parsed).toISOString().slice(0, 10)
}

const padTraceNumber = (value: number) => {
  return Math.max(0, value).toString().padStart(2, "0")
}

const isEditableCandidate = (snapshot: PageSnapshot["elements"][number]) => {
  return (
    snapshot.controlKind === "custom_select" ||
    snapshot.tagName === "input" ||
    snapshot.tagName === "textarea" ||
    snapshot.tagName === "select" ||
    snapshot.role === "textbox" ||
    snapshot.role === "checkbox" ||
    snapshot.role === "radio" ||
    (snapshot.tagName === "label" && snapshot.forAttr.length > 0) ||
    snapshot.inputType !== null
  )
}

const buildPlannerSnapshotSummary = (
  snapshot: PageSnapshot
): PlannerSnapshotSummary => {
  return {
    url: snapshot.url,
    title: snapshot.title,
    timestamp: snapshot.timestamp,
    totalCandidates: snapshot.elements.length,
    visibleCandidates: snapshot.elements.filter(
      (candidate) => candidate.visible
    ).length,
    enabledCandidates: snapshot.elements.filter(
      (candidate) => candidate.enabled
    ).length,
    inViewportCandidates: snapshot.elements.filter(
      (candidate) => candidate.inViewport
    ).length,
    editableCandidates: snapshot.elements.filter(isEditableCandidate).length,
    linkCandidates: snapshot.elements.filter(
      (candidate) => candidate.href.length > 0
    ).length,
    frameCapture: snapshot.frameCapture,
    iframePreview: snapshot.iframes.slice(0, PLANNER_IFRAME_PREVIEW_LIMIT),
    visibleTextPreview: snapshot.visibleTextPreview,
    topCandidates: snapshot.elements
      .slice(0, PLANNER_TOP_CANDIDATE_LIMIT)
      .map((candidate) => ({
        eid: candidate.eid,
        frameId: candidate.frameId,
        frameUrl: candidate.frameUrl,
        frameTitle: candidate.frameTitle,
        controlKind: candidate.controlKind,
        popupState: candidate.popupState,
        optionSource: candidate.optionSource,
        tagName: candidate.tagName,
        role: candidate.role,
        inputType: candidate.inputType,
        text: candidate.text,
        label: candidate.label,
        questionText: candidate.questionText,
        context: candidate.context,
        selector: candidate.selector,
        visible: candidate.visible,
        enabled: candidate.enabled,
        inViewport: candidate.inViewport
      }))
  }
}

const persistPlannerTrace = async (params: {
  trace: PlannerTraceRequestMeta
  snapshot: PageSnapshot
  systemPrompt: string
  userPayload: PlanInput
  userPrompt: string
  requestBody: Record<string, unknown>
  requestedModel: string
  resolvedModel: string | null
  responseStatus: number | null
  responseStatusText: string | null
  responseText: string | null
  responseJson: unknown
  responseId: string | null
  usage: Record<string, unknown> | null
  parsedPlan: AgentPlan | null
  errorMessage: string | null
}): Promise<PlannerTraceReference | undefined> => {
  if (!SHOULD_PERSIST_RUN_LOGS) {
    return undefined
  }

  const dayFolder = normalizeDayFolder(params.snapshot.timestamp)
  const directoryPath = join(
    process.cwd(),
    LOG_ROOT_DIRECTORY,
    dayFolder,
    "planner-traces",
    sanitizeSegment(params.trace.runId)
  )
  const fileName = `step-${padTraceNumber(params.trace.step)}-attempt-${padTraceNumber(
    params.trace.attempt
  )}.json`
  const filePath = join(directoryPath, fileName)
  const snapshotSummary = buildPlannerSnapshotSummary(params.snapshot)

  await mkdir(directoryPath, { recursive: true })
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        runId: params.trace.runId,
        step: params.trace.step,
        attempt: params.trace.attempt,
        requestedModel: params.requestedModel,
        resolvedModel: params.resolvedModel,
        request: {
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          input: params.userPayload,
          snapshotSummary,
          openRouterRequest: params.requestBody
        },
        response: {
          status: params.responseStatus,
          statusText: params.responseStatusText,
          responseId: params.responseId,
          usage: params.usage,
          rawText: params.responseText,
          json: params.responseJson,
          parsedPlan: params.parsedPlan
        },
        error: params.errorMessage
      },
      null,
      2
    )}\n`,
    "utf-8"
  )

  return {
    tracePath: filePath,
    snapshotSummary
  }
}

const safePersistPlannerTrace = async (
  params: Parameters<typeof persistPlannerTrace>[0] | null
) => {
  if (!params) {
    return undefined
  }

  try {
    return await persistPlannerTrace(params)
  } catch {
    return undefined
  }
}

export const requestPlanFromOpenRouter = async (
  input: PlanInput,
  options: RequestPlanOptions = {}
): Promise<RequestPlanResult> => {
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing")
  }

  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash"

  const userPayload: PlanInput = {
    command: input.command,
    snapshot: input.snapshot,
    history: input.history,
    ...(input.memory ? { memory: input.memory } : {})
  }
  const userPrompt = JSON.stringify(userPayload)
  const requestBody = {
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
        content: userPrompt
      }
    ]
  }

  let responseStatus: number | null = null
  let responseStatusText: string | null = null
  let responseText: string | null = null
  let responseJson: unknown = null
  let responseId: string | null = null
  let resolvedModel: string | null = null
  let usage: Record<string, unknown> | null = null
  let parsedPlan: AgentPlan | null = null
  let errorMessage: string | null = null

  try {
    const response = await fetch(`${getApiBase()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    })

    responseStatus = response.status
    responseStatusText = response.statusText
    responseText = await response.text()
    responseJson = safeJsonParse(responseText)

    if (!response.ok) {
      throw new Error(
        `OpenRouter request failed: ${response.status} ${responseText}`
      )
    }

    if (!isObject(responseJson)) {
      throw new Error("OpenRouter response was not valid JSON")
    }

    const data = responseJson as OpenRouterResponse
    responseId = typeof data.id === "string" ? data.id : null
    resolvedModel = typeof data.model === "string" ? data.model : null
    usage = isObject(data.usage) ? data.usage : null

    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error("OpenRouter response has no message content")
    }

    const parsed = safeJsonParse(content)
    const normalizedPlan = normalizeAgentPlan(parsed)

    if (!normalizedPlan) {
      throw new Error("OpenRouter response is not a valid AgentPlan JSON")
    }

    parsedPlan = normalizedPlan

    return {
      plan: parsedPlan,
      planner: await safePersistPlannerTrace(
        options.trace
          ? {
              trace: options.trace,
              snapshot: input.snapshot,
              systemPrompt: SYSTEM_PROMPT,
              userPayload,
              userPrompt,
              requestBody,
              requestedModel: model,
              resolvedModel,
              responseStatus,
              responseStatusText,
              responseText,
              responseJson,
              responseId,
              usage,
              parsedPlan,
              errorMessage
            }
          : null
      )
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown error"

    await safePersistPlannerTrace(
      options.trace
        ? {
            trace: options.trace,
            snapshot: input.snapshot,
            systemPrompt: SYSTEM_PROMPT,
            userPayload,
            userPrompt,
            requestBody,
            requestedModel: model,
            resolvedModel,
            responseStatus,
            responseStatusText,
            responseText,
            responseJson,
            responseId,
            usage,
            parsedPlan,
            errorMessage
          }
        : null
    )

    throw error
  }
}
