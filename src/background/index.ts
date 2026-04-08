import type {
  AgentAuthSession,
  AgentEvent,
  AgentRuntimeMessage,
  AgentStartMessage
} from "~lib/agent/messages"
import { rankCandidates } from "~lib/agent/ranking"
import type {
  AgentAction,
  AgentExecutionCandidateSummary,
  AgentExecutionNodeSummary,
  AgentExecutionPopupSummary,
  AgentExecutionSnapshotSummary,
  AgentExecutionTrace,
  AgentMemoryEntry,
  AgentMemoryUpsertInput,
  AgentPlan,
  AgentRunLog,
  AgentRunLogStep,
  AgentStepExecution,
  AgentStepRecord,
  ElementCandidate,
  MediaPlaybackState,
  PageMediaSummary,
  PageSnapshot,
  PlannerMemoryEntry,
  PlannerTraceReference
} from "~lib/agent/types"
import { AGENT_MAX_CANDIDATES, AGENT_MAX_STEPS } from "~lib/agent/types"
import { isAgentPlan, isObject, isSensitiveAction } from "~lib/agent/validation"

type PendingConfirmation = {
  resolve: (approved: boolean) => void
}

type PendingStopWait = {
  timeoutId: ReturnType<typeof setTimeout>
  reject: (error: Error) => void
}

type RunSession = {
  runId: string
  command: string
  tabId: number
  initialUrl: string
  startedAt: string
  history: AgentStepRecord[]
  runLogSteps: AgentRunLogStep[]
  pendingConfirmation: PendingConfirmation | null
  pendingWait: PendingStopWait | null
  activePlanController: AbortController | null
  stopRequested: boolean
  lastInteractionFrameId: number
  controlValueOverrides: Map<string, string>
  memoryLoaded: boolean
  memoryCache: PlannerMemoryEntry[]
  lastMediaObservation: {
    url: string
    currentTime: number | null
    playbackState: MediaPlaybackState
  } | null
}

const sessions = new Map<string, RunSession>()
let authSessionCache: AgentAuthSession | null | undefined

const AGENT_API_BASE =
  process.env.PLASMO_PUBLIC_AGENT_API_BASE ?? "http://localhost:1947"
const SHOULD_PERSIST_RUN_LOGS =
  process.env.PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS?.trim().toLowerCase() === "true"

const PLAN_REQUEST_TIMEOUT_MS = 30000
const PLAN_MAX_ATTEMPTS = 3
const PLAN_RETRY_BASE_DELAY_MS = 450
const LOOP_REPEAT_THRESHOLD = 4
const DROPDOWN_OPEN_REPEAT_THRESHOLD = 3
const MAX_CONSECUTIVE_ACTION_ERRORS = 3
const MAX_STAGNANT_CLICK_STEPS = 8
const MAX_STAGNANT_INTERACTION_STEPS = 8
const RUN_LOG_REQUEST_TIMEOUT_MS = 12000
const AGENT_MEMORY_STORAGE_KEY = "agent_memory_v1"
const AGENT_AUTH_STORAGE_KEY = "agent_auth_session_v1"
const AGENT_MEMORY_MAX_ENTRIES = 160
const AGENT_MEMORY_MAX_QUESTION_LENGTH = 220
const AGENT_MEMORY_MAX_ANSWER_LENGTH = 1600
const AGENT_MEMORY_MAX_PLANNER_ITEMS = 48
const AGENT_MEMORY_MAX_PLANNER_QUESTION_LENGTH = 180
const AGENT_MEMORY_MAX_PLANNER_ANSWER_LENGTH = 520
const AGENT_MEMORY_MIN_RECENT_CONTEXT_ITEMS = 8
const AGENT_FORM_MAX_CANDIDATES = 140
const AUTH_EXPIRY_SKEW_SECONDS = 30
const STOPPED_BY_USER_MESSAGE = "Stopped by user"
const CLICK_SETTLE_DELAY_MS = 550
const POST_NAVIGATION_SETTLE_DELAY_MS = 220
const SCROLL_SETTLE_DELAY_MS = 280

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return "Unknown error"
}

class RunStoppedError extends Error {
  constructor() {
    super(STOPPED_BY_USER_MESSAGE)
    this.name = "RunStoppedError"
  }
}

const createRunStoppedError = () => new RunStoppedError()

const isRunStoppedError = (error: unknown) => {
  return error instanceof RunStoppedError
}

const assertRunNotStopped = (session: RunSession) => {
  if (session.stopRequested) {
    throw createRunStoppedError()
  }
}

const sanitizeAuthSession = (value: unknown): AgentAuthSession | null => {
  if (!isObject(value)) {
    return null
  }

  if (
    typeof value.accessToken !== "string" ||
    typeof value.userId !== "string"
  ) {
    return null
  }

  const accessToken = value.accessToken.trim()
  const userId = value.userId.trim()

  if (!accessToken || !userId) {
    return null
  }

  const expiresAt =
    typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
      ? value.expiresAt
      : null
  const email =
    typeof value.email === "string" && value.email.trim().length > 0
      ? value.email.trim()
      : null

  return {
    accessToken,
    expiresAt,
    userId,
    email
  }
}

const readStoredAuthSession = async () => {
  if (authSessionCache !== undefined) {
    return authSessionCache
  }

  const stored = await chrome.storage.local.get(AGENT_AUTH_STORAGE_KEY)
  const raw = stored[AGENT_AUTH_STORAGE_KEY]
  const session = sanitizeAuthSession(raw)
  authSessionCache = session
  return session
}

const writeStoredAuthSession = async (session: AgentAuthSession | null) => {
  authSessionCache = session

  await chrome.storage.local.set({
    [AGENT_AUTH_STORAGE_KEY]: session
  })
}

const isAuthSessionExpired = (session: AgentAuthSession) => {
  if (session.expiresAt === null) {
    return false
  }

  return session.expiresAt <= Date.now() / 1000 + AUTH_EXPIRY_SKEW_SECONDS
}

const getActiveAuthSession = async () => {
  const session = await readStoredAuthSession()

  if (!session) {
    throw new Error("Sign in required in the sidepanel before running Zap")
  }

  if (isAuthSessionExpired(session)) {
    await writeStoredAuthSession(null)
    throw new Error("Session expired. Sign in again to continue")
  }

  return session
}

const getAgentApiHeaders = async (includeContentType: boolean) => {
  const session = await getActiveAuthSession()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`
  }

  if (includeContentType) {
    headers["Content-Type"] = "application/json"
  }

  return headers
}

const getOptionalAgentApiHeaders = async (includeContentType: boolean) => {
  const headers: Record<string, string> = {}

  if (includeContentType) {
    headers["Content-Type"] = "application/json"
  }

  const session = await readStoredAuthSession()

  if (!session) {
    return headers
  }

  if (isAuthSessionExpired(session)) {
    await writeStoredAuthSession(null)
    return headers
  }

  headers.Authorization = `Bearer ${session.accessToken}`
  return headers
}

const FORM_INTENT_PATTERN =
  /\b(fill|form|apply|signup|sign up|register|checkout|check out|billing|shipping|profile|contact|autofill|resume|cv|type|enter)\b/
const FORM_FIELD_HINT_PATTERN =
  /\b(name|first|last|surname|email|phone|mobile|address|street|city|state|province|zip|postal|country|company|title|job|linkedin|github|website|portfolio|dob|birth|password|username|card|cvv|iban|swift|bank|tax|ssn|aadhaar|passport|otp|verification)\b/

const MEMORY_MATCH_STOPWORDS = new Set([
  "the",
  "and",
  "your",
  "with",
  "from",
  "that",
  "this",
  "what",
  "which",
  "when",
  "where",
  "who",
  "how",
  "have",
  "has",
  "been",
  "was",
  "were",
  "for",
  "into",
  "about",
  "please",
  "would",
  "should",
  "could",
  "will",
  "you",
  "are",
  "any"
])

const MEMORY_ALIAS_GROUPS = [
  ["email", "e-mail", "mail"],
  ["phone", "mobile", "cell", "whatsapp", "contact"],
  ["first name", "last name", "surname", "name", "fullname"],
  ["company", "startup", "organization", "organisation"],
  ["website", "url", "portfolio", "linkedin", "github"],
  [
    "address",
    "street",
    "city",
    "state",
    "province",
    "postal",
    "zip",
    "country"
  ],
  ["dob", "date of birth", "birthday", "birth"],
  ["description", "summary", "about", "what does"],
  ["revenue", "income", "arr", "mrr"],
  ["location", "based", "live"]
]

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim()

const getControlSelector = (candidate: ElementCandidate) => {
  return candidate.interactionSelector || candidate.selector
}

const getControlValueOverrideKey = (
  frameId: number,
  frameUrl: string,
  selector: string
) => {
  return `${frameId}|${frameUrl}|${selector}`
}

const getControlValueOverrideKeyForCandidate = (
  candidate: ElementCandidate
) => {
  return getControlValueOverrideKey(
    candidate.frameId,
    candidate.frameUrl,
    getControlSelector(candidate)
  )
}

const FILL_ALL_FIELDS_PATTERN =
  /\b(rest|remaining|all|entire)\b|\bfill (?:this|the) form\b/

const getCandidateDisplayName = (candidate: ElementCandidate) => {
  return normalizeText(
    candidate.label ||
      candidate.describedBy ||
      candidate.questionText ||
      candidate.placeholder ||
      candidate.selector
  )
}

const isTextLikeFormField = (candidate: ElementCandidate) => {
  if (candidate.controlKind === "select_option") {
    return false
  }

  if (candidate.inputType === "file") {
    return false
  }

  return (
    candidate.controlKind === "text" ||
    candidate.controlKind === "native_select" ||
    candidate.controlKind === "custom_select" ||
    candidate.tagName === "textarea" ||
    candidate.tagName === "select" ||
    (candidate.tagName === "input" &&
      candidate.inputType !== "radio" &&
      candidate.inputType !== "checkbox")
  )
}

const cleanQuestionLabel = (value: string) => {
  const parts = value
    .split("|")
    .map((part) => normalizeText(part))
    .filter((part) => part.length >= 4)

  return parts[parts.length - 1] ?? ""
}

const getFormCompletionBlockers = (snapshot: PageSnapshot, command: string) => {
  const required = new Set<string>()
  const optional = new Set<string>()
  const seenFields = new Set<string>()

  for (const candidate of snapshot.elements) {
    if (!candidate.enabled || !isTextLikeFormField(candidate)) {
      continue
    }

    const fieldKey = `${candidate.frameId}|${candidate.frameUrl}|${getControlSelector(candidate)}`

    if (seenFields.has(fieldKey)) {
      continue
    }

    seenFields.add(fieldKey)

    if (candidate.valuePreview.trim().length > 0) {
      continue
    }

    const fieldLabel = getCandidateDisplayName(candidate)

    if (!fieldLabel) {
      continue
    }

    if (candidate.required) {
      required.add(fieldLabel)
    } else if (FILL_ALL_FIELDS_PATTERN.test(command.toLowerCase())) {
      optional.add(fieldLabel)
    }
  }

  const radioGroups = new Map<string, ElementCandidate[]>()

  for (const candidate of snapshot.elements) {
    if (
      !candidate.enabled ||
      candidate.inputType !== "radio" ||
      (candidate.nameAttr.length === 0 && candidate.idAttr.length === 0)
    ) {
      continue
    }

    const groupKey = `${candidate.frameId}|${candidate.frameUrl}|${candidate.nameAttr || candidate.idAttr}`
    const group = radioGroups.get(groupKey)

    if (group) {
      group.push(candidate)
    } else {
      radioGroups.set(groupKey, [candidate])
    }
  }

  for (const group of radioGroups.values()) {
    if (!group.some((candidate) => candidate.required)) {
      continue
    }

    if (group.some((candidate) => candidate.checked === true)) {
      continue
    }

    const fieldLabel = cleanQuestionLabel(
      group
        .map((candidate) => {
          return (
            candidate.describedBy ||
            candidate.questionText ||
            candidate.context ||
            candidate.label
          )
        })
        .find(Boolean) ?? ""
    )

    if (fieldLabel) {
      required.add(fieldLabel)
    }
  }

  return {
    required: Array.from(required),
    optional: Array.from(optional)
  }
}

const isSubmitLikeCandidate = (candidate: ElementCandidate) => {
  const labelText = `${candidate.text} ${candidate.label}`.toLowerCase()

  return /submit|send|confirm|publish|save|complete/.test(labelText)
}

const applyControlValueOverrides = (
  session: RunSession,
  snapshot: PageSnapshot
): PageSnapshot => {
  if (session.controlValueOverrides.size === 0) {
    return snapshot
  }

  const overriddenControls = new Map<string, string>()

  snapshot.elements = snapshot.elements.map((candidate) => {
    if (candidate.controlKind !== "custom_select") {
      return candidate
    }

    const override = session.controlValueOverrides.get(
      getControlValueOverrideKeyForCandidate(candidate)
    )

    if (!override) {
      return candidate
    }

    const controlKey = getControlValueOverrideKey(
      candidate.frameId,
      candidate.frameUrl,
      getControlSelector(candidate)
    )
    overriddenControls.set(controlKey, override)

    return {
      ...candidate,
      valuePreview: override,
      popupState: "closed"
    }
  })

  if (overriddenControls.size === 0) {
    return snapshot
  }

  snapshot.elements = snapshot.elements.map((candidate) => {
    if (
      candidate.controlKind !== "select_option" ||
      !candidate.ownerControlSelector
    ) {
      return candidate
    }

    const ownerKey = getControlValueOverrideKey(
      candidate.frameId,
      candidate.frameUrl,
      candidate.ownerControlSelector
    )

    if (!overriddenControls.has(ownerKey)) {
      return candidate
    }

    return {
      ...candidate,
      popupState: "closed",
      visible: false,
      inViewport: false,
      enabled: false
    }
  })

  return snapshot
}

const doesOptionBelongToControl = (
  option: ElementCandidate,
  control: ElementCandidate
) => {
  if (option.controlKind !== "select_option") {
    return false
  }

  if (
    option.frameId !== control.frameId ||
    option.frameUrl !== control.frameUrl
  ) {
    return false
  }

  const controlSelector = getControlSelector(control)

  if (
    option.ownerControlSelector &&
    option.ownerControlSelector === controlSelector
  ) {
    return true
  }

  const optionLabel = normalizeText(
    option.label || option.questionText
  ).toLowerCase()
  const controlLabel = normalizeText(
    control.label || control.questionText
  ).toLowerCase()

  return (
    control.popupState === "open" &&
    optionLabel.length > 0 &&
    optionLabel === controlLabel
  )
}

const buildExecutionCandidateSummary = (
  candidate: ElementCandidate
): AgentExecutionCandidateSummary => {
  return {
    eid: candidate.eid,
    frameId: candidate.frameId,
    frameUrl: candidate.frameUrl,
    controlKind: candidate.controlKind,
    allowsTextEntry: candidate.allowsTextEntry,
    popupState: candidate.popupState,
    optionSource: candidate.optionSource,
    label: candidate.label,
    questionText: candidate.questionText,
    selector: candidate.selector,
    interactionSelector: candidate.interactionSelector,
    ownerControlSelector: candidate.ownerControlSelector,
    popupContainerSelector: candidate.popupContainerSelector
  }
}

const buildPopupSummaryFromSnapshot = (
  snapshot: PageSnapshot,
  candidate?: ElementCandidate
): AgentExecutionPopupSummary | undefined => {
  if (!candidate) {
    return undefined
  }

  const targetCandidate = snapshot.elements.find((item) => {
    return (
      item.selector === candidate.selector ||
      item.interactionSelector === candidate.interactionSelector
    )
  })
  const relatedOptions = snapshot.elements.filter((item) => {
    return doesOptionBelongToControl(item, candidate)
  })

  return {
    popupState: targetCandidate?.popupState ?? candidate.popupState,
    relatedOptionCount: relatedOptions.length,
    optionLabels: relatedOptions
      .map((item) =>
        normalizeText(item.text || item.label || item.questionText)
      )
      .filter(Boolean)
      .slice(0, 8)
  }
}

const buildAfterSnapshotSummary = (
  snapshot: PageSnapshot,
  candidate?: ElementCandidate
): AgentExecutionSnapshotSummary => {
  const targetCandidate = candidate
    ? snapshot.elements.find((item) => {
        return (
          item.selector === candidate.selector ||
          item.interactionSelector === candidate.interactionSelector
        )
      })
    : undefined

  return {
    url: snapshot.url,
    title: snapshot.title,
    timestamp: snapshot.timestamp,
    totalCandidates: snapshot.elements.length,
    visibleCandidates: snapshot.elements.filter((item) => item.visible).length,
    inViewportCandidates: snapshot.elements.filter((item) => item.inViewport)
      .length,
    media: snapshot.media,
    visibleTextPreview: snapshot.visibleTextPreview.slice(0, 8),
    ...(candidate
      ? {
          relatedOptions: buildPopupSummaryFromSnapshot(snapshot, candidate)
        }
      : {}),
    ...(targetCandidate
      ? {
          target: {
            popupState: targetCandidate.popupState,
            valuePreview: targetCandidate.valuePreview,
            visible: targetCandidate.visible,
            inViewport: targetCandidate.inViewport
          }
        }
      : {})
  }
}

const isPlayButtonCandidate = (candidate?: ElementCandidate) => {
  if (!candidate) {
    return false
  }

  const descriptor =
    `${candidate.text} ${candidate.label} ${candidate.questionText}`
      .toLowerCase()
      .trim()

  if (!/\bplay\b/.test(descriptor)) {
    return false
  }

  return !/\bautoplay\b/.test(descriptor)
}

const byUpdatedAtDesc = (
  left: { updatedAt: string },
  right: { updatedAt: string }
) => {
  return right.updatedAt.localeCompare(left.updatedAt)
}

const sanitizeMemoryEntry = (value: unknown): AgentMemoryEntry | null => {
  if (!isObject(value)) {
    return null
  }

  if (
    typeof value.id !== "string" ||
    typeof value.question !== "string" ||
    typeof value.answer !== "string"
  ) {
    return null
  }

  const question = normalizeText(value.question).slice(
    0,
    AGENT_MEMORY_MAX_QUESTION_LENGTH
  )
  const answer = normalizeText(value.answer).slice(
    0,
    AGENT_MEMORY_MAX_ANSWER_LENGTH
  )

  if (!question || !answer) {
    return null
  }

  const createdAt =
    typeof value.createdAt === "string"
      ? value.createdAt
      : typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString()
  const updatedAt =
    typeof value.updatedAt === "string" ? value.updatedAt : createdAt

  return {
    id: value.id,
    question,
    answer,
    createdAt,
    updatedAt
  }
}

const readStoredMemoryEntries = async (): Promise<AgentMemoryEntry[]> => {
  const stored = await chrome.storage.local.get(AGENT_MEMORY_STORAGE_KEY)
  const rawEntries = stored[AGENT_MEMORY_STORAGE_KEY]

  if (!Array.isArray(rawEntries)) {
    return []
  }

  return rawEntries
    .map((entry) => sanitizeMemoryEntry(entry))
    .filter((entry): entry is AgentMemoryEntry => entry !== null)
    .sort(byUpdatedAtDesc)
    .slice(0, AGENT_MEMORY_MAX_ENTRIES)
}

const writeStoredMemoryEntries = async (entries: AgentMemoryEntry[]) => {
  await chrome.storage.local.set({
    [AGENT_MEMORY_STORAGE_KEY]: entries
  })
}

const createMemoryId = () => {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

const upsertStoredMemoryEntry = async (input: AgentMemoryUpsertInput) => {
  const question = normalizeText(input.question).slice(
    0,
    AGENT_MEMORY_MAX_QUESTION_LENGTH
  )
  const answer = normalizeText(input.answer).slice(
    0,
    AGENT_MEMORY_MAX_ANSWER_LENGTH
  )

  if (!question || !answer) {
    throw new Error("Both question and answer are required")
  }

  const now = new Date().toISOString()
  const entries = await readStoredMemoryEntries()
  const existingById =
    typeof input.id === "string"
      ? entries.findIndex((entry) => entry.id === input.id)
      : -1
  const existingByQuestion = entries.findIndex(
    (entry) => entry.question.toLowerCase() === question.toLowerCase()
  )

  if (existingById >= 0) {
    const current = entries[existingById]
    entries[existingById] = {
      ...current,
      question,
      answer,
      updatedAt: now
    }
  } else if (existingByQuestion >= 0) {
    const current = entries[existingByQuestion]
    entries[existingByQuestion] = {
      ...current,
      answer,
      updatedAt: now
    }
  } else {
    entries.push({
      id: createMemoryId(),
      question,
      answer,
      createdAt: now,
      updatedAt: now
    })
  }

  const normalized = entries
    .sort(byUpdatedAtDesc)
    .slice(0, AGENT_MEMORY_MAX_ENTRIES)

  await writeStoredMemoryEntries(normalized)
  return normalized
}

const deleteStoredMemoryEntry = async (id: string) => {
  const trimmed = id.trim()

  if (!trimmed) {
    throw new Error("Memory id is required")
  }

  const entries = await readStoredMemoryEntries()
  const nextEntries = entries.filter((entry) => entry.id !== trimmed)

  await writeStoredMemoryEntries(nextEntries)
  return nextEntries
}

const toPlannerMemory = (entries: AgentMemoryEntry[]): PlannerMemoryEntry[] => {
  return entries.slice(0, AGENT_MEMORY_MAX_PLANNER_ITEMS).map((entry) => ({
    id: entry.id,
    question: entry.question.slice(0, AGENT_MEMORY_MAX_PLANNER_QUESTION_LENGTH),
    answer: entry.answer.slice(0, AGENT_MEMORY_MAX_PLANNER_ANSWER_LENGTH),
    updatedAt: entry.updatedAt
  }))
}

const tokenizeForMemoryMatch = (value: string) => {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !MEMORY_MATCH_STOPWORDS.has(token))
}

const containsAliasGroup = (haystack: string, aliases: string[]) => {
  return aliases.some((alias) => haystack.includes(alias))
}

const buildFieldDescriptor = (candidate: ElementCandidate) => {
  return [
    candidate.frameTitle,
    candidate.frameUrl,
    candidate.label,
    candidate.placeholder,
    candidate.questionText,
    candidate.describedBy,
    candidate.nameAttr,
    candidate.idAttr,
    candidate.forAttr,
    candidate.autocomplete,
    candidate.context,
    candidate.inputType ?? "",
    candidate.checked === true
      ? "checked selected true yes"
      : candidate.checked === false
        ? "unchecked unselected false no"
        : "",
    candidate.text
  ]
    .join(" ")
    .toLowerCase()
}

const scoreMemoryQuestion = (question: string, descriptorBlob: string) => {
  const questionLower = question.toLowerCase()
  const descriptorTokens = new Set(tokenizeForMemoryMatch(descriptorBlob))
  const questionTokens = tokenizeForMemoryMatch(questionLower)
  let score = 0

  for (const token of questionTokens) {
    if (descriptorTokens.has(token)) {
      score += 4
    }
  }

  if (questionLower.length >= 8 && descriptorBlob.includes(questionLower)) {
    score += 10
  }

  for (const group of MEMORY_ALIAS_GROUPS) {
    if (
      containsAliasGroup(questionLower, group) &&
      containsAliasGroup(descriptorBlob, group)
    ) {
      score += 6
    }
  }

  return score
}

const selectPlannerMemoryForSnapshot = (
  entries: PlannerMemoryEntry[],
  snapshot: PageSnapshot,
  command: string
) => {
  if (entries.length === 0) {
    return []
  }

  const editableDescriptors = snapshot.elements
    .filter(
      (candidate) =>
        candidate.enabled &&
        isEditableCandidate(candidate) &&
        candidate.inputType !== "file"
    )
    .map((candidate) => buildFieldDescriptor(candidate))
    .filter((descriptor) => descriptor.length > 0)

  if (editableDescriptors.length === 0) {
    return entries.slice(0, AGENT_MEMORY_MIN_RECENT_CONTEXT_ITEMS)
  }

  const descriptorBlob = `${command.toLowerCase()} ${editableDescriptors.join(" ")}`

  const scoredEntries = entries
    .map((entry) => ({
      entry,
      score: scoreMemoryQuestion(entry.question, descriptorBlob)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.entry.updatedAt.localeCompare(left.entry.updatedAt)
    })

  const selected: PlannerMemoryEntry[] = []
  const selectedIds = new Set<string>()

  for (const item of scoredEntries) {
    if (item.score <= 0 || selected.length >= AGENT_MEMORY_MAX_PLANNER_ITEMS) {
      continue
    }

    selected.push(item.entry)
    selectedIds.add(item.entry.id)
  }

  for (const entry of entries) {
    if (
      selected.length >= AGENT_MEMORY_MAX_PLANNER_ITEMS ||
      selected.length >= AGENT_MEMORY_MIN_RECENT_CONTEXT_ITEMS
    ) {
      break
    }

    if (selectedIds.has(entry.id)) {
      continue
    }

    selected.push(entry)
    selectedIds.add(entry.id)
  }

  return selected
}

const emitEvent = async (event: AgentEvent) => {
  try {
    await chrome.runtime.sendMessage({
      type: "agent/event",
      event
    })
  } catch {
    // Ignore when no UI is listening.
  }
}

const getCurrentTab = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  })

  if (!tab?.id) {
    throw new Error("Could not determine active tab")
  }

  return tab
}

const assertAutomatableUrl = (url: string | undefined) => {
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error(
      "Open a normal website tab (http/https) before running automation. chrome:// and extension pages are not supported."
    )
  }
}

const waitForTabComplete = async (tabId: number, timeoutMs = 15000) => {
  const currentTab = await chrome.tabs.get(tabId)

  if (currentTab.status === "complete") {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error("Timed out waiting for tab to load"))
    }, timeoutMs)

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return
      }

      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }

    chrome.tabs.onUpdated.addListener(listener)
  })
}

type RawRect = {
  x: number
  y: number
  width: number
  height: number
}

type RawCandidate = {
  controlKind: ElementCandidate["controlKind"]
  allowsTextEntry: ElementCandidate["allowsTextEntry"]
  popupState: ElementCandidate["popupState"]
  optionSource: ElementCandidate["optionSource"]
  tagName: string
  role: string | null
  inputType: string | null
  forAttr: string
  text: string
  label: string
  placeholder: string
  href: string
  valuePreview: string
  questionText: string
  describedBy: string
  nameAttr: string
  idAttr: string
  autocomplete: string
  required: boolean
  checked: boolean | null
  maxLength: number | null
  selector: string
  interactionSelector: string
  ownerControlSelector: string
  popupContainerSelector: string
  context: string
  visible: boolean
  enabled: boolean
  inViewport: boolean
  rect: RawRect
}

type RawIframe = {
  src: string
  title: string
  nameAttr: string
  idAttr: string
  visible: boolean
  inViewport: boolean
  contentDocumentAccessible: boolean
  rect: RawRect
}

type RawFrameHost = {
  visible: boolean
  inViewport: boolean
}

type RawMediaSummary = Omit<PageMediaSummary, "progressing">

type FrameLocalSnapshot = {
  url: string
  title: string
  timestamp: string
  viewport: {
    width: number
    height: number
  }
  frameHost: RawFrameHost | null
  iframes: RawIframe[]
  media: RawMediaSummary | null
  visibleTextPreview: string[]
  elements: RawCandidate[]
}

const collectSnapshotInPage = () => {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim()
  const PROMPT_HEADING_SELECTOR = "h1, h2, h3, h4, legend, [role='heading']"
  const PROMPT_TEXT_SELECTOR = `${PROMPT_HEADING_SELECTOR}, label, p, span`
  const CUSTOM_SELECT_ROOT_SELECTOR = [
    "[data-sentry-component='CustomSelect']",
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='menu']"
  ].join(",")
  const OPTION_ROLE_SELECTOR = [
    "[role='option']",
    "[role='menuitem']",
    "[role='menuitemradio']",
    "[role='menuitemcheckbox']"
  ].join(",")
  const OPTION_CONTAINER_SELECTOR = "[role='listbox'], [role='menu']"
  const GENERIC_POPUP_CONTAINER_SELECTOR = [
    ".tally-context-menu",
    "[class*='context-menu']",
    "[class*='contextmenu']",
    "[class*='dropdown-menu']",
    "[class*='listbox']",
    OPTION_CONTAINER_SELECTOR
  ].join(",")
  const GENERIC_OPTION_ITEM_SELECTOR = [
    "[class*='list-item']",
    "li",
    "button",
    "a[href]"
  ].join(",")
  const INTERACTIVE_DESCENDANT_SELECTOR = [
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "button",
    "[role='combobox']",
    "[role='button']",
    "[role='checkbox']",
    "[role='radio']",
    OPTION_ROLE_SELECTOR,
    "[contenteditable='true']"
  ].join(",")
  const BLOCK_CONTAINER_SELECTOR = "[data-block-id], [data-block-type]"

  const isVisible = (element: Element) => {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const hasSize = rect.width > 0 && rect.height > 0
    const styleVisible =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"

    return hasSize && styleVisible
  }

  const inViewport = (element: Element) => {
    const rect = element.getBoundingClientRect()
    const vertical = rect.bottom >= 0 && rect.top <= window.innerHeight
    const horizontal = rect.right >= 0 && rect.left <= window.innerWidth

    return vertical && horizontal
  }

  const cssEscape = (value: string) => {
    if (window.CSS?.escape) {
      return window.CSS.escape(value)
    }

    return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1")
  }

  const createSelector = (element: Element) => {
    if (element.id) {
      return `#${cssEscape(element.id)}`
    }

    const testId = element.getAttribute("data-testid")

    if (testId) {
      return `[data-testid="${testId.replace(/"/g, '\\"')}"]`
    }

    const name = element.getAttribute("name")
    const tag = element.tagName.toLowerCase()

    if (element instanceof HTMLLabelElement && element.htmlFor) {
      return `label[for="${element.htmlFor.replace(/"/g, '\\"')}"]`
    }

    if (name) {
      return `${tag}[name="${name.replace(/"/g, '\\"')}"]`
    }

    const parts: string[] = []
    let node: Element | null = element
    let depth = 0

    while (node && depth < 5) {
      const parent = node.parentElement
      const tagName = node.tagName.toLowerCase()

      if (!parent) {
        parts.unshift(tagName)
        break
      }

      const siblings = Array.from(parent.children).filter(
        (item) => item.tagName === node?.tagName
      )
      const index = siblings.indexOf(node) + 1
      parts.unshift(`${tagName}:nth-of-type(${index})`)
      node = parent
      depth += 1
    }

    return parts.join(" > ")
  }

  const getLabel = (element: Element) => {
    const htmlElement = element as HTMLElement
    const aria = htmlElement.getAttribute("aria-label")
    if (aria) {
      return normalize(aria)
    }

    if (htmlElement instanceof HTMLLabelElement) {
      return normalize(htmlElement.textContent ?? "")
    }

    if (
      htmlElement instanceof HTMLInputElement ||
      htmlElement instanceof HTMLTextAreaElement ||
      htmlElement instanceof HTMLSelectElement
    ) {
      const linkedLabel = htmlElement.labels?.[0]
      if (linkedLabel) {
        return normalize(linkedLabel.textContent ?? "")
      }
    }

    return ""
  }

  const uniqueJoin = (values: string[], maxLength = 240) => {
    const output: string[] = []
    const seen = new Set<string>()

    for (const value of values) {
      const normalizedValue = normalize(value)

      if (!normalizedValue) {
        continue
      }

      const key = normalizedValue.toLowerCase()

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      output.push(normalizedValue)
    }

    return output.join(" | ").slice(0, maxLength)
  }

  const hasInteractiveDescendants = (element: Element) => {
    return (
      element.matches(INTERACTIVE_DESCENDANT_SELECTOR) ||
      element.querySelector(INTERACTIVE_DESCENDANT_SELECTOR) !== null
    )
  }

  const isPromptOnlyContainer = (element: Element) => {
    return (
      element.matches("[data-block-type='TITLE']") ||
      !hasInteractiveDescendants(element)
    )
  }

  const getPromptTextFromContainer = (element: Element) => {
    const heading = element.matches(PROMPT_HEADING_SELECTOR)
      ? element
      : element.querySelector(PROMPT_HEADING_SELECTOR)
    const headingText = normalize(heading?.textContent ?? "")

    if (headingText.length >= 4 && headingText.length <= 260) {
      return headingText
    }

    if (hasInteractiveDescendants(element)) {
      return ""
    }

    const promptElements = element.matches(PROMPT_TEXT_SELECTOR)
      ? [element]
      : Array.from(element.querySelectorAll(PROMPT_TEXT_SELECTOR))
    const snippets = promptElements
      .map((item) =>
        normalize((item as HTMLElement).innerText || item.textContent || "")
      )
      .filter((value) => value.length >= 4 && value.length <= 260)

    return uniqueJoin(snippets, 260)
  }

  const getDropdownRoot = (element: Element) => {
    const htmlElement = element as HTMLElement

    if (htmlElement.matches(CUSTOM_SELECT_ROOT_SELECTOR)) {
      return htmlElement
    }

    return htmlElement.closest(CUSTOM_SELECT_ROOT_SELECTOR)
  }

  const hasExplicitPopupTrigger = (element: Element) => {
    const htmlElement = element as HTMLElement
    const dropdownRoot = getDropdownRoot(element)
    const popupHintElements = [htmlElement, dropdownRoot].filter(
      (item): item is HTMLElement => item instanceof HTMLElement
    )

    return popupHintElements.some((item) => {
      return (
        item.getAttribute("aria-haspopup") === "listbox" ||
        item.getAttribute("aria-haspopup") === "menu" ||
        item.hasAttribute("aria-controls") ||
        item.hasAttribute("aria-owns") ||
        item.getAttribute("role") === "combobox"
      )
    })
  }

  const getElementClassName = (element: Element) => {
    return typeof (element as HTMLElement).className === "string"
      ? (element as HTMLElement).className.toLowerCase()
      : ""
  }

  const getOptionText = (element: Element) => {
    const htmlElement = element as HTMLElement

    return normalize(
      htmlElement.getAttribute("title") ||
        htmlElement.innerText ||
        htmlElement.textContent ||
        htmlElement.getAttribute("aria-label") ||
        ""
    ).slice(0, 120)
  }

  const getControlledPopupElements = (element: Element) => {
    const refs = [
      (element as HTMLElement).getAttribute("aria-controls"),
      (element as HTMLElement).getAttribute("aria-owns"),
      getDropdownRoot(element)?.getAttribute("aria-controls"),
      getDropdownRoot(element)?.getAttribute("aria-owns")
    ]

    const popupElements: HTMLElement[] = []
    const seen = new Set<HTMLElement>()

    for (const refGroup of refs) {
      if (!refGroup) {
        continue
      }

      for (const id of refGroup.split(/\s+/).map((value) => value.trim())) {
        if (!id) {
          continue
        }

        const controlled = document.getElementById(id)

        if (!(controlled instanceof HTMLElement) || seen.has(controlled)) {
          continue
        }

        seen.add(controlled)
        popupElements.push(controlled)
      }
    }

    return popupElements
  }

  const getGenericPopupItems = (container: Element) => {
    const items: HTMLElement[] = []
    const seen = new Set<HTMLElement>()
    const registerItem = (item: Element) => {
      if (
        !(item instanceof HTMLElement) ||
        seen.has(item) ||
        !isVisible(item)
      ) {
        return
      }

      const optionText = getOptionText(item)

      if (!optionText || optionText.length > 120) {
        return
      }

      const closestPopup = item.closest(GENERIC_POPUP_CONTAINER_SELECTOR)

      if (closestPopup && closestPopup !== container) {
        return
      }

      const nestedInteractive = Array.from(
        item.querySelectorAll(INTERACTIVE_DESCENDANT_SELECTOR)
      ).some((descendant) => descendant !== item)

      if (nestedInteractive) {
        return
      }

      seen.add(item)
      items.push(item)
    }

    Array.from(
      container.querySelectorAll(GENERIC_OPTION_ITEM_SELECTOR)
    ).forEach(registerItem)

    if (items.length >= 2) {
      return items
    }

    Array.from(container.querySelectorAll("div[title], span[title]")).forEach(
      (item) => {
        const owner = item.closest("[class*='list-item']") ?? item
        registerItem(owner)
      }
    )

    return items
  }

  const hasPopupClassHint = (element: Element) => {
    const className = getElementClassName(element)

    return [
      "context-menu",
      "contextmenu",
      "dropdown-menu",
      "listbox",
      "popup-menu",
      "select-menu"
    ].some((token) => className.includes(token))
  }

  const isPopupLikeContainer = (element: Element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false
    }

    if (element.getAttribute("aria-hidden") === "true") {
      return false
    }

    const rect = element.getBoundingClientRect()

    if (rect.width < 80 || rect.height < 40) {
      return false
    }

    const style = window.getComputedStyle(element)
    const positioned =
      style.position === "fixed" || style.position === "absolute"
    const itemCount =
      element.querySelectorAll(OPTION_ROLE_SELECTOR).length +
      getGenericPopupItems(element).length

    if (itemCount < 2) {
      return false
    }

    return positioned || hasPopupClassHint(element)
  }

  const findPopupContainerForControl = (element: Element) => {
    const controlledPopup = getControlledPopupElements(element).find(
      (popup) => {
        return (
          isVisible(popup) &&
          (popup.querySelector(OPTION_ROLE_SELECTOR) !== null ||
            getGenericPopupItems(popup).length >= 2)
        )
      }
    )

    if (controlledPopup) {
      return controlledPopup
    }

    const dropdownRoot = getDropdownRoot(element) ?? element
    const dropdownRect = dropdownRoot.getBoundingClientRect()
    const popupCandidates = Array.from(
      document.querySelectorAll(GENERIC_POPUP_CONTAINER_SELECTOR)
    ).filter((candidate): candidate is HTMLElement =>
      isPopupLikeContainer(candidate)
    )

    if (popupCandidates.length === 0) {
      return null
    }

    const maxHorizontalGap = Math.max(240, dropdownRect.width * 1.75)

    const scored = popupCandidates
      .map((popup) => {
        const rect = popup.getBoundingClientRect()
        const horizontalGap = Math.max(
          0,
          Math.max(
            dropdownRect.left - rect.right,
            rect.left - dropdownRect.right
          )
        )
        const verticalGap = Math.max(
          0,
          Math.max(
            dropdownRect.top - rect.bottom,
            rect.top - dropdownRect.bottom
          )
        )

        if (horizontalGap > maxHorizontalGap || verticalGap > 420) {
          return null
        }

        const overlapsHorizontally =
          rect.left <= dropdownRect.right + 48 &&
          rect.right >= dropdownRect.left - 48
        const itemCount =
          popup.querySelectorAll(OPTION_ROLE_SELECTOR).length +
          getGenericPopupItems(popup).length
        const activeElement =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        const activeBoost =
          activeElement &&
          (dropdownRoot.contains(activeElement) ||
            popup.contains(activeElement))
            ? -120
            : 0

        return {
          popup,
          score:
            horizontalGap +
            verticalGap +
            (overlapsHorizontally ? -40 : 0) +
            (hasPopupClassHint(popup) ? -30 : 0) +
            activeBoost -
            itemCount * 12
        }
      })
      .filter(
        (value): value is { popup: HTMLElement; score: number } =>
          value !== null
      )
      .sort((left, right) => left.score - right.score)

    return scored[0]?.popup ?? null
  }

  const hasVisibleControlledPopup = (element: Element) => {
    return getControlledPopupElements(element).some((popup) => {
      return (
        isVisible(popup) &&
        (popup.querySelector(OPTION_ROLE_SELECTOR) !== null ||
          getGenericPopupItems(popup).length >= 2)
      )
    })
  }

  const isLikelyCustomSelect = (element: Element) => {
    if (element instanceof HTMLSelectElement) {
      return false
    }

    const htmlElement = element as HTMLElement
    const role = htmlElement.getAttribute("role")

    if (role === "combobox") {
      return true
    }

    if (getDropdownRoot(element)) {
      return true
    }

    return hasExplicitPopupTrigger(element)
  }

  const getPopupState = (
    element: Element,
    controlKind: RawCandidate["controlKind"]
  ): RawCandidate["popupState"] => {
    if (controlKind !== "custom_select") {
      return "unknown"
    }

    const htmlElement = element as HTMLElement
    const dropdownRoot = getDropdownRoot(element)
    const expandedValues = [
      htmlElement.getAttribute("aria-expanded"),
      dropdownRoot?.getAttribute("aria-expanded")
    ]

    for (const expanded of expandedValues) {
      if (expanded === "true") {
        return "open"
      }

      if (expanded === "false") {
        return "closed"
      }
    }

    if (hasVisibleControlledPopup(element)) {
      return "open"
    }

    return "unknown"
  }

  const isSearchLikeCustomSelect = (element: Element) => {
    const htmlElement = element as HTMLElement
    const textSignals = [
      htmlElement.getAttribute("role"),
      htmlElement.getAttribute("aria-autocomplete"),
      htmlElement.getAttribute("aria-label"),
      htmlElement.getAttribute("placeholder"),
      htmlElement.getAttribute("name"),
      htmlElement.getAttribute("id"),
      htmlElement.getAttribute("autocomplete")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

    if (htmlElement.getAttribute("role") === "combobox") {
      return true
    }

    if (htmlElement.hasAttribute("aria-autocomplete")) {
      return true
    }

    return /\b(search|searchbox|query|find|lookup|look up|autocomplete)\b/.test(
      textSignals
    )
  }

  const allowsTextEntry = (
    element: Element,
    inputType: string | null,
    controlKind: RawCandidate["controlKind"]
  ) => {
    const htmlElement = element as HTMLElement
    const role = htmlElement.getAttribute("role")

    if (htmlElement instanceof HTMLTextAreaElement) {
      return !htmlElement.readOnly && !htmlElement.disabled
    }

    if (htmlElement instanceof HTMLInputElement) {
      const normalizedType = (
        inputType ||
        htmlElement.type ||
        "text"
      ).toLowerCase()

      if (
        [
          "button",
          "checkbox",
          "color",
          "file",
          "hidden",
          "image",
          "radio",
          "range",
          "reset",
          "submit"
        ].includes(normalizedType)
      ) {
        return false
      }

      if (htmlElement.readOnly || htmlElement.disabled) {
        return false
      }

      if (controlKind === "custom_select") {
        return isSearchLikeCustomSelect(element)
      }

      return true
    }

    if (htmlElement.isContentEditable || role === "textbox") {
      return true
    }

    return false
  }

  const getControlKind = (
    element: Element,
    inputType: string | null
  ): RawCandidate["controlKind"] => {
    const htmlElement = element as HTMLElement
    const role = htmlElement.getAttribute("role")

    if (htmlElement.matches(OPTION_ROLE_SELECTOR)) {
      return "select_option"
    }

    if (element instanceof HTMLSelectElement) {
      return "native_select"
    }

    if (
      inputType === "checkbox" ||
      role === "checkbox" ||
      role === "menuitemcheckbox"
    ) {
      return "checkbox"
    }

    if (inputType === "radio" || role === "radio" || role === "menuitemradio") {
      return "radio"
    }

    if (htmlElement instanceof HTMLAnchorElement || role === "link") {
      return "link"
    }

    if (
      htmlElement instanceof HTMLButtonElement ||
      role === "button" ||
      htmlElement.matches("button")
    ) {
      return "button"
    }

    if (isLikelyCustomSelect(element)) {
      return "custom_select"
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      htmlElement.isContentEditable ||
      role === "textbox"
    ) {
      return "text"
    }

    return "other"
  }

  const hasRequiredIndicator = (element: Element) => {
    if (
      element.querySelector(
        ".tally-required-indicator, [data-sentry-component='RequiredIndicator'], [class*='required-indicator'], [class*='requiredIndicator'], [aria-label='Required']"
      )
    ) {
      return true
    }

    return Array.from(element.querySelectorAll("span, div")).some((item) => {
      const text = normalize(item.textContent ?? "").toLowerCase()

      if (text !== "*" && text !== "required") {
        return false
      }

      const className =
        typeof (item as HTMLElement).className === "string"
          ? (item as HTMLElement).className.toLowerCase()
          : ""

      return text === "*" || className.includes("required")
    })
  }

  const getAssociatedPromptMetadata = (element: Element) => {
    const block = element.closest(BLOCK_CONTAINER_SELECTOR)

    if (!(block instanceof HTMLElement)) {
      return {
        questionText: "",
        required: false
      }
    }

    let sibling: Element | null = block.previousElementSibling
    let hops = 0

    while (sibling && hops < 4) {
      const promptText = getPromptTextFromContainer(sibling)

      if (promptText && isPromptOnlyContainer(sibling)) {
        return {
          questionText: promptText,
          required: hasRequiredIndicator(sibling)
        }
      }

      if (hasInteractiveDescendants(sibling)) {
        break
      }

      sibling = sibling.previousElementSibling
      hops += 1
    }

    return {
      questionText: "",
      required: false
    }
  }

  const getTextByIdRefs = (refs: string | null) => {
    if (!refs) {
      return ""
    }

    const chunks = refs
      .split(/\s+/)
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")

    return uniqueJoin(chunks)
  }

  const getPreviousPromptText = (element: HTMLElement) => {
    const snippets: string[] = []
    let sibling: Element | null = element.previousElementSibling
    let hops = 0

    while (sibling && hops < 5 && snippets.length < 2) {
      if (!isPromptOnlyContainer(sibling)) {
        break
      }

      const siblingText = getPromptTextFromContainer(sibling)

      if (siblingText.length >= 4 && siblingText.length <= 220) {
        snippets.push(siblingText)
      }

      sibling = sibling.previousElementSibling
      hops += 1
    }

    return uniqueJoin(snippets)
  }

  const getNearbyPromptText = (element: HTMLElement) => {
    const snippets: string[] = []
    const selfText = normalize(element.innerText || element.textContent || "")
    let current: Element | null = element
    let hops = 0

    while (current && hops < 6 && snippets.length < 4) {
      const parent = current.parentElement

      if (!parent) {
        break
      }

      for (const sibling of Array.from(parent.children)) {
        if (sibling === current) {
          continue
        }

        if (!isPromptOnlyContainer(sibling)) {
          continue
        }

        const siblingText = getPromptTextFromContainer(sibling)

        if (siblingText.length < 4 || siblingText.length > 260) {
          continue
        }

        if (selfText && siblingText.toLowerCase() === selfText.toLowerCase()) {
          continue
        }

        snippets.push(siblingText)
      }

      current = parent
      hops += 1
    }

    return uniqueJoin(snippets, 260)
  }

  const nearestContext = (element: Element, associatedQuestionText = "") => {
    const htmlElement = element as HTMLElement
    const fromWrappingLabel = normalize(
      element.closest("label")?.textContent ?? ""
    )
    const fromFieldsetLegend = normalize(
      element.closest("fieldset")?.querySelector("legend")?.textContent ?? ""
    )
    const fromPrevSibling = getPreviousPromptText(htmlElement)
    const fromNearbyPrompt = getNearbyPromptText(htmlElement)
    const section = element.closest("section, form, main, article, dialog")
    const sectionHeading = normalize(
      section?.querySelector(PROMPT_HEADING_SELECTOR)?.textContent ?? ""
    )

    return uniqueJoin(
      associatedQuestionText
        ? [associatedQuestionText, fromWrappingLabel, fromFieldsetLegend]
        : [
            associatedQuestionText,
            fromWrappingLabel,
            fromFieldsetLegend,
            fromPrevSibling,
            fromNearbyPrompt,
            sectionHeading
          ],
      260
    )
  }

  const getQuestionText = (element: Element, associatedQuestionText = "") => {
    const htmlElement = element as HTMLElement
    const fromLabelledBy = getTextByIdRefs(
      htmlElement.getAttribute("aria-labelledby")
    )
    const fromDescribedBy = getTextByIdRefs(
      htmlElement.getAttribute("aria-describedby")
    )
    const fromFieldsetLegend = normalize(
      element.closest("fieldset")?.querySelector("legend")?.textContent ?? ""
    )
    const fromWrappingLabel = normalize(
      element.closest("label")?.textContent ?? ""
    )
    const fromPrevSibling = associatedQuestionText
      ? ""
      : getPreviousPromptText(htmlElement)
    const fromNearbyPrompt = associatedQuestionText
      ? ""
      : getNearbyPromptText(htmlElement)

    return uniqueJoin(
      [
        getLabel(element),
        fromLabelledBy,
        associatedQuestionText,
        fromFieldsetLegend,
        fromWrappingLabel,
        fromPrevSibling,
        fromNearbyPrompt,
        fromDescribedBy
      ],
      260
    )
  }

  const getDescribedByText = (element: Element) => {
    const htmlElement = element as HTMLElement
    return getTextByIdRefs(htmlElement.getAttribute("aria-describedby"))
  }

  const getRequired = (element: Element, associatedRequired = false) => {
    const htmlElement = element as HTMLElement

    if (
      htmlElement instanceof HTMLInputElement ||
      htmlElement instanceof HTMLTextAreaElement ||
      htmlElement instanceof HTMLSelectElement
    ) {
      return (
        htmlElement.required ||
        htmlElement.getAttribute("aria-required") === "true" ||
        associatedRequired
      )
    }

    return (
      htmlElement.getAttribute("aria-required") === "true" || associatedRequired
    )
  }

  const isEnabled = (element: Element) => {
    const htmlElement = element as HTMLElement & { disabled?: boolean }

    if (htmlElement.getAttribute("aria-disabled") === "true") {
      return false
    }

    if (typeof htmlElement.disabled === "boolean") {
      return !htmlElement.disabled
    }

    return true
  }

  const getForAttr = (element: Element) => {
    if (element instanceof HTMLLabelElement) {
      return normalize(element.htmlFor)
    }

    return normalize((element as HTMLElement).getAttribute("for") ?? "")
  }

  const getCheckedState = (element: Element): boolean | null => {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        return element.checked
      }

      return null
    }

    const htmlElement = element as HTMLElement

    if (htmlElement instanceof HTMLLabelElement && htmlElement.htmlFor) {
      const controlledElement = document.getElementById(htmlElement.htmlFor)

      if (
        controlledElement instanceof HTMLInputElement &&
        (controlledElement.type === "checkbox" ||
          controlledElement.type === "radio")
      ) {
        return controlledElement.checked
      }

      if (controlledElement instanceof HTMLElement) {
        const controlledAriaChecked =
          controlledElement.getAttribute("aria-checked")

        if (controlledAriaChecked === "true") {
          return true
        }

        if (controlledAriaChecked === "false") {
          return false
        }
      }
    }

    const ariaChecked = htmlElement.getAttribute("aria-checked")

    if (ariaChecked === "true") {
      return true
    }

    if (ariaChecked === "false") {
      return false
    }

    return null
  }

  const getMaxLength = (element: Element): number | null => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      return element.maxLength > 0 ? element.maxLength : null
    }

    return null
  }

  const resolveIframeSrc = (iframe: HTMLIFrameElement) => {
    const srcAttr = normalize(iframe.getAttribute("src") ?? "")

    if (srcAttr) {
      try {
        return new URL(srcAttr, window.location.href).href
      } catch {
        return srcAttr
      }
    }

    if (iframe.hasAttribute("srcdoc")) {
      return "about:srcdoc"
    }

    try {
      return normalize(iframe.src ?? "")
    } catch {
      return ""
    }
  }

  const canAccessIframeDocument = (iframe: HTMLIFrameElement) => {
    try {
      return iframe.contentDocument !== null
    } catch {
      return false
    }
  }

  const getFrameHost = (): RawFrameHost | null => {
    try {
      const host = window.frameElement

      if (
        !(host instanceof HTMLIFrameElement) &&
        !(host instanceof HTMLFrameElement)
      ) {
        return null
      }

      return {
        visible: isVisible(host),
        inViewport: inViewport(host)
      }
    } catch {
      return null
    }
  }

  const getMediaSummary = (): RawMediaSummary | null => {
    const mediaElements = Array.from(document.querySelectorAll("video, audio"))

    if (mediaElements.length === 0) {
      return null
    }

    const bestMedia = mediaElements
      .filter((element): element is HTMLMediaElement => {
        return element instanceof HTMLMediaElement
      })
      .sort((left, right) => {
        const score = (element: HTMLMediaElement) => {
          let value = 0

          if (!element.paused && !element.ended) {
            value += 10
          }

          if (inViewport(element)) {
            value += 4
          }

          if (isVisible(element)) {
            value += 2
          }

          if (element.currentTime > 0) {
            value += 1
          }

          const rect = element.getBoundingClientRect()
          return value + Math.round(rect.width * rect.height)
        }

        return score(right) - score(left)
      })[0]

    if (!bestMedia) {
      return null
    }

    const playbackState: MediaPlaybackState = bestMedia.ended
      ? "ended"
      : bestMedia.paused
        ? "paused"
        : "playing"
    const fallbackTitle = (() => {
      if (!bestMedia.currentSrc) {
        return ""
      }

      try {
        return new URL(bestMedia.currentSrc).pathname
      } catch {
        return bestMedia.currentSrc
      }
    })()

    return {
      kind: bestMedia instanceof HTMLVideoElement ? "video" : "audio",
      playbackState,
      currentTime: Number.isFinite(bestMedia.currentTime)
        ? Number(bestMedia.currentTime.toFixed(1))
        : null,
      duration: Number.isFinite(bestMedia.duration)
        ? Number(bestMedia.duration.toFixed(1))
        : null,
      muted: bestMedia.muted,
      visible: isVisible(bestMedia),
      inViewport: inViewport(bestMedia),
      title: normalize(
        bestMedia.getAttribute("title") ||
          bestMedia.getAttribute("aria-label") ||
          fallbackTitle
      )
    }
  }

  const query = [
    "button",
    "a[href]",
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "label[for]",
    "[role='combobox']",
    "[role='button']",
    "[role='link']",
    "[role='checkbox']",
    "[role='radio']",
    "[aria-checked]",
    "[contenteditable='true']"
  ].join(",")

  const unique = new Set<Element>()
  const rawCandidates: RawCandidate[] = []
  const customSelectControls: Array<{
    element: Element
    candidate: RawCandidate
  }> = []

  for (const element of Array.from(document.querySelectorAll(query))) {
    if (unique.has(element)) {
      continue
    }

    unique.add(element)

    const htmlElement = element as HTMLElement
    const rect = element.getBoundingClientRect()
    const associatedPromptMetadata = getAssociatedPromptMetadata(element)

    const text = normalize(
      htmlElement.innerText || htmlElement.textContent || ""
    )
    const label = getLabel(element) || associatedPromptMetadata.questionText
    const questionText = getQuestionText(
      element,
      associatedPromptMetadata.questionText
    )
    const describedBy = getDescribedByText(element)
    const placeholder = normalize(
      (htmlElement as HTMLInputElement | HTMLTextAreaElement).placeholder ?? ""
    )
    const valuePreview = normalize(
      (htmlElement as HTMLInputElement | HTMLTextAreaElement).value ?? ""
    ).slice(0, 120)
    const inputType =
      htmlElement instanceof HTMLInputElement
        ? htmlElement.type || "text"
        : null
    const controlKind = getControlKind(element, inputType)
    const canTypeText = allowsTextEntry(element, inputType, controlKind)
    const selector = createSelector(element)
    const dropdownRoot =
      controlKind === "custom_select"
        ? (getDropdownRoot(element) ?? htmlElement)
        : null

    const candidate: RawCandidate = {
      controlKind,
      allowsTextEntry: canTypeText,
      popupState: getPopupState(element, controlKind),
      optionSource: null,
      tagName: element.tagName.toLowerCase(),
      role: htmlElement.getAttribute("role"),
      inputType,
      forAttr: getForAttr(element),
      text,
      label,
      placeholder,
      href: (htmlElement as HTMLAnchorElement).href ?? "",
      valuePreview,
      questionText,
      describedBy,
      nameAttr: normalize(htmlElement.getAttribute("name") ?? ""),
      idAttr: normalize(htmlElement.id ?? ""),
      autocomplete: normalize(htmlElement.getAttribute("autocomplete") ?? ""),
      required: getRequired(element, associatedPromptMetadata.required),
      checked: getCheckedState(element),
      maxLength: getMaxLength(element),
      selector,
      interactionSelector: dropdownRoot
        ? createSelector(dropdownRoot)
        : selector,
      ownerControlSelector: "",
      popupContainerSelector: "",
      context: nearestContext(element, associatedPromptMetadata.questionText),
      visible: isVisible(element),
      enabled: isEnabled(element),
      inViewport: inViewport(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    }

    rawCandidates.push(candidate)

    if (candidate.controlKind === "custom_select") {
      customSelectControls.push({
        element,
        candidate
      })
    }
  }

  const rawCandidateById = new Map(
    rawCandidates
      .filter((candidate) => candidate.idAttr.length > 0)
      .map((candidate) => [candidate.idAttr, candidate] as const)
  )

  const isChoiceOptionToken = (value: string) => {
    return /^(yes|no|true|false|on|off)$/i.test(value)
  }

  const getChoiceGroupKey = (candidate: RawCandidate) => {
    const directChoiceCandidate =
      candidate.inputType === "radio" || candidate.inputType === "checkbox"
        ? candidate
        : candidate.forAttr
          ? rawCandidateById.get(candidate.forAttr)
          : undefined

    if (!directChoiceCandidate) {
      return ""
    }

    if (
      directChoiceCandidate.inputType !== "radio" &&
      directChoiceCandidate.inputType !== "checkbox"
    ) {
      return ""
    }

    if (
      directChoiceCandidate.nameAttr.length === 0 &&
      directChoiceCandidate.idAttr.length === 0
    ) {
      return ""
    }

    return `${directChoiceCandidate.inputType}|${directChoiceCandidate.nameAttr || directChoiceCandidate.idAttr}`
  }

  const extractChoiceGroupQuestion = (candidate: RawCandidate) => {
    const optionLabel = normalize(candidate.label || candidate.text)
    const sources = [
      candidate.describedBy,
      candidate.questionText,
      candidate.context
    ]

    for (const source of sources) {
      const parts = source
        .split("|")
        .map((value) => normalize(value))
        .filter((value) => value.length >= 4 && value.length <= 180)

      for (const part of parts) {
        if (
          part.toLowerCase() === optionLabel.toLowerCase() ||
          isChoiceOptionToken(part)
        ) {
          continue
        }

        return part
      }
    }

    return ""
  }

  const choiceGroups = new Map<string, RawCandidate[]>()

  for (const candidate of rawCandidates) {
    const groupKey = getChoiceGroupKey(candidate)

    if (!groupKey) {
      continue
    }

    const group = choiceGroups.get(groupKey)

    if (group) {
      group.push(candidate)
    } else {
      choiceGroups.set(groupKey, [candidate])
    }
  }

  for (const group of choiceGroups.values()) {
    const groupQuestion =
      group.map(extractChoiceGroupQuestion).find(Boolean) ?? ""
    const groupRequired = group.some((candidate) => candidate.required)

    for (const candidate of group) {
      const optionLabel = normalize(candidate.label || candidate.text)

      candidate.required = candidate.required || groupRequired

      if (!groupQuestion) {
        continue
      }

      candidate.questionText = optionLabel
        ? uniqueJoin([optionLabel, groupQuestion], 260)
        : groupQuestion
      candidate.context = uniqueJoin([groupQuestion, optionLabel], 320)

      if (!candidate.describedBy) {
        candidate.describedBy = groupQuestion
      }
    }
  }

  const popupContainerByControl = new Map<
    Element,
    { popupContainer: HTMLElement; candidate: RawCandidate }
  >()
  const bestAssociationByPopup = new Map<
    HTMLElement,
    { controlElement: Element; candidate: RawCandidate; score: number }
  >()

  const getPopupMatchForControl = (element: Element) => {
    const controlledPopup = getControlledPopupElements(element).find(
      (popup) => {
        return (
          isVisible(popup) &&
          (popup.querySelector(OPTION_ROLE_SELECTOR) !== null ||
            getGenericPopupItems(popup).length >= 2)
        )
      }
    )

    if (controlledPopup) {
      return {
        popupContainer: controlledPopup,
        score: -1000
      }
    }

    const popupContainer = findPopupContainerForControl(element)

    if (!popupContainer) {
      return null
    }

    const dropdownRoot = getDropdownRoot(element) ?? element
    const dropdownRect = dropdownRoot.getBoundingClientRect()
    const popupRect = popupContainer.getBoundingClientRect()
    const horizontalGap = Math.max(
      0,
      Math.max(
        dropdownRect.left - popupRect.right,
        popupRect.left - dropdownRect.right
      )
    )
    const verticalGap = Math.max(
      0,
      Math.max(
        dropdownRect.top - popupRect.bottom,
        popupRect.top - dropdownRect.bottom
      )
    )
    const overlapsHorizontally =
      popupRect.left <= dropdownRect.right + 48 &&
      popupRect.right >= dropdownRect.left - 48
    const itemCount =
      popupContainer.querySelectorAll(OPTION_ROLE_SELECTOR).length +
      getGenericPopupItems(popupContainer).length
    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const activeBoost =
      activeElement &&
      (dropdownRoot.contains(activeElement) ||
        popupContainer.contains(activeElement))
        ? -120
        : 0

    return {
      popupContainer,
      score:
        horizontalGap +
        verticalGap +
        (overlapsHorizontally ? -40 : 0) +
        (hasPopupClassHint(popupContainer) ? -30 : 0) +
        activeBoost -
        itemCount * 12
    }
  }

  for (const control of customSelectControls) {
    const popupMatch = getPopupMatchForControl(control.element)

    if (!popupMatch) {
      continue
    }

    const existingAssociation = bestAssociationByPopup.get(
      popupMatch.popupContainer
    )

    if (!existingAssociation || popupMatch.score < existingAssociation.score) {
      bestAssociationByPopup.set(popupMatch.popupContainer, {
        controlElement: control.element,
        candidate: control.candidate,
        score: popupMatch.score
      })
    }
  }

  for (const [popupContainer, association] of bestAssociationByPopup) {
    association.candidate.popupState = "open"
    association.candidate.popupContainerSelector =
      createSelector(popupContainer)
    popupContainerByControl.set(association.controlElement, {
      popupContainer,
      candidate: association.candidate
    })
  }

  const getOptionPopupContainer = (option: Element) => {
    return (
      option.closest(OPTION_CONTAINER_SELECTOR) ??
      option.closest(GENERIC_POPUP_CONTAINER_SELECTOR)
    )
  }

  const resolveSelectControlForOption = (option: Element) => {
    const popupContainer = getOptionPopupContainer(option)

    if (popupContainer) {
      for (const [
        controlElement,
        popupAssociation
      ] of popupContainerByControl) {
        if (popupAssociation.popupContainer === popupContainer) {
          return {
            element: controlElement,
            candidate: popupAssociation.candidate
          }
        }
      }
    }

    const controlledPopupIds =
      popupContainer instanceof HTMLElement && popupContainer.id
        ? [popupContainer.id]
        : []

    const matchesControlledPopup = customSelectControls.find(({ element }) => {
      const refs = [
        (element as HTMLElement).getAttribute("aria-controls"),
        (element as HTMLElement).getAttribute("aria-owns"),
        getDropdownRoot(element)?.getAttribute("aria-controls"),
        getDropdownRoot(element)?.getAttribute("aria-owns")
      ]

      return refs.some((refGroup) => {
        if (!refGroup) {
          return false
        }

        const ids = refGroup.split(/\s+/).map((value) => value.trim())
        return ids.some((id) => controlledPopupIds.includes(id))
      })
    })

    if (matchesControlledPopup) {
      return matchesControlledPopup
    }

    const activeElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    if (activeElement) {
      const activeControl = customSelectControls.find(({ element }) => {
        return (
          element === activeElement ||
          element.contains(activeElement) ||
          activeElement.contains(element) ||
          getDropdownRoot(element) === getDropdownRoot(activeElement)
        )
      })

      if (activeControl) {
        return activeControl
      }
    }

    const openControls = customSelectControls.filter(
      ({ candidate }) => candidate.popupState === "open" && candidate.visible
    )

    if (openControls.length === 1) {
      return openControls[0]
    }

    const visibleControls = customSelectControls.filter(
      ({ candidate }) => candidate.visible
    )

    if (visibleControls.length === 0) {
      return null
    }

    const optionRect = option.getBoundingClientRect()

    return visibleControls.reduce((best, current) => {
      const bestRect = best.element.getBoundingClientRect()
      const currentRect = current.element.getBoundingClientRect()
      const bestDistance =
        Math.abs(bestRect.top - optionRect.top) +
        Math.abs(bestRect.left - optionRect.left)
      const currentDistance =
        Math.abs(currentRect.top - optionRect.top) +
        Math.abs(currentRect.left - optionRect.left)

      return currentDistance < bestDistance ? current : best
    })
  }

  for (const option of Array.from(
    document.querySelectorAll(OPTION_ROLE_SELECTOR)
  )) {
    if (unique.has(option) || !isVisible(option)) {
      continue
    }

    const optionElement = option as HTMLElement
    const optionText = getOptionText(option)

    if (!optionText || optionText.length > 120) {
      continue
    }

    const control = resolveSelectControlForOption(option)
    const popupContainer = getOptionPopupContainer(option)
    const rect = option.getBoundingClientRect()
    const ownerQuestionText = normalize(
      control?.candidate.label || control?.candidate.questionText || ""
    )

    unique.add(option)
    rawCandidates.push({
      controlKind: "select_option",
      allowsTextEntry: false,
      popupState: "open",
      optionSource: "aria_role",
      tagName: option.tagName.toLowerCase(),
      role: optionElement.getAttribute("role"),
      inputType: null,
      forAttr: "",
      text: optionText,
      label: ownerQuestionText,
      placeholder: "",
      href: (optionElement as HTMLAnchorElement).href ?? "",
      valuePreview: "",
      questionText: ownerQuestionText,
      describedBy: "",
      nameAttr: normalize(optionElement.getAttribute("name") ?? ""),
      idAttr: normalize(optionElement.id ?? ""),
      autocomplete: "",
      required: control?.candidate.required ?? false,
      checked: getCheckedState(option),
      maxLength: null,
      selector: createSelector(option),
      interactionSelector: createSelector(option),
      ownerControlSelector: control?.candidate.interactionSelector ?? "",
      popupContainerSelector:
        popupContainer instanceof HTMLElement
          ? createSelector(popupContainer)
          : "",
      context: uniqueJoin(
        [
          ownerQuestionText
            ? `Option for: ${ownerQuestionText}`
            : "Dropdown option",
          control?.candidate.context ?? ""
        ],
        320
      ),
      visible: true,
      enabled: isEnabled(option),
      inViewport: inViewport(option),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    })
  }

  for (const popupAssociation of popupContainerByControl.values()) {
    for (const option of getGenericPopupItems(
      popupAssociation.popupContainer
    )) {
      if (unique.has(option)) {
        continue
      }

      const optionText = getOptionText(option)

      if (!optionText || optionText.length > 120) {
        continue
      }

      const rect = option.getBoundingClientRect()
      const ownerQuestionText = normalize(
        popupAssociation.candidate.label ||
          popupAssociation.candidate.questionText ||
          ""
      )

      unique.add(option)
      rawCandidates.push({
        controlKind: "select_option",
        allowsTextEntry: false,
        popupState: "open",
        optionSource: "generic_popup",
        tagName: option.tagName.toLowerCase(),
        role: option.getAttribute("role"),
        inputType: null,
        forAttr: "",
        text: optionText,
        label: ownerQuestionText,
        placeholder: "",
        href: (option as HTMLAnchorElement).href ?? "",
        valuePreview: "",
        questionText: ownerQuestionText,
        describedBy: "",
        nameAttr: normalize(option.getAttribute("name") ?? ""),
        idAttr: normalize(option.id ?? ""),
        autocomplete: "",
        required: popupAssociation.candidate.required,
        checked: getCheckedState(option),
        maxLength: null,
        selector: createSelector(option),
        interactionSelector: createSelector(option),
        ownerControlSelector: popupAssociation.candidate.interactionSelector,
        popupContainerSelector: createSelector(popupAssociation.popupContainer),
        context: uniqueJoin(
          [
            ownerQuestionText
              ? `Option for: ${ownerQuestionText}`
              : "Dropdown option",
            popupAssociation.candidate.context
          ],
          320
        ),
        visible: true,
        enabled: isEnabled(option),
        inViewport: inViewport(option),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      })
    }
  }

  const visibleTextPreview = Array.from(
    document.querySelectorAll("h1, h2, h3, p, li, [role='heading']")
  )
    .map((item) => normalize(item.textContent ?? ""))
    .filter((value) => value.length >= 8)
    .slice(0, 16)

  const rawIframes: RawIframe[] = Array.from(
    document.querySelectorAll("iframe")
  ).map((iframe) => {
    const rect = iframe.getBoundingClientRect()

    return {
      src: resolveIframeSrc(iframe),
      title: normalize(iframe.getAttribute("title") ?? ""),
      nameAttr: normalize(iframe.getAttribute("name") ?? ""),
      idAttr: normalize(iframe.id ?? ""),
      visible: isVisible(iframe),
      inViewport: inViewport(iframe),
      contentDocumentAccessible: canAccessIframeDocument(iframe),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    }
  })

  return {
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    frameHost: getFrameHost(),
    iframes: rawIframes,
    media: getMediaSummary(),
    visibleTextPreview,
    elements: rawCandidates
  } satisfies FrameLocalSnapshot
}

const MAX_VISIBLE_TEXT_PREVIEW_ITEMS = 24

const normalizeMediaSummary = (
  snapshot: PageSnapshot,
  session?: RunSession
): PageSnapshot => {
  const media = snapshot.media

  if (!media) {
    if (session) {
      session.lastMediaObservation = null
    }

    return snapshot
  }

  const previousObservation = session?.lastMediaObservation
  const progressing =
    previousObservation?.url === snapshot.url &&
    previousObservation.currentTime !== null &&
    media.currentTime !== null &&
    media.currentTime > previousObservation.currentTime + 0.4

  const normalizedSnapshot: PageSnapshot = {
    ...snapshot,
    media: {
      ...media,
      progressing: progressing || media.playbackState === "playing"
    }
  }

  if (session) {
    session.lastMediaObservation = {
      url: snapshot.url,
      currentTime: media.currentTime,
      playbackState: media.playbackState
    }
  }

  return normalizedSnapshot
}

const mergeFrameSnapshots = (
  frameResults: chrome.scripting.InjectionResult<FrameLocalSnapshot>[]
): PageSnapshot => {
  if (frameResults.length === 0) {
    throw new Error("Unable to collect page snapshot")
  }

  const sortedFrameResults = [...frameResults].sort(
    (left, right) => left.frameId - right.frameId
  )
  const mainFrameResult =
    sortedFrameResults.find((item) => item.frameId === 0) ??
    sortedFrameResults[0]
  const iframePreview: PageSnapshot["iframes"] = []
  const iframeKeys = new Set<string>()
  const visibleTextPreview: string[] = []
  const visibleTextKeys = new Set<string>()
  const mergedElements: ElementCandidate[] = []
  const mergedMedia =
    sortedFrameResults
      .map((item) => item.result.media)
      .filter((item): item is RawMediaSummary => item !== null)
      .sort((left, right) => {
        const score = (media: RawMediaSummary) => {
          let value = 0

          if (media.playbackState === "playing") {
            value += 10
          }

          if (media.inViewport) {
            value += 4
          }

          if (media.visible) {
            value += 2
          }

          if ((media.currentTime ?? 0) > 0) {
            value += 1
          }

          return value
        }

        return score(right) - score(left)
      })[0] ?? null

  const pushVisibleText = (value: string) => {
    const normalized = normalizeText(value)

    if (!normalized) {
      return
    }

    const key = normalized.toLowerCase()

    if (visibleTextKeys.has(key)) {
      return
    }

    visibleTextKeys.add(key)
    visibleTextPreview.push(normalized)
  }

  const pushIframe = (iframe: RawIframe) => {
    const key = [
      iframe.src,
      iframe.title,
      iframe.nameAttr,
      iframe.idAttr,
      iframe.rect.x,
      iframe.rect.y,
      iframe.rect.width,
      iframe.rect.height
    ].join("|")

    if (iframeKeys.has(key)) {
      return
    }

    iframeKeys.add(key)
    iframePreview.push(iframe)
  }

  for (const frameResult of sortedFrameResults) {
    frameResult.result.visibleTextPreview.forEach(pushVisibleText)
    frameResult.result.iframes.forEach(pushIframe)

    const frameVisible = frameResult.result.frameHost?.visible ?? true
    const frameInViewport = frameResult.result.frameHost?.inViewport ?? true

    for (const candidate of frameResult.result.elements) {
      const contextParts = [candidate.context]

      if (frameResult.frameId !== 0) {
        if (frameResult.result.title) {
          contextParts.push(`Frame: ${frameResult.result.title}`)
        }

        if (frameResult.result.url) {
          contextParts.push(`Frame URL: ${frameResult.result.url}`)
        }
      }

      const mergedContext = Array.from(
        new Set(
          contextParts.map((value) => normalizeText(value)).filter(Boolean)
        )
      )
        .join(" | ")
        .slice(0, 320)

      mergedElements.push({
        eid: "",
        frameId: frameResult.frameId,
        frameUrl: frameResult.result.url,
        frameTitle: frameResult.result.title,
        ...candidate,
        context: mergedContext,
        visible: candidate.visible && frameVisible,
        inViewport: candidate.inViewport && frameInViewport
      })
    }
  }

  const capturedSubframeCount = sortedFrameResults.filter(
    (item) => item.frameId !== 0
  ).length
  const visibleIframeCount = iframePreview.filter(
    (iframe) => iframe.visible
  ).length
  const inViewportIframeCount = iframePreview.filter(
    (iframe) => iframe.inViewport
  ).length
  const accessibleIframeCount = iframePreview.filter(
    (iframe) => iframe.contentDocumentAccessible
  ).length
  const likelyMissedIframeContent =
    visibleIframeCount > capturedSubframeCount ||
    inViewportIframeCount > capturedSubframeCount

  return {
    url: mainFrameResult.result.url,
    title: mainFrameResult.result.title,
    timestamp: mainFrameResult.result.timestamp,
    viewport: mainFrameResult.result.viewport,
    frameCapture: {
      strategy: "all_frames",
      capturedFrameCount: sortedFrameResults.length,
      capturedSubframeCount,
      discoveredIframeCount: iframePreview.length,
      visibleIframeCount,
      inViewportIframeCount,
      accessibleIframeCount,
      likelyMissedIframeContent
    },
    iframes: iframePreview,
    media: mergedMedia
      ? {
          ...mergedMedia,
          progressing: false
        }
      : null,
    visibleTextPreview: visibleTextPreview.slice(
      0,
      MAX_VISIBLE_TEXT_PREVIEW_ITEMS
    ),
    elements: mergedElements.map((candidate, index) => ({
      ...candidate,
      eid: `e${index + 1}`
    }))
  }
}

type DomTarget = {
  frameId: number
  selector: string
  interactionSelector: string
  ownerControlSelector: string
  popupContainerSelector: string
  text: string
  label: string
  tagName: string
  controlKind: ElementCandidate["controlKind"]
  allowsTextEntry: ElementCandidate["allowsTextEntry"]
  optionSource: ElementCandidate["optionSource"]
}

type DomActionPayload =
  | {
      kind: "click"
      target: DomTarget
    }
  | {
      kind: "type_text"
      target: DomTarget
      text: string
      clearFirst: boolean
    }
  | {
      kind: "extract_text"
      target: DomTarget
    }
  | {
      kind: "press_key"
      key: string
      target?: DomTarget
    }
  | {
      kind: "scroll"
      direction: "up" | "down"
      amount: number
    }

type DomActionResult = {
  ok: boolean
  details: string
  text?: string
  trace?: AgentExecutionTrace
}

const runDomActionInPage = async (
  payload: DomActionPayload
): Promise<DomActionResult> => {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim()
  const domDelay = (ms: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, ms))
  const isVisibleElement = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    )
  }

  const toCssAttributeValue = (value: string) => {
    if (window.CSS?.escape) {
      return window.CSS.escape(value)
    }

    return value.replace(/(["\\])/g, "\\$1")
  }

  const hasClickableAncestorHint = (element: HTMLElement) => {
    if (
      typeof element.onclick === "function" ||
      element.hasAttribute("onclick")
    ) {
      return true
    }

    const role = element.getAttribute("role")

    if (role === "button" || role === "checkbox" || role === "radio") {
      return true
    }

    const tagName = element.tagName.toLowerCase()

    if (tagName === "button" || tagName === "a" || tagName === "label") {
      return true
    }

    return (
      typeof element.className === "string" &&
      element.className.toLowerCase().includes("cursor-pointer")
    )
  }

  const findVisibleClickableAncestor = (start: HTMLElement) => {
    let current: HTMLElement | null = start
    let hops = 0

    while (current && hops < 6) {
      const parent = current.parentElement

      if (!parent) {
        return null
      }

      if (hasClickableAncestorHint(parent) && isVisibleElement(parent)) {
        return parent
      }

      current = parent
      hops += 1
    }

    return null
  }

  const resolveVisibleClickTarget = (element: HTMLElement) => {
    if (isVisibleElement(element)) {
      return {
        element,
        strategy: "visible_target"
      }
    }

    if (
      element instanceof HTMLInputElement &&
      (element.type === "checkbox" || element.type === "radio")
    ) {
      const labels = element.labels ? Array.from(element.labels) : []

      for (const label of labels) {
        if (isVisibleElement(label)) {
          return {
            element: label,
            strategy: "input_label"
          }
        }
      }

      if (element.id) {
        const labelByFor = document.querySelector(
          `label[for="${toCssAttributeValue(element.id)}"]`
        )

        if (labelByFor instanceof HTMLElement && isVisibleElement(labelByFor)) {
          return {
            element: labelByFor,
            strategy: "label_for_target"
          }
        }
      }
    }

    if (element instanceof HTMLLabelElement && element.htmlFor) {
      const controlledElement = document.getElementById(element.htmlFor)

      if (
        controlledElement instanceof HTMLElement &&
        isVisibleElement(controlledElement)
      ) {
        return {
          element: controlledElement,
          strategy: "label_controlled_element"
        }
      }

      const controlAncestor = controlledElement?.closest(
        "[role='radio'], [role='checkbox'], [role='button'], button, a[href], label"
      )

      if (
        controlAncestor instanceof HTMLElement &&
        isVisibleElement(controlAncestor)
      ) {
        return {
          element: controlAncestor,
          strategy: "controlled_element_ancestor"
        }
      }
    }

    const wrappingLabel = element.closest("label")

    if (
      wrappingLabel instanceof HTMLElement &&
      isVisibleElement(wrappingLabel)
    ) {
      return {
        element: wrappingLabel,
        strategy: "wrapping_label"
      }
    }

    const clickableAncestor = findVisibleClickableAncestor(element)

    if (clickableAncestor) {
      return {
        element: clickableAncestor,
        strategy: "clickable_ancestor"
      }
    }

    return null
  }

  const dispatchPointerClick = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0
    }

    if (typeof window.PointerEvent === "function") {
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...eventInit,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 1
        })
      )
    }

    element.dispatchEvent(
      new MouseEvent("mousedown", {
        ...eventInit,
        buttons: 1
      })
    )
    element.focus()
    if (typeof window.PointerEvent === "function") {
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          ...eventInit,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 0
        })
      )
    }
    element.dispatchEvent(
      new MouseEvent("mouseup", {
        ...eventInit,
        buttons: 0
      })
    )
    element.dispatchEvent(
      new MouseEvent("click", {
        ...eventInit,
        buttons: 0
      })
    )
  }

  const dispatchKeyboardKey = (element: HTMLElement, key: string) => {
    const eventInit = {
      key,
      bubbles: true,
      cancelable: true
    }

    element.dispatchEvent(new KeyboardEvent("keydown", eventInit))
    element.dispatchEvent(new KeyboardEvent("keypress", eventInit))
    element.dispatchEvent(new KeyboardEvent("keyup", eventInit))
  }

  const POPUP_CONTAINER_SELECTOR = [
    ".tally-context-menu",
    "[class*='context-menu']",
    "[class*='contextmenu']",
    "[class*='dropdown-menu']",
    "[role='listbox']",
    "[role='menu']"
  ].join(",")
  const POPUP_OPTION_SELECTOR = [
    "[role='option']",
    "[role='menuitem']",
    "[role='menuitemradio']",
    "[role='menuitemcheckbox']",
    "[class*='list-item']",
    "li",
    "button",
    "a[href]"
  ].join(",")

  const getPopupOptionLabels = (container: HTMLElement) => {
    return Array.from(container.querySelectorAll(POPUP_OPTION_SELECTOR))
      .filter((item): item is HTMLElement => item instanceof HTMLElement)
      .filter((item) => isVisibleElement(item))
      .map((item) => {
        return normalize(
          item.getAttribute("title") ||
            item.innerText ||
            item.textContent ||
            item.getAttribute("aria-label") ||
            ""
        )
      })
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 12)
  }

  const getPopupCandidates = (anchor: HTMLElement) => {
    const anchorRect = anchor.getBoundingClientRect()

    return Array.from(document.querySelectorAll(POPUP_CONTAINER_SELECTOR))
      .filter((item): item is HTMLElement => item instanceof HTMLElement)
      .filter((item) => isVisibleElement(item))
      .map((popup) => {
        const rect = popup.getBoundingClientRect()
        const horizontalGap = Math.max(
          0,
          Math.max(anchorRect.left - rect.right, rect.left - anchorRect.right)
        )
        const verticalGap = Math.max(
          0,
          Math.max(anchorRect.top - rect.bottom, rect.top - anchorRect.bottom)
        )
        const optionLabels = getPopupOptionLabels(popup)

        return {
          popup,
          optionLabels,
          score:
            horizontalGap +
            verticalGap -
            optionLabels.length * 12 -
            (popup.className.includes("tally-context-menu") ? 40 : 0)
        }
      })
      .filter((item) => item.optionLabels.length > 0)
      .sort((left, right) => left.score - right.score)
  }

  const findPopupOptionElement = (
    anchor: HTMLElement,
    expectedText: string
  ) => {
    const expected = normalize(expectedText).toLowerCase()

    if (!expected) {
      return null
    }

    for (const popupCandidate of getPopupCandidates(anchor)) {
      const optionElements = Array.from(
        popupCandidate.popup.querySelectorAll(POPUP_OPTION_SELECTOR)
      ).filter((item): item is HTMLElement => item instanceof HTMLElement)

      for (const optionElement of optionElements) {
        if (!isVisibleElement(optionElement)) {
          continue
        }

        const optionText = normalize(
          optionElement.getAttribute("title") ||
            optionElement.innerText ||
            optionElement.textContent ||
            optionElement.getAttribute("aria-label") ||
            ""
        ).toLowerCase()

        if (optionText.includes(expected)) {
          return optionElement.closest("[class*='list-item']") instanceof
            HTMLElement
            ? (optionElement.closest("[class*='list-item']") as HTMLElement)
            : optionElement
        }
      }
    }

    return null
  }

  const probePopupState = (anchor: HTMLElement): AgentExecutionPopupSummary => {
    const popupCandidates = getPopupCandidates(anchor)
    const popup = popupCandidates[0]

    if (!popup) {
      return {
        popupState: "unknown",
        relatedOptionCount: 0,
        optionLabels: []
      }
    }

    return {
      popupState: "open",
      relatedOptionCount: popup.optionLabels.length,
      optionLabels: popup.optionLabels
    }
  }

  const waitForPopupState = async (
    anchor: HTMLElement,
    settleMs = 120,
    attempts = 3
  ) => {
    let popup = probePopupState(anchor)

    if (popup.popupState === "open" || popup.relatedOptionCount > 0) {
      return popup
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await domDelay(settleMs)
      popup = probePopupState(anchor)

      if (popup.popupState === "open" || popup.relatedOptionCount > 0) {
        return popup
      }
    }

    return popup
  }

  const recoverStaleSelectOptionTarget = async (
    target: DomTarget,
    trace: AgentExecutionTrace
  ) => {
    if (!target.ownerControlSelector) {
      return null
    }

    const ownerControl = document.querySelector(target.ownerControlSelector)

    if (!(ownerControl instanceof HTMLElement)) {
      return null
    }

    const resolvedOwner =
      ownerControl.querySelector(
        "input, textarea, select, [role='combobox']"
      ) instanceof HTMLElement
        ? (ownerControl.querySelector(
            "input, textarea, select, [role='combobox']"
          ) as HTMLElement)
        : ownerControl

    const openResult = await tryOpenCustomSelect({
      resolvedElement: resolvedOwner,
      interactionElement: ownerControl,
      trace
    })
    const optionElement = findPopupOptionElement(
      openResult.clickTarget,
      target.text
    )

    if (!optionElement) {
      return null
    }

    dispatchPointerClick(optionElement)

    return {
      optionElement,
      popup: await waitForPopupState(optionElement, 100, 2)
    }
  }

  const tryOpenCustomSelect = async (params: {
    resolvedElement: HTMLElement
    interactionElement: HTMLElement
    trace: AgentExecutionTrace
  }) => {
    const attempts: Array<{
      name: string
      element: HTMLElement
      run: () => void
    }> = []

    attempts.push({
      name: "wrapper_pointer_click",
      element: params.interactionElement,
      run: () => {
        params.interactionElement.focus()
        dispatchPointerClick(params.interactionElement)
      }
    })

    if (params.resolvedElement !== params.interactionElement) {
      attempts.push({
        name: "resolved_pointer_click",
        element: params.resolvedElement,
        run: () => {
          params.resolvedElement.focus()
          dispatchPointerClick(params.resolvedElement)
        }
      })
    }

    if (params.resolvedElement instanceof HTMLInputElement) {
      attempts.push({
        name: "resolved_arrowdown",
        element: params.resolvedElement,
        run: () => {
          params.resolvedElement.focus()
          dispatchKeyboardKey(params.resolvedElement, "ArrowDown")
        }
      })
      attempts.push({
        name: "resolved_space",
        element: params.resolvedElement,
        run: () => {
          params.resolvedElement.focus()
          dispatchKeyboardKey(params.resolvedElement, " ")
        }
      })
      attempts.push({
        name: "resolved_enter",
        element: params.resolvedElement,
        run: () => {
          params.resolvedElement.focus()
          dispatchKeyboardKey(params.resolvedElement, "Enter")
        }
      })
    }

    for (const attempt of attempts) {
      params.trace.resolutionStrategy.push(`custom_select:${attempt.name}`)
      attempt.run()

      const popup = await waitForPopupState(attempt.element)

      if (popup.popupState === "open") {
        return {
          clickTarget: attempt.element,
          popup
        }
      }
    }

    return {
      clickTarget: params.interactionElement,
      popup: await waitForPopupState(params.interactionElement)
    }
  }

  const toElementSelector = (element: HTMLElement) => {
    if (element.id) {
      return `#${toCssAttributeValue(element.id)}`
    }

    const tagName = element.tagName.toLowerCase()
    const dataBlockId = element.getAttribute("data-block-id")

    if (dataBlockId) {
      return `${tagName}[data-block-id="${toCssAttributeValue(dataBlockId)}"]`
    }

    const className =
      typeof element.className === "string"
        ? element.className
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean)
            .slice(0, 3)
        : []

    if (className.length > 0) {
      return `${tagName}.${className.map(toCssAttributeValue).join(".")}`
    }

    return tagName
  }

  const describeElement = (
    element: HTMLElement | null | undefined
  ): AgentExecutionNodeSummary | undefined => {
    if (!element) {
      return undefined
    }

    const rect = element.getBoundingClientRect()
    const valuePreview =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? normalize(String(element.value ?? "")).slice(0, 120)
        : ""

    return {
      selector: toElementSelector(element),
      tagName: element.tagName.toLowerCase(),
      idAttr: element.id,
      className:
        typeof element.className === "string"
          ? element.className.slice(0, 240)
          : "",
      role: element.getAttribute("role"),
      text: normalize(element.innerText || element.textContent || "").slice(
        0,
        180
      ),
      title: normalize(element.getAttribute("title") ?? "").slice(0, 180),
      ariaLabel: normalize(element.getAttribute("aria-label") ?? "").slice(
        0,
        180
      ),
      valuePreview,
      visible: isVisibleElement(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    }
  }

  const resolveElement = (target: DomTarget) => {
    const queryRoots: Array<Document | Element> = [document]

    if (target.popupContainerSelector) {
      const popupContainer = document.querySelector(
        target.popupContainerSelector
      )

      if (popupContainer) {
        queryRoots.unshift(popupContainer)
      }
    }

    if (target.ownerControlSelector) {
      const ownerControl = document.querySelector(target.ownerControlSelector)

      if (ownerControl) {
        queryRoots.unshift(ownerControl)
      }
    }

    const seenRoots = new Set<Document | Element>()
    const uniqueRoots = queryRoots.filter((root) => {
      if (seenRoots.has(root)) {
        return false
      }

      seenRoots.add(root)
      return true
    })

    const exact = uniqueRoots
      .map((root) => root.querySelector(target.selector))
      .find((value): value is Element => value instanceof Element)

    if (exact instanceof HTMLElement && isVisibleElement(exact)) {
      return {
        element: exact,
        resolutionStrategy: ["exact_selector_visible"]
      }
    }

    const options = uniqueRoots.flatMap((root) => {
      return Array.from(root.querySelectorAll(target.tagName)).filter(
        (option): option is HTMLElement => option instanceof HTMLElement
      )
    })
    const expectedText = normalize(target.text).toLowerCase()
    const expectedLabel = normalize(target.label).toLowerCase()

    const findMatch = (visibleOnly: boolean) => {
      for (const option of options) {
        if (visibleOnly && !isVisibleElement(option)) {
          continue
        }

        const optionText = normalize(
          option.innerText || option.textContent || ""
        ).toLowerCase()

        if (expectedText && optionText.includes(expectedText)) {
          return option
        }

        const optionTitle = normalize(
          option.getAttribute("title") ?? ""
        ).toLowerCase()

        if (expectedText && optionTitle.includes(expectedText)) {
          return option
        }

        const aria = normalize(
          option.getAttribute("aria-label") ?? ""
        ).toLowerCase()

        if (expectedLabel && aria.includes(expectedLabel)) {
          return option
        }
      }

      return null
    }

    const visibleMatch = findMatch(true)

    if (visibleMatch) {
      return {
        element: visibleMatch,
        resolutionStrategy: [
          exact instanceof HTMLElement
            ? "exact_selector_hidden"
            : "exact_selector_missing",
          "visible_text_match"
        ]
      }
    }

    if (exact instanceof HTMLElement) {
      return {
        element: exact,
        resolutionStrategy: ["exact_selector_hidden"]
      }
    }

    const fallback = findMatch(false)

    if (fallback) {
      return {
        element: fallback,
        resolutionStrategy: ["non_visible_text_match"]
      }
    }

    return null
  }

  try {
    if (payload.kind === "press_key") {
      const activeElement =
        (document.activeElement as HTMLElement | null) ?? document.body
      const resolvedTarget = payload.target
        ? resolveElement(payload.target)
        : null
      const targetElement = resolvedTarget?.element ?? activeElement

      const trace: AgentExecutionTrace = {
        actionType: "press_key",
        resolutionStrategy: resolvedTarget?.resolutionStrategy ?? [
          "active_element_fallback"
        ],
        activeElementBefore: describeElement(activeElement)
      }

      if (!targetElement) {
        return {
          ok: false,
          details: "Target element not found for key press",
          trace
        }
      }

      targetElement.focus()
      trace.resolvedElement = describeElement(targetElement)

      const eventInit = {
        key: payload.key,
        bubbles: true,
        cancelable: true
      }

      targetElement.dispatchEvent(new KeyboardEvent("keydown", eventInit))
      targetElement.dispatchEvent(new KeyboardEvent("keypress", eventInit))
      targetElement.dispatchEvent(new KeyboardEvent("keyup", eventInit))

      if (["Enter", "ArrowDown", " ", "Spacebar"].includes(payload.key)) {
        await domDelay(120)
      }

      if (
        payload.key === "Enter" &&
        (targetElement instanceof HTMLInputElement ||
          targetElement instanceof HTMLTextAreaElement ||
          targetElement instanceof HTMLSelectElement)
      ) {
        const closestForm = targetElement.closest("form")
        const form =
          targetElement.form ??
          (closestForm instanceof HTMLFormElement ? closestForm : null)

        if (form) {
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit()
          } else {
            form.submit()
          }

          return {
            ok: true,
            details: "Pressed key Enter and submitted form",
            trace: {
              ...trace,
              activeElementAfter: describeElement(
                document.activeElement as HTMLElement | null
              )
            }
          }
        }
      }

      return {
        ok: true,
        details: `Pressed key ${payload.key}`,
        trace: {
          ...trace,
          activeElementAfter: describeElement(
            document.activeElement as HTMLElement | null
          )
        }
      }
    }

    if (payload.kind === "scroll") {
      const y = payload.direction === "down" ? payload.amount : -payload.amount
      window.scrollBy({
        top: y,
        behavior: "smooth"
      })

      return {
        ok: true,
        details: `Scrolled ${payload.direction}`,
        trace: {
          actionType: "scroll",
          resolutionStrategy: ["window_scroll"],
          activeElementBefore: describeElement(
            document.activeElement as HTMLElement | null
          ),
          activeElementAfter: describeElement(
            document.activeElement as HTMLElement | null
          )
        }
      }
    }

    const resolvedTarget = resolveElement(payload.target)
    const element = resolvedTarget?.element
    const trace: AgentExecutionTrace = {
      actionType: payload.kind,
      resolutionStrategy: resolvedTarget?.resolutionStrategy ?? [
        "target_not_found"
      ],
      activeElementBefore: describeElement(
        document.activeElement as HTMLElement | null
      )
    }

    if (!element) {
      if (
        payload.kind === "click" &&
        payload.target.controlKind === "select_option"
      ) {
        const recoveredOption = await recoverStaleSelectOptionTarget(
          payload.target,
          trace
        )

        if (recoveredOption) {
          trace.clickTarget = describeElement(recoveredOption.optionElement)

          return {
            ok: true,
            details: "Recovered stale option and clicked target element",
            trace: {
              ...trace,
              resolutionStrategy: [
                ...trace.resolutionStrategy,
                "recover_stale_select_option"
              ],
              popupAfter: recoveredOption.popup,
              activeElementAfter: describeElement(
                document.activeElement as HTMLElement | null
              )
            }
          }
        }
      }

      return {
        ok: false,
        details: "Target element not found",
        trace
      }
    }

    trace.resolvedElement = describeElement(element)

    if (payload.kind === "click") {
      const interactionElement =
        payload.target.interactionSelector &&
        payload.target.interactionSelector !== payload.target.selector
          ? document.querySelector(payload.target.interactionSelector)
          : null
      const resolvedInteractionElement =
        interactionElement instanceof HTMLElement ? interactionElement : element
      const clickResolution = resolveVisibleClickTarget(
        resolvedInteractionElement
      )

      trace.interactionElement = describeElement(resolvedInteractionElement)
      trace.resolutionStrategy = [
        ...trace.resolutionStrategy,
        interactionElement instanceof HTMLElement
          ? "interaction_selector"
          : "resolved_element_interaction",
        `click:${clickResolution?.strategy ?? "none"}`
      ]

      if (!clickResolution) {
        return {
          ok: false,
          details: "Target element is not visible or interactable",
          trace
        }
      }

      const clickTarget = clickResolution.element
      trace.clickTarget = describeElement(clickTarget)

      clickTarget.scrollIntoView({ block: "center", inline: "center" })

      let popupAfterInteraction: AgentExecutionPopupSummary | undefined

      if (
        payload.target.controlKind === "custom_select" &&
        !payload.target.allowsTextEntry
      ) {
        const openResult = await tryOpenCustomSelect({
          resolvedElement: element,
          interactionElement: resolvedInteractionElement,
          trace
        })

        popupAfterInteraction = openResult.popup
        trace.clickTarget = describeElement(openResult.clickTarget)

        if (
          popupAfterInteraction.popupState !== "open" &&
          popupAfterInteraction.relatedOptionCount === 0
        ) {
          return {
            ok: false,
            details:
              "Dropdown options did not become observable after opening the field",
            trace: {
              ...trace,
              popupAfter: popupAfterInteraction,
              activeElementAfter: describeElement(
                document.activeElement as HTMLElement | null
              )
            }
          }
        }
      } else if (payload.target.controlKind === "select_option") {
        dispatchPointerClick(clickTarget)
        popupAfterInteraction = await waitForPopupState(clickTarget, 100, 2)
      } else {
        clickTarget.click()
        await domDelay(80)
      }

      return {
        ok: true,
        details:
          clickTarget === element
            ? "Clicked target element"
            : "Clicked associated visible target element",
        trace: {
          ...trace,
          ...(popupAfterInteraction
            ? { popupAfter: popupAfterInteraction }
            : {}),
          activeElementAfter: describeElement(
            document.activeElement as HTMLElement | null
          )
        }
      }
    }

    if (payload.kind === "type_text" && !isVisibleElement(element)) {
      return {
        ok: false,
        details: "Target element is not visible or interactable",
        trace
      }
    }

    if (payload.kind === "extract_text") {
      const text = normalize(element.innerText || element.textContent || "")

      return {
        ok: true,
        details: text
          ? `Extracted text: ${text.slice(0, 240)}`
          : "Element has no text",
        text,
        trace: {
          ...trace,
          activeElementAfter: describeElement(
            document.activeElement as HTMLElement | null
          )
        }
      }
    }

    element.scrollIntoView({ block: "center", inline: "center" })
    element.focus()

    if (element instanceof HTMLSelectElement) {
      const option = Array.from(element.options).find(
        (item) =>
          normalize(item.text).toLowerCase() ===
          normalize(payload.text).toLowerCase()
      )

      if (!option) {
        return { ok: false, details: "No matching select option found" }
      }

      element.value = option.value
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return { ok: true, details: "Selected option" }
    }

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) {
      if (element instanceof HTMLInputElement && element.type === "file") {
        return {
          ok: false,
          details:
            "File input detected; browser security blocks automated file path typing",
          trace
        }
      }

      if (payload.clearFirst) {
        element.value = ""
      }

      element.value = payload.clearFirst
        ? payload.text
        : `${element.value}${payload.text}`
      element.dispatchEvent(new Event("input", { bubbles: true }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return {
        ok: true,
        details: "Typed text into target",
        trace: {
          ...trace,
          activeElementAfter: describeElement(
            document.activeElement as HTMLElement | null
          )
        }
      }
    }

    if (element.isContentEditable) {
      const existingText = element.textContent ?? ""

      element.textContent = payload.clearFirst
        ? payload.text
        : `${existingText}${payload.text}`
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: payload.text,
          inputType: payload.clearFirst ? "insertReplacementText" : "insertText"
        })
      )
      element.dispatchEvent(new Event("change", { bubbles: true }))
      return {
        ok: true,
        details: "Typed text into editable element",
        trace: {
          ...trace,
          activeElementAfter: describeElement(
            document.activeElement as HTMLElement | null
          )
        }
      }
    }

    return {
      ok: false,
      details: "Target is not an editable element",
      trace
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown page error"

    return {
      ok: false,
      details: `DOM action failed: ${message}`,
      trace: {
        actionType: payload.kind,
        resolutionStrategy: ["dom_action_exception"]
      }
    }
  }
}

const readSnapshot = async (
  tabId: number,
  session?: RunSession
): Promise<PageSnapshot> => {
  const result = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: collectSnapshotInPage
  })

  const snapshot = mergeFrameSnapshots(result)
  const snapshotWithOverrides = session
    ? applyControlValueOverrides(session, snapshot)
    : snapshot

  return normalizeMediaSummary(snapshotWithOverrides, session)
}

const buildDomTarget = (candidate: ElementCandidate): DomTarget => {
  return {
    frameId: candidate.frameId,
    selector: candidate.selector,
    interactionSelector: candidate.interactionSelector,
    ownerControlSelector: candidate.ownerControlSelector,
    popupContainerSelector: candidate.popupContainerSelector,
    text: candidate.text,
    label: candidate.label,
    tagName: candidate.tagName,
    controlKind: candidate.controlKind,
    allowsTextEntry: candidate.allowsTextEntry,
    optionSource: candidate.optionSource
  }
}

const executeDomAction = async (
  tabId: number,
  frameId: number,
  payload: DomActionPayload
) => {
  return chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: runDomActionInPage,
    args: [payload]
  })
}

const waitForPostActionSettle = async (
  session: RunSession,
  previousTabUrl: string
) => {
  await waitForInterruptibleDelay(session, CLICK_SETTLE_DELAY_MS)
  assertRunNotStopped(session)

  const currentTab = await chrome.tabs.get(session.tabId)
  const currentUrl = currentTab.url ?? previousTabUrl
  const topLevelUrlChanged = currentUrl !== previousTabUrl

  if (currentTab.status === "loading") {
    await waitForTabComplete(session.tabId)
    assertRunNotStopped(session)
    await waitForInterruptibleDelay(session, POST_NAVIGATION_SETTLE_DELAY_MS)
    assertRunNotStopped(session)
  } else if (topLevelUrlChanged) {
    await waitForInterruptibleDelay(session, POST_NAVIGATION_SETTLE_DELAY_MS)
    assertRunNotStopped(session)
  }

  return {
    topLevelUrlChanged
  }
}

const normalizeDomActionResult = (
  rawResult: chrome.scripting.InjectionResult<unknown>[],
  fallbackDetails: string
): DomActionResult => {
  const result = rawResult[0]?.result

  if (
    !result ||
    typeof result !== "object" ||
    typeof (result as { ok?: unknown }).ok !== "boolean" ||
    typeof (result as { details?: unknown }).details !== "string"
  ) {
    return {
      ok: false,
      details: fallbackDetails
    }
  }

  return result as DomActionResult
}

const captureAfterActionSnapshot = async (
  tabId: number,
  candidate?: ElementCandidate,
  session?: RunSession
) => {
  try {
    const snapshot = await readSnapshot(tabId, session)

    return {
      snapshot,
      popup: buildPopupSummaryFromSnapshot(snapshot, candidate),
      summary: buildAfterSnapshotSummary(snapshot, candidate)
    }
  } catch {
    return undefined
  }
}

const runElementAction = async (
  tabId: number,
  candidate: ElementCandidate,
  action: AgentAction
) => {
  const target = buildDomTarget(candidate)

  if (action.type === "click") {
    const rawResult = await executeDomAction(tabId, candidate.frameId, {
      kind: "click",
      target
    } as DomActionPayload)

    return normalizeDomActionResult(
      rawResult,
      "Click action returned no result"
    )
  }

  if (action.type === "type_text") {
    const rawResult = await executeDomAction(tabId, candidate.frameId, {
      kind: "type_text",
      target,
      text: action.text,
      clearFirst: action.clearFirst ?? true
    } as DomActionPayload)

    return normalizeDomActionResult(rawResult, "Type action returned no result")
  }

  const rawResult = await executeDomAction(tabId, candidate.frameId, {
    kind: "extract_text",
    target
  } as DomActionPayload)

  return normalizeDomActionResult(
    rawResult,
    "Extract action returned no result"
  )
}

const inferCharacterLimit = (candidate: ElementCandidate): number | null => {
  if (candidate.maxLength && candidate.maxLength > 0) {
    return candidate.maxLength
  }

  const hintText =
    `${candidate.questionText} ${candidate.describedBy} ${candidate.placeholder}`.toLowerCase()
  const match = hintText.match(
    /(\d{1,4})\s*(?:characters?|chars?)\s*(?:or less|max(?:imum)?|limit)?/
  )

  if (!match) {
    return null
  }

  const value = Number(match[1])

  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  return value
}

const isSyntheticFillCommand = (command: string) => {
  return /\b(random|dummy|fake|placeholder|test data|sample data)\b/i.test(
    command
  )
}

const buildSafeSyntheticText = (
  candidate: ElementCandidate,
  requestedText: string
) => {
  const descriptor = [
    candidate.label,
    candidate.questionText,
    candidate.placeholder,
    candidate.nameAttr,
    candidate.idAttr,
    candidate.context
  ]
    .join(" ")
    .toLowerCase()

  if (candidate.inputType === "email" || /\bemail\b/.test(descriptor)) {
    return "test@example.com"
  }

  if (candidate.inputType === "url") {
    if (/linkedin/.test(descriptor)) {
      return "https://www.linkedin.com/in/test-user"
    }

    if (/github/.test(descriptor)) {
      return "https://github.com/example"
    }

    if (/twitter|twitter\/x|\bx\b/.test(descriptor)) {
      return "https://x.com/example"
    }

    if (/video|demo/.test(descriptor)) {
      return "https://example.com/demo"
    }

    return "https://example.com"
  }

  if (/\bname\b/.test(descriptor)) {
    return "Test User"
  }

  if (/company name/.test(descriptor)) {
    return "Example Labs"
  }

  if (/how many founders|team size/.test(descriptor)) {
    return "1"
  }

  if (/traction|mrr|revenue|users/.test(descriptor)) {
    return "Testing with early users"
  }

  if (/where are you based|location|based/.test(descriptor)) {
    return "Remote"
  }

  if (/one line|describe what you are building/.test(descriptor)) {
    return "Building software tools for teams."
  }

  if (
    /coolest thing|other ideas|what convinced you|background/.test(descriptor)
  ) {
    return "Test response for automation."
  }

  if (candidate.tagName === "textarea") {
    return "Test response for automation."
  }

  if (candidate.inputType === "number") {
    return "1"
  }

  return requestedText.length > 80 ? "Test response." : requestedText
}

const getTypeTextGuardError = (candidate: ElementCandidate, text: string) => {
  if (text.length === 0 && candidate.valuePreview.trim().length === 0) {
    return "Field is already empty"
  }

  if (candidate.inputType === "file") {
    return "File upload input detected; attach files manually before continuing"
  }

  if (candidate.controlKind === "custom_select" && !candidate.allowsTextEntry) {
    return "Target is a dropdown/select field; click it and choose a visible option instead of typing arbitrary text"
  }

  if (candidate.controlKind === "select_option") {
    return "Target is a selectable option; use click instead of typing"
  }

  if (candidate.inputType === "checkbox" || candidate.inputType === "radio") {
    return "Target is a checkbox/radio field and cannot accept free text"
  }

  const characterLimit = inferCharacterLimit(candidate)

  if (characterLimit && text.length > characterLimit) {
    return `Text length ${text.length} exceeds field limit ${characterLimit}`
  }

  return null
}

const waitForInterruptibleDelay = (session: RunSession, ms: number) => {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => {
        if (session.pendingWait?.timeoutId === timeoutId) {
          session.pendingWait = null
        }

        resolve()
      },
      Math.max(0, ms)
    )

    session.pendingWait = {
      timeoutId,
      reject: (error) => {
        if (session.pendingWait?.timeoutId === timeoutId) {
          clearTimeout(timeoutId)
          session.pendingWait = null
          reject(error)
        }
      }
    }

    if (session.stopRequested) {
      session.pendingWait.reject(createRunStoppedError())
    }
  })
}

const executeAction = async (
  session: RunSession,
  action: AgentAction,
  snapshot: PageSnapshot
) => {
  const tabId = session.tabId
  const candidates = snapshot.elements

  assertRunNotStopped(session)

  if (action.type === "open_url") {
    await chrome.tabs.update(tabId, { url: action.url })
    await waitForTabComplete(tabId)
    assertRunNotStopped(session)
    session.lastInteractionFrameId = 0
    const afterSnapshot = await captureAfterActionSnapshot(
      tabId,
      undefined,
      session
    )

    return {
      ok: true,
      details: `Opened ${action.url}`,
      trace: {
        actionType: "open_url",
        resolutionStrategy: ["tab_update"],
        beforeUrl: snapshot.url,
        afterUrl: action.url,
        topLevelUrlChanged: action.url !== snapshot.url,
        ...(afterSnapshot
          ? {
              afterSnapshot: afterSnapshot.summary
            }
          : {})
      }
    }
  }

  if (action.type === "wait") {
    await waitForInterruptibleDelay(session, action.ms)
    assertRunNotStopped(session)
    return {
      ok: true,
      details: `Waited ${action.ms}ms`,
      trace: {
        actionType: "wait",
        resolutionStrategy: ["interruptible_delay"],
        beforeUrl: snapshot.url,
        afterUrl: snapshot.url,
        topLevelUrlChanged: false
      }
    }
  }

  if (action.type === "press_key") {
    let target: DomTarget | undefined
    let targetFrameId = session.lastInteractionFrameId
    let targetCandidate: ElementCandidate | undefined

    if (action.eid) {
      const candidate = candidates.find((item) => item.eid === action.eid)

      if (!candidate) {
        return {
          ok: false,
          details: `Element ${action.eid} not available in snapshot`
        }
      }

      target = buildDomTarget(candidate)
      targetFrameId = candidate.frameId
      targetCandidate = candidate
    }

    const previousTabUrl = snapshot.url
    const rawResult = await executeDomAction(tabId, targetFrameId, {
      kind: "press_key",
      key: action.key,
      target
    } as DomActionPayload)

    const result = normalizeDomActionResult(
      rawResult,
      "Key press action returned no result"
    )

    if (result.ok) {
      session.lastInteractionFrameId = targetFrameId

      let topLevelUrlChanged = false

      if (action.key === "Enter") {
        const settled = await waitForPostActionSettle(session, previousTabUrl)
        topLevelUrlChanged = settled.topLevelUrlChanged

        if (settled.topLevelUrlChanged) {
          session.lastInteractionFrameId = 0
        }
      }

      const afterSnapshot = await captureAfterActionSnapshot(
        tabId,
        targetCandidate,
        session
      )

      result.trace = {
        actionType: "press_key",
        resolutionStrategy: result.trace?.resolutionStrategy ?? [],
        ...result.trace,
        ...(targetCandidate
          ? {
              requestedCandidate:
                buildExecutionCandidateSummary(targetCandidate),
              popupBefore: buildPopupSummaryFromSnapshot(
                snapshot,
                targetCandidate
              )
            }
          : {}),
        beforeUrl: previousTabUrl,
        afterUrl: afterSnapshot?.summary.url ?? previousTabUrl,
        topLevelUrlChanged,
        ...(afterSnapshot
          ? {
              popupAfter: afterSnapshot.popup,
              afterSnapshot: afterSnapshot.summary
            }
          : {})
      }
    } else if (targetCandidate) {
      result.trace = {
        actionType: "press_key",
        resolutionStrategy: result.trace?.resolutionStrategy ?? [],
        ...result.trace,
        requestedCandidate: buildExecutionCandidateSummary(targetCandidate),
        popupBefore: buildPopupSummaryFromSnapshot(snapshot, targetCandidate),
        beforeUrl: previousTabUrl,
        afterUrl: previousTabUrl,
        topLevelUrlChanged: false
      }
    }

    return result
  }

  if (action.type === "scroll") {
    const rawResult = await executeDomAction(
      tabId,
      session.lastInteractionFrameId,
      {
        kind: "scroll",
        direction: action.direction,
        amount: action.amount ?? 700
      } as DomActionPayload
    )

    const result = normalizeDomActionResult(
      rawResult,
      "Scroll action returned no result"
    )

    if (result.ok) {
      await waitForInterruptibleDelay(session, SCROLL_SETTLE_DELAY_MS)
      assertRunNotStopped(session)
      const afterSnapshot = await captureAfterActionSnapshot(
        tabId,
        candidates.find(
          (item) => item.frameId === session.lastInteractionFrameId
        ),
        session
      )

      result.trace = {
        actionType: "scroll",
        resolutionStrategy: result.trace?.resolutionStrategy ?? [],
        ...result.trace,
        beforeUrl: snapshot.url,
        afterUrl: afterSnapshot?.summary.url ?? snapshot.url,
        topLevelUrlChanged:
          (afterSnapshot?.summary.url ?? snapshot.url) !== snapshot.url,
        ...(afterSnapshot
          ? {
              afterSnapshot: afterSnapshot.summary
            }
          : {})
      }
    } else {
      result.trace = {
        actionType: "scroll",
        resolutionStrategy: result.trace?.resolutionStrategy ?? [],
        ...result.trace,
        beforeUrl: snapshot.url,
        afterUrl: snapshot.url,
        topLevelUrlChanged: false
      }
    }

    return result
  }

  if (action.type === "finish") {
    return {
      ok: true,
      details: action.message,
      trace: {
        actionType: "finish",
        resolutionStrategy: ["planner_finish"],
        beforeUrl: snapshot.url,
        afterUrl: snapshot.url,
        topLevelUrlChanged: false
      }
    }
  }

  const eid = action.eid
  const candidate = candidates.find((item) => item.eid === eid)

  if (!candidate) {
    return { ok: false, details: `Element ${eid} not available in snapshot` }
  }

  if (action.type === "type_text") {
    if (isSyntheticFillCommand(session.command)) {
      action.text = buildSafeSyntheticText(candidate, action.text)
    }

    const guardError = getTypeTextGuardError(candidate, action.text)

    if (guardError) {
      return {
        ok: false,
        details: guardError
      }
    }
  }

  if (
    action.type === "click" &&
    candidate.controlKind === "select_option" &&
    candidate.ownerControlSelector
  ) {
    const selectedValue = session.controlValueOverrides.get(
      getControlValueOverrideKey(
        candidate.frameId,
        candidate.frameUrl,
        candidate.ownerControlSelector
      )
    )

    if (
      selectedValue &&
      normalizeText(selectedValue).toLowerCase() ===
        normalizeText(candidate.text).toLowerCase()
    ) {
      return {
        ok: false,
        details: `Option "${candidate.text}" is already selected`
      }
    }
  }

  if (action.type === "click" && isSubmitLikeCandidate(candidate)) {
    const blockers = getFormCompletionBlockers(snapshot, session.command)

    if (blockers.required.length > 0) {
      return {
        ok: false,
        details: `Submit blocked: unresolved required fields: ${blockers.required
          .slice(0, 5)
          .join(", ")}`
      }
    }

    if (blockers.optional.length > 0) {
      return {
        ok: false,
        details: `Submit blocked: visible empty fields remain: ${blockers.optional
          .slice(0, 5)
          .join(", ")}`
      }
    }
  }

  const previousTabUrl = action.type === "click" ? snapshot.url : snapshot.url
  const result = await runElementAction(tabId, candidate, action)

  if (
    result.ok &&
    action.type === "click" &&
    candidate.controlKind === "select_option" &&
    candidate.ownerControlSelector
  ) {
    session.controlValueOverrides.set(
      getControlValueOverrideKey(
        candidate.frameId,
        candidate.frameUrl,
        candidate.ownerControlSelector
      ),
      candidate.text
    )
    result.details = `Selected option \"${candidate.text}\" for \"${candidate.label || candidate.questionText || "field"}\"`
  }

  if (
    result.ok &&
    action.type === "click" &&
    candidate.controlKind === "custom_select" &&
    !candidate.allowsTextEntry &&
    (result.trace?.popupAfter?.relatedOptionCount ?? 0) > 0
  ) {
    result.details = `Opened dropdown for \"${candidate.label || candidate.questionText || "field"}\"`
  }

  result.trace = {
    actionType: action.type,
    resolutionStrategy: result.trace?.resolutionStrategy ?? [],
    ...result.trace,
    requestedCandidate: buildExecutionCandidateSummary(candidate),
    popupBefore: buildPopupSummaryFromSnapshot(snapshot, candidate),
    beforeUrl: previousTabUrl
  }

  if (result.ok) {
    session.lastInteractionFrameId = candidate.frameId

    let topLevelUrlChanged = false

    if (action.type === "click") {
      const settled = await waitForPostActionSettle(session, previousTabUrl)
      topLevelUrlChanged = settled.topLevelUrlChanged

      if (settled.topLevelUrlChanged) {
        session.lastInteractionFrameId = 0
      }
    }

    const afterSnapshot = await captureAfterActionSnapshot(
      tabId,
      candidate,
      session
    )

    if (
      action.type === "click" &&
      candidate.controlKind === "custom_select" &&
      !candidate.allowsTextEntry &&
      afterSnapshot
    ) {
      const confirmedPopup = afterSnapshot.popup

      if (
        !confirmedPopup ||
        (confirmedPopup.popupState !== "open" &&
          confirmedPopup.relatedOptionCount === 0)
      ) {
        result.ok = false
        result.details =
          "Dropdown did not remain open long enough for options to be confirmed in the next snapshot"
      } else {
        result.details = `Opened dropdown for "${candidate.label || candidate.questionText || "field"}"`
      }
    }

    if (
      action.type === "type_text" &&
      action.text.length === 0 &&
      afterSnapshot?.summary.target?.valuePreview === candidate.valuePreview
    ) {
      result.ok = false
      result.details = candidate.valuePreview.trim().length
        ? "Field value did not change after clear attempt"
        : "Field is already empty"
    }

    result.trace = {
      actionType: action.type,
      resolutionStrategy: result.trace?.resolutionStrategy ?? [],
      ...result.trace,
      requestedCandidate: buildExecutionCandidateSummary(candidate),
      popupBefore: buildPopupSummaryFromSnapshot(snapshot, candidate),
      beforeUrl: previousTabUrl,
      afterUrl: afterSnapshot?.summary.url ?? previousTabUrl,
      topLevelUrlChanged,
      ...(afterSnapshot
        ? {
            popupAfter: afterSnapshot.popup,
            afterSnapshot: afterSnapshot.summary
          }
        : {})
    }
  } else {
    result.trace = {
      actionType: action.type,
      resolutionStrategy: result.trace?.resolutionStrategy ?? [],
      ...result.trace,
      requestedCandidate: buildExecutionCandidateSummary(candidate),
      popupBefore: buildPopupSummaryFromSnapshot(snapshot, candidate),
      beforeUrl: previousTabUrl,
      afterUrl: previousTabUrl,
      topLevelUrlChanged: false
    }
  }

  return result
}

const shouldRetryPlanStatus = (status: number) => {
  return status === 429 || status >= 500
}

const shouldRetryPlanError = (error: unknown) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true
  }

  const message = toErrorMessage(error).toLowerCase()

  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out")
  )
}

const inferFinishSuccess = (message: string) => {
  const lowered = message.toLowerCase()

  const blockerPattern =
    /unable|cannot|can't|could not|not logged in|log in|login|sign in|permission|access denied|blocked|captcha|failed|error|not possible/

  return !blockerPattern.test(lowered)
}

const isEditableCandidate = (candidate: ElementCandidate) => {
  return (
    candidate.tagName === "input" ||
    candidate.tagName === "textarea" ||
    candidate.tagName === "select" ||
    candidate.role === "textbox" ||
    candidate.role === "checkbox" ||
    candidate.role === "radio" ||
    (candidate.tagName === "label" && candidate.forAttr.length > 0) ||
    candidate.inputType !== null
  )
}

const shouldLoadPlannerMemory = (command: string, snapshot: PageSnapshot) => {
  const commandLower = command.toLowerCase()

  if (FORM_INTENT_PATTERN.test(commandLower)) {
    return true
  }

  const editableCandidates = snapshot.elements.filter(
    (candidate) =>
      candidate.enabled &&
      isEditableCandidate(candidate) &&
      candidate.inputType !== "file"
  )

  if (editableCandidates.length === 0) {
    return false
  }

  const hasKnownFieldHint = editableCandidates.some((candidate) => {
    const descriptor = [
      candidate.label,
      candidate.placeholder,
      candidate.questionText,
      candidate.describedBy,
      candidate.nameAttr,
      candidate.idAttr,
      candidate.forAttr,
      candidate.text,
      candidate.context,
      candidate.inputType ?? "",
      candidate.checked === true
        ? "checked selected true yes"
        : candidate.checked === false
          ? "unchecked unselected false no"
          : ""
    ]
      .join(" ")
      .toLowerCase()

    return FORM_FIELD_HINT_PATTERN.test(descriptor)
  })

  if (hasKnownFieldHint) {
    return true
  }

  const visibleText = snapshot.visibleTextPreview.join(" ").toLowerCase()

  return /\b(sign up|register|application|checkout|billing|shipping|profile|account|contact)\b/.test(
    visibleText
  )
}

const getPlannerCandidateLimit = (command: string, snapshot: PageSnapshot) => {
  if (shouldLoadPlannerMemory(command, snapshot)) {
    return Math.max(AGENT_MAX_CANDIDATES, AGENT_FORM_MAX_CANDIDATES)
  }

  return AGENT_MAX_CANDIDATES
}

const getPlannerMemoryForStep = async (
  session: RunSession,
  snapshot: PageSnapshot
) => {
  if (!shouldLoadPlannerMemory(session.command, snapshot)) {
    return undefined
  }

  if (!session.memoryLoaded) {
    try {
      const memoryEntries = await readStoredMemoryEntries()
      session.memoryCache = toPlannerMemory(memoryEntries)
    } catch {
      session.memoryCache = []
    }

    session.memoryLoaded = true
  }

  if (session.memoryCache.length === 0) {
    return undefined
  }

  const selectedMemory = selectPlannerMemoryForSnapshot(
    session.memoryCache,
    snapshot,
    session.command
  )

  if (selectedMemory.length === 0) {
    return undefined
  }

  return selectedMemory
}

const readPlannerTraceReference = (
  value: unknown
): PlannerTraceReference | undefined => {
  if (!isObject(value) || typeof value.tracePath !== "string") {
    return undefined
  }

  if (!isObject(value.snapshotSummary)) {
    return undefined
  }

  return value as PlannerTraceReference
}

type FetchPlanResult = {
  plan: AgentPlan
  planner?: PlannerTraceReference
}

const fetchPlan = async (
  session: RunSession,
  step: number,
  snapshot: PageSnapshot,
  history: AgentStepRecord[],
  memory?: PlannerMemoryEntry[]
): Promise<FetchPlanResult> => {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= PLAN_MAX_ATTEMPTS; attempt += 1) {
    assertRunNotStopped(session)

    const controller = new AbortController()
    session.activePlanController = controller
    const timeout = setTimeout(() => {
      controller.abort()
    }, PLAN_REQUEST_TIMEOUT_MS)

    try {
      const headers = await getAgentApiHeaders(true)
      const response = await fetch(`${AGENT_API_BASE}/api/agent/plan`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          command: session.command,
          snapshot,
          history,
          memory,
          plannerTrace: {
            runId: session.runId,
            step,
            attempt
          }
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        const errorText = await response.text()

        if (response.status === 401) {
          await writeStoredAuthSession(null)
        }

        const error = new Error(
          `Planning request failed: ${response.status} ${errorText}`
        )

        lastError = error

        if (
          attempt < PLAN_MAX_ATTEMPTS &&
          shouldRetryPlanStatus(response.status)
        ) {
          await sleep(PLAN_RETRY_BASE_DELAY_MS * attempt)
          continue
        }

        throw error
      }

      const payload = (await response.json()) as AgentPlan & {
        planner?: unknown
      }

      if (!isAgentPlan(payload)) {
        throw new Error("Planning response was invalid")
      }

      return {
        plan: {
          rationale: payload.rationale,
          action: payload.action
        },
        planner: readPlannerTraceReference(payload.planner)
      }
    } catch (error) {
      if (session.stopRequested) {
        throw createRunStoppedError()
      }

      lastError =
        error instanceof Error ? error : new Error(toErrorMessage(error))

      if (attempt < PLAN_MAX_ATTEMPTS && shouldRetryPlanError(error)) {
        await sleep(PLAN_RETRY_BASE_DELAY_MS * attempt)
        continue
      }

      throw lastError
    } finally {
      if (session.activePlanController === controller) {
        session.activePlanController = null
      }

      clearTimeout(timeout)
    }
  }

  throw new Error(
    `Planning request failed after ${PLAN_MAX_ATTEMPTS} attempts: ${
      lastError?.message ?? "Unknown error"
    }`
  )
}

const fetchAgentHealth = async () => {
  const headers = await getOptionalAgentApiHeaders(false)
  const response = await fetch(`${AGENT_API_BASE}/api/agent/health`, {
    method: "GET",
    headers
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Health check failed: ${response.status} ${errorText}`)
  }

  return (await response.json()) as {
    ok: boolean
    hasOpenRouterKey: boolean
    model: string
    authRequired: boolean
    hasSupabaseConfig: boolean
  }
}

const stopSessionExecution = (session: RunSession) => {
  session.stopRequested = true
  session.activePlanController?.abort()
  session.activePlanController = null

  if (session.pendingWait) {
    session.pendingWait.reject(createRunStoppedError())
  }

  if (session.pendingConfirmation) {
    session.pendingConfirmation.resolve(false)
    session.pendingConfirmation = null
  }
}

const waitForConfirmation = (session: RunSession) => {
  assertRunNotStopped(session)

  return new Promise<boolean>((resolve) => {
    session.pendingConfirmation = {
      resolve
    }
  })
}

type FinalRunState = {
  success: boolean
  message: string
}

const persistRunLog = async (
  session: RunSession,
  finalState: FinalRunState
) => {
  if (!SHOULD_PERSIST_RUN_LOGS) {
    await emitEvent({
      type: "run_log_saved",
      runId: session.runId,
      ok: true,
      skipped: true,
      message: "Run log saving is disabled by PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS"
    })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, RUN_LOG_REQUEST_TIMEOUT_MS)

  const runLog: AgentRunLog = {
    runId: session.runId,
    command: session.command,
    initialUrl: session.initialUrl,
    startedAt: session.startedAt,
    finishedAt: new Date().toISOString(),
    final: {
      success: finalState.success,
      message: finalState.message
    },
    steps: session.runLogSteps
  }

  try {
    const headers = await getAgentApiHeaders(true)
    const response = await fetch(`${AGENT_API_BASE}/api/agent/log`, {
      method: "POST",
      headers,
      body: JSON.stringify(runLog),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()

      if (response.status === 401) {
        await writeStoredAuthSession(null)
      }

      throw new Error(
        `Log save request failed: ${response.status} ${errorText}`
      )
    }

    const payload = (await response.json()) as {
      ok?: boolean
      path?: string
      skipped?: boolean
      message?: string
      error?: string
    }

    if (payload.skipped) {
      await emitEvent({
        type: "run_log_saved",
        runId: session.runId,
        ok: true,
        skipped: true,
        message:
          payload.message ??
          "Run log saving is disabled by PLASMO_PUBLIC_AGENT_SAVE_RUN_LOGS"
      })
      return
    }

    if (!payload.ok || typeof payload.path !== "string") {
      throw new Error(
        payload.error ?? payload.message ?? "Log save response was invalid"
      )
    }

    await emitEvent({
      type: "run_log_saved",
      runId: session.runId,
      ok: true,
      path: payload.path,
      message: `Saved run log to ${payload.path}`
    })
  } catch (error) {
    await emitEvent({
      type: "run_log_saved",
      runId: session.runId,
      ok: false,
      message: `Failed to save run log: ${toErrorMessage(error)}`
    })
  } finally {
    clearTimeout(timeout)
  }
}

const finalizeRunSession = async (
  session: RunSession,
  finalState: FinalRunState,
  runErrorMessage?: string
) => {
  if (runErrorMessage) {
    await emitEvent({
      type: "run_error",
      runId: session.runId,
      message: runErrorMessage
    })
  }

  await emitEvent({
    type: "run_finished",
    runId: session.runId,
    success: finalState.success,
    message: finalState.message
  })

  await persistRunLog(session, finalState)
  sessions.delete(session.runId)
}

const createSession = async (startMessage: AgentStartMessage) => {
  const tab = await getCurrentTab()
  assertAutomatableUrl(tab.url)
  await getActiveAuthSession()

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`

  const session: RunSession = {
    runId,
    tabId: tab.id!,
    command: startMessage.command,
    initialUrl: tab.url ?? "",
    startedAt: new Date().toISOString(),
    history: [],
    runLogSteps: [],
    pendingConfirmation: null,
    pendingWait: null,
    activePlanController: null,
    stopRequested: false,
    lastInteractionFrameId: 0,
    controlValueOverrides: new Map(),
    memoryLoaded: false,
    memoryCache: [],
    lastMediaObservation: null
  }

  sessions.set(runId, session)

  await emitEvent({
    type: "run_started",
    runId,
    command: session.command,
    url: tab.url ?? ""
  })

  return session
}

const runAgentLoop = async (session: RunSession) => {
  const runId = session.runId
  const recentActionSignatures: string[] = []
  const recentUrls: string[] = []
  const dropdownOpenAttempts = new Map<string, number>()
  let consecutiveActionErrors = 0

  try {
    for (let step = 1; step <= AGENT_MAX_STEPS; step += 1) {
      assertRunNotStopped(session)

      const fullSnapshot = await readSnapshot(session.tabId, session)
      assertRunNotStopped(session)

      const plannerCandidateLimit = getPlannerCandidateLimit(
        session.command,
        fullSnapshot
      )
      const rankedElements = rankCandidates(
        fullSnapshot.elements,
        session.command,
        plannerCandidateLimit
      )

      const snapshotForPlanner: PageSnapshot = {
        ...fullSnapshot,
        elements: rankedElements
      }

      const plannerMemory = await getPlannerMemoryForStep(
        session,
        snapshotForPlanner
      )
      assertRunNotStopped(session)

      const plan = await fetchPlan(
        session,
        step,
        snapshotForPlanner,
        session.history,
        plannerMemory
      )
      assertRunNotStopped(session)

      const runLogStep: AgentRunLogStep = {
        step,
        plannedAt: new Date().toISOString(),
        page: {
          url: snapshotForPlanner.url,
          title: snapshotForPlanner.title,
          timestamp: snapshotForPlanner.timestamp
        },
        rationale: plan.plan.rationale,
        action: plan.plan.action,
        ...(plan.planner ? { planner: plan.planner } : {})
      }

      session.runLogSteps.push(runLogStep)

      await emitEvent({
        type: "step_planned",
        runId,
        step,
        action: plan.plan.action,
        rationale: plan.plan.rationale,
        snapshot: snapshotForPlanner,
        ...(plan.planner ? { planner: plan.planner } : {})
      })

      if (plan.plan.action.type === "click") {
        const clickAction = plan.plan.action
        const clickedCandidate = fullSnapshot.elements.find(
          (item) => item.eid === clickAction.eid
        )

        if (
          isPlayButtonCandidate(clickedCandidate) &&
          fullSnapshot.media &&
          (fullSnapshot.media.playbackState === "playing" ||
            fullSnapshot.media.progressing)
        ) {
          await finalizeRunSession(session, {
            success: true,
            message: "Stopped because media playback was already in progress"
          })
          return
        }

        if (
          clickedCandidate?.controlKind === "custom_select" &&
          !clickedCandidate.allowsTextEntry
        ) {
          const key = `${fullSnapshot.url}|${getControlSelector(clickedCandidate)}`
          const hasVisibleOptions = snapshotForPlanner.elements.some((item) => {
            return doesOptionBelongToControl(item, clickedCandidate)
          })

          if (hasVisibleOptions) {
            await finalizeRunSession(session, {
              success: false,
              message:
                "Stopped to avoid a loop: dropdown options were visible, but the planner kept clicking the same field instead of choosing one"
            })
            return
          }

          if (clickedCandidate.popupState !== "open") {
            const attempts = (dropdownOpenAttempts.get(key) ?? 0) + 1
            dropdownOpenAttempts.set(key, attempts)

            if (attempts >= DROPDOWN_OPEN_REPEAT_THRESHOLD) {
              await finalizeRunSession(session, {
                success: false,
                message:
                  "Stopped because a dropdown field was clicked repeatedly but no selectable options ever became available"
              })
              return
            }
          } else {
            dropdownOpenAttempts.delete(key)
          }
        }
      }

      const actionSignature = `${fullSnapshot.url}|${JSON.stringify(plan.plan.action)}`
      recentActionSignatures.push(actionSignature)

      if (recentActionSignatures.length > LOOP_REPEAT_THRESHOLD + 2) {
        recentActionSignatures.shift()
      }

      let repeatedActionCount = 1

      for (
        let index = recentActionSignatures.length - 2;
        index >= 0;
        index -= 1
      ) {
        if (recentActionSignatures[index] !== actionSignature) {
          break
        }

        repeatedActionCount += 1
      }

      if (repeatedActionCount >= LOOP_REPEAT_THRESHOLD) {
        await finalizeRunSession(session, {
          success: false,
          message:
            "Stopped to avoid a loop: planner repeated the same action several times on the same page"
        })
        return
      }

      if (plan.plan.action.type === "finish") {
        const success =
          plan.plan.action.success ??
          inferFinishSuccess(plan.plan.action.message)

        await finalizeRunSession(session, {
          success,
          message: plan.plan.action.message
        })
        return
      }

      if (isSensitiveAction(plan.plan.action, fullSnapshot.elements)) {
        const confirmationReason = "This action appears destructive or final."

        runLogStep.confirmation = {
          required: true,
          reason: confirmationReason,
          approved: null
        }

        await emitEvent({
          type: "confirmation_required",
          runId,
          action: plan.plan.action,
          reason: confirmationReason
        })

        const approved = await waitForConfirmation(session)
        session.pendingConfirmation = null

        runLogStep.confirmation.approved = approved
        runLogStep.confirmation.resolvedAt = new Date().toISOString()

        assertRunNotStopped(session)

        if (!approved) {
          await finalizeRunSession(session, {
            success: false,
            message: "Action rejected by user"
          })
          return
        }
      }

      const execution = await executeAction(
        session,
        plan.plan.action,
        fullSnapshot
      )
      assertRunNotStopped(session)

      const executionStep: AgentStepExecution = {
        result: execution.ok ? "success" : "error",
        details: execution.details,
        executedAt: new Date().toISOString(),
        ...(execution.trace
          ? { trace: execution.trace as AgentExecutionTrace }
          : {})
      }
      runLogStep.execution = executionStep

      const record: AgentStepRecord = {
        step,
        action: plan.plan.action,
        result: execution.ok ? "success" : "error",
        details: execution.details
      }

      session.history.push(record)
      recentUrls.push(fullSnapshot.url)

      if (recentUrls.length > MAX_STAGNANT_CLICK_STEPS) {
        recentUrls.shift()
      }

      consecutiveActionErrors = execution.ok ? 0 : consecutiveActionErrors + 1

      const recentRecords = session.history.slice(-MAX_STAGNANT_CLICK_STEPS)
      const stagnantClickLoop =
        recentRecords.length === MAX_STAGNANT_CLICK_STEPS &&
        recentUrls.length === MAX_STAGNANT_CLICK_STEPS &&
        recentRecords.every((item) => item.action.type === "click") &&
        recentUrls.every((url) => url === recentUrls[0])

      const interactionActionTypes = new Set([
        "click",
        "type_text",
        "press_key"
      ])
      const interactionRecords = session.history.slice(
        -MAX_STAGNANT_INTERACTION_STEPS
      )
      const interactionActionSignatures = interactionRecords.map((item) =>
        JSON.stringify(item.action)
      )
      const uniqueInteractionActions = new Set(interactionActionSignatures).size
      const stagnantInteractionLoop =
        interactionRecords.length === MAX_STAGNANT_INTERACTION_STEPS &&
        recentUrls.length === MAX_STAGNANT_INTERACTION_STEPS &&
        interactionRecords.every((item) =>
          interactionActionTypes.has(item.action.type)
        ) &&
        recentUrls.every((url) => url === recentUrls[0]) &&
        uniqueInteractionActions <= 3

      await emitEvent({
        type: "step_result",
        runId,
        step,
        record,
        execution: executionStep
      })

      if (stagnantClickLoop) {
        await finalizeRunSession(session, {
          success: false,
          message:
            "Stopped to avoid a click loop on the same page; planner needs a different approach"
        })
        return
      }

      if (stagnantInteractionLoop) {
        await finalizeRunSession(session, {
          success: false,
          message:
            "Stopped to avoid a repeated interaction loop on the same page; planner should switch to direct navigation"
        })
        return
      }

      if (consecutiveActionErrors >= MAX_CONSECUTIVE_ACTION_ERRORS) {
        await finalizeRunSession(session, {
          success: false,
          message:
            "Stopped after repeated action failures; planner likely needs a different strategy"
        })
        return
      }
    }

    await finalizeRunSession(session, {
      success: false,
      message: "Max step limit reached"
    })
    return
  } catch (error) {
    if (isRunStoppedError(error)) {
      await finalizeRunSession(session, {
        success: false,
        message: STOPPED_BY_USER_MESSAGE
      })
      return
    }

    const message = toErrorMessage(error)

    await finalizeRunSession(
      session,
      {
        success: false,
        message
      },
      message
    )
    return
  }
}

const openSidePanel = async () => {
  const tab = await getCurrentTab()

  if (!tab.windowId) {
    throw new Error("No active browser window")
  }

  await chrome.sidePanel.open({ windowId: tab.windowId })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined)
})

chrome.runtime.onMessage.addListener(
  (message: AgentRuntimeMessage, _, sendResponse) => {
    if (message.type === "agent/start") {
      createSession(message)
        .then((session) => {
          runAgentLoop(session).catch(async (error) => {
            await emitEvent({
              type: "run_error",
              runId: session.runId,
              message: toErrorMessage(error)
            })
          })

          sendResponse({ ok: true, runId: session.runId })
        })
        .catch((error) => {
          sendResponse({ ok: false, error: toErrorMessage(error) })
        })

      return true
    }

    if (message.type === "agent/stop") {
      const session = sessions.get(message.runId)

      if (!session) {
        sendResponse({ ok: true })
        return false
      }

      if (!session.stopRequested) {
        stopSessionExecution(session)
      }

      sendResponse({ ok: true })
      return false
    }

    if (message.type === "agent/confirm") {
      const session = sessions.get(message.runId)

      if (!session || !session.pendingConfirmation) {
        sendResponse({ ok: false, error: "No pending confirmation found" })
        return false
      }

      session.pendingConfirmation.resolve(message.approve)
      session.pendingConfirmation = null
      sendResponse({ ok: true })
      return false
    }

    if (message.type === "agent/open-panel") {
      openSidePanel()
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({ ok: false, error: toErrorMessage(error) })
        )

      return true
    }

    if (message.type === "agent/health") {
      fetchAgentHealth()
        .then((health) => sendResponse({ ok: true, health }))
        .catch((error) =>
          sendResponse({ ok: false, error: toErrorMessage(error) })
        )

      return true
    }

    if (message.type === "agent/memory/list") {
      readStoredMemoryEntries()
        .then((entries) => sendResponse({ ok: true, entries }))
        .catch((error) =>
          sendResponse({ ok: false, error: toErrorMessage(error) })
        )

      return true
    }

    if (message.type === "agent/memory/upsert") {
      upsertStoredMemoryEntry(message.entry)
        .then((entries) => sendResponse({ ok: true, entries }))
        .catch((error) =>
          sendResponse({ ok: false, error: toErrorMessage(error) })
        )

      return true
    }

    if (message.type === "agent/memory/delete") {
      deleteStoredMemoryEntry(message.id)
        .then((entries) => sendResponse({ ok: true, entries }))
        .catch((error) =>
          sendResponse({ ok: false, error: toErrorMessage(error) })
        )

      return true
    }

    if (message.type === "agent/auth/session") {
      const nextSession = message.session
        ? sanitizeAuthSession(message.session)
        : null

      if (message.session && !nextSession) {
        sendResponse({ ok: false, error: "Invalid auth session payload" })
        return false
      }

      writeStoredAuthSession(nextSession)
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({ ok: false, error: toErrorMessage(error) })
        )

      return true
    }

    sendResponse({ ok: false, error: "Unsupported message type" })
    return false
  }
)

export {}
