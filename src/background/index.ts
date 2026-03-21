import type {
  AgentAuthSession,
  AgentEvent,
  AgentRuntimeMessage,
  AgentStartMessage
} from "~lib/agent/messages"
import { rankCandidates } from "~lib/agent/ranking"
import type {
  AgentAction,
  AgentMemoryEntry,
  AgentMemoryUpsertInput,
  AgentPlan,
  AgentRunLog,
  AgentRunLogStep,
  AgentStepRecord,
  ElementCandidate,
  PageSnapshot,
  PlannerMemoryEntry
} from "~lib/agent/types"
import { AGENT_MAX_CANDIDATES, AGENT_MAX_STEPS } from "~lib/agent/types"
import { isObject, isSensitiveAction } from "~lib/agent/validation"

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
  memoryLoaded: boolean
  memoryCache: PlannerMemoryEntry[]
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
    candidate.label,
    candidate.placeholder,
    candidate.questionText,
    candidate.describedBy,
    candidate.nameAttr,
    candidate.idAttr,
    candidate.autocomplete,
    candidate.context,
    candidate.inputType ?? "",
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

const collectSnapshotInPage = () => {
  type RawRect = {
    x: number
    y: number
    width: number
    height: number
  }

  type RawCandidate = {
    eid: string
    tagName: string
    role: string | null
    inputType: string | null
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
    maxLength: number | null
    selector: string
    context: string
    visible: boolean
    enabled: boolean
    inViewport: boolean
    rect: RawRect
  }

  const normalize = (value: string) => value.replace(/\s+/g, " ").trim()

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

  const nearestContext = (element: Element) => {
    const section = element.closest("section, form, main, article, dialog")
    const heading =
      section?.querySelector("h1, h2, h3, h4, legend") ??
      element.closest("label")?.querySelector("span")

    return normalize(heading?.textContent ?? "")
  }

  const getLabel = (element: Element) => {
    const htmlElement = element as HTMLElement
    const aria = htmlElement.getAttribute("aria-label")
    if (aria) {
      return normalize(aria)
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
      const siblingText = normalize(
        (sibling as HTMLElement).innerText || sibling.textContent || ""
      )

      if (siblingText.length >= 4 && siblingText.length <= 220) {
        snippets.push(siblingText)
      }

      sibling = sibling.previousElementSibling
      hops += 1
    }

    return uniqueJoin(snippets)
  }

  const getQuestionText = (element: Element) => {
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
    const fromPrevSibling = getPreviousPromptText(htmlElement)

    return uniqueJoin(
      [
        getLabel(element),
        fromLabelledBy,
        fromFieldsetLegend,
        fromWrappingLabel,
        fromPrevSibling,
        fromDescribedBy
      ],
      260
    )
  }

  const getDescribedByText = (element: Element) => {
    const htmlElement = element as HTMLElement
    return getTextByIdRefs(htmlElement.getAttribute("aria-describedby"))
  }

  const getRequired = (element: Element) => {
    const htmlElement = element as HTMLElement

    if (
      htmlElement instanceof HTMLInputElement ||
      htmlElement instanceof HTMLTextAreaElement ||
      htmlElement instanceof HTMLSelectElement
    ) {
      return (
        htmlElement.required ||
        htmlElement.getAttribute("aria-required") === "true"
      )
    }

    return htmlElement.getAttribute("aria-required") === "true"
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

  const query = [
    "button",
    "a[href]",
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "[role='button']",
    "[role='link']",
    "[contenteditable='true']"
  ].join(",")

  const unique = new Set<Element>()
  const rawCandidates: RawCandidate[] = []

  for (const element of Array.from(document.querySelectorAll(query))) {
    if (unique.has(element)) {
      continue
    }

    unique.add(element)

    const htmlElement = element as HTMLElement
    const rect = element.getBoundingClientRect()

    const text = normalize(
      htmlElement.innerText || htmlElement.textContent || ""
    )
    const label = getLabel(element)
    const questionText = getQuestionText(element)
    const describedBy = getDescribedByText(element)
    const placeholder = normalize(
      (htmlElement as HTMLInputElement | HTMLTextAreaElement).placeholder ?? ""
    )
    const valuePreview = normalize(
      (htmlElement as HTMLInputElement | HTMLTextAreaElement).value ?? ""
    ).slice(0, 120)

    const candidate: RawCandidate = {
      eid: `e${rawCandidates.length + 1}`,
      tagName: element.tagName.toLowerCase(),
      role: htmlElement.getAttribute("role"),
      inputType:
        htmlElement instanceof HTMLInputElement
          ? htmlElement.type || "text"
          : null,
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
      required: getRequired(element),
      maxLength: getMaxLength(element),
      selector: createSelector(element),
      context: nearestContext(element),
      visible: isVisible(element),
      enabled: !(htmlElement as HTMLInputElement | HTMLButtonElement).disabled,
      inViewport: inViewport(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    }

    rawCandidates.push(candidate)
  }

  const visibleTextPreview = Array.from(
    document.querySelectorAll("h1, h2, h3, p, li, [role='heading']")
  )
    .map((item) => normalize(item.textContent ?? ""))
    .filter((value) => value.length >= 8)
    .slice(0, 16)

  return {
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    visibleTextPreview,
    elements: rawCandidates
  }
}

type DomTarget = {
  selector: string
  text: string
  label: string
  tagName: string
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
}

const runDomActionInPage = (payload: DomActionPayload): DomActionResult => {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim()
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

  const resolveElement = (target: DomTarget) => {
    const exact = document.querySelector(target.selector)

    if (exact instanceof HTMLElement && isVisibleElement(exact)) {
      return exact
    }

    const options = Array.from(
      document.querySelectorAll(target.tagName)
    ).filter((option): option is HTMLElement => option instanceof HTMLElement)
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
      return visibleMatch
    }

    if (exact instanceof HTMLElement) {
      return exact
    }

    return findMatch(false)
  }

  try {
    if (payload.kind === "press_key") {
      const activeElement =
        (document.activeElement as HTMLElement | null) ?? document.body
      const targetElement = payload.target
        ? resolveElement(payload.target)
        : activeElement

      if (!targetElement) {
        return { ok: false, details: "Target element not found for key press" }
      }

      targetElement.focus()

      const eventInit = {
        key: payload.key,
        bubbles: true,
        cancelable: true
      }

      targetElement.dispatchEvent(new KeyboardEvent("keydown", eventInit))
      targetElement.dispatchEvent(new KeyboardEvent("keypress", eventInit))
      targetElement.dispatchEvent(new KeyboardEvent("keyup", eventInit))

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
            details: "Pressed key Enter and submitted form"
          }
        }
      }

      return { ok: true, details: `Pressed key ${payload.key}` }
    }

    if (payload.kind === "scroll") {
      const y = payload.direction === "down" ? payload.amount : -payload.amount
      window.scrollBy({
        top: y,
        behavior: "smooth"
      })

      return { ok: true, details: `Scrolled ${payload.direction}` }
    }

    const element = resolveElement(payload.target)

    if (!element) {
      return { ok: false, details: "Target element not found" }
    }

    const requiresVisibleTarget =
      payload.kind === "click" || payload.kind === "type_text"

    if (requiresVisibleTarget && !isVisibleElement(element)) {
      return {
        ok: false,
        details: "Target element is not visible or interactable"
      }
    }

    if (payload.kind === "click") {
      element.scrollIntoView({ block: "center", inline: "center" })
      element.click()
      return { ok: true, details: "Clicked target element" }
    }

    if (payload.kind === "extract_text") {
      const text = normalize(element.innerText || element.textContent || "")

      return {
        ok: true,
        details: text
          ? `Extracted text: ${text.slice(0, 240)}`
          : "Element has no text",
        text
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
            "File input detected; browser security blocks automated file path typing"
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
      return { ok: true, details: "Typed text into target" }
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
      return { ok: true, details: "Typed text into editable element" }
    }

    return { ok: false, details: "Target is not an editable element" }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown page error"

    return {
      ok: false,
      details: `DOM action failed: ${message}`
    }
  }
}

const readSnapshot = async (tabId: number): Promise<PageSnapshot> => {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectSnapshotInPage
  })

  const snapshot = result[0]?.result

  if (!snapshot) {
    throw new Error("Unable to collect page snapshot")
  }

  return snapshot
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

const runElementAction = async (
  tabId: number,
  candidate: ElementCandidate,
  action: AgentAction
) => {
  const target: DomTarget = {
    selector: candidate.selector,
    text: candidate.text,
    label: candidate.label,
    tagName: candidate.tagName
  }

  if (action.type === "click") {
    const rawResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: runDomActionInPage,
      args: [{ kind: "click", target } as DomActionPayload]
    })

    return normalizeDomActionResult(
      rawResult,
      "Click action returned no result"
    )
  }

  if (action.type === "type_text") {
    const rawResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: runDomActionInPage,
      args: [
        {
          kind: "type_text",
          target,
          text: action.text,
          clearFirst: action.clearFirst ?? true
        } as DomActionPayload
      ]
    })

    return normalizeDomActionResult(rawResult, "Type action returned no result")
  }

  const rawResult = await chrome.scripting.executeScript({
    target: { tabId },
    func: runDomActionInPage,
    args: [{ kind: "extract_text", target } as DomActionPayload]
  })

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

const getTypeTextGuardError = (candidate: ElementCandidate, text: string) => {
  if (candidate.inputType === "file") {
    return "File upload input detected; attach files manually before continuing"
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
  candidates: ElementCandidate[]
) => {
  const tabId = session.tabId

  assertRunNotStopped(session)

  if (action.type === "open_url") {
    await chrome.tabs.update(tabId, { url: action.url })
    await waitForTabComplete(tabId)
    assertRunNotStopped(session)
    return { ok: true, details: `Opened ${action.url}` }
  }

  if (action.type === "wait") {
    await waitForInterruptibleDelay(session, action.ms)
    assertRunNotStopped(session)
    return { ok: true, details: `Waited ${action.ms}ms` }
  }

  if (action.type === "press_key") {
    let target: DomTarget | undefined

    if (action.eid) {
      const candidate = candidates.find((item) => item.eid === action.eid)

      if (!candidate) {
        return {
          ok: false,
          details: `Element ${action.eid} not available in snapshot`
        }
      }

      target = {
        selector: candidate.selector,
        text: candidate.text,
        label: candidate.label,
        tagName: candidate.tagName
      }
    }

    const rawResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: runDomActionInPage,
      args: [
        {
          kind: "press_key",
          key: action.key,
          target
        } as DomActionPayload
      ]
    })

    return normalizeDomActionResult(
      rawResult,
      "Key press action returned no result"
    )
  }

  if (action.type === "scroll") {
    const rawResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: runDomActionInPage,
      args: [
        {
          kind: "scroll",
          direction: action.direction,
          amount: action.amount ?? 700
        } as DomActionPayload
      ]
    })

    return normalizeDomActionResult(
      rawResult,
      "Scroll action returned no result"
    )
  }

  if (action.type === "finish") {
    return { ok: true, details: action.message }
  }

  const eid = action.eid
  const candidate = candidates.find((item) => item.eid === eid)

  if (!candidate) {
    return { ok: false, details: `Element ${eid} not available in snapshot` }
  }

  if (action.type === "type_text") {
    const guardError = getTypeTextGuardError(candidate, action.text)

    if (guardError) {
      return {
        ok: false,
        details: guardError
      }
    }
  }

  return runElementAction(tabId, candidate, action)
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
      candidate.text,
      candidate.context,
      candidate.inputType ?? ""
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

const fetchPlan = async (
  session: RunSession,
  snapshot: PageSnapshot,
  history: AgentStepRecord[],
  memory?: PlannerMemoryEntry[]
) => {
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
          memory
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

      return (await response.json()) as AgentPlan
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
    memoryLoaded: false,
    memoryCache: []
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
  let consecutiveActionErrors = 0

  try {
    for (let step = 1; step <= AGENT_MAX_STEPS; step += 1) {
      assertRunNotStopped(session)

      const fullSnapshot = await readSnapshot(session.tabId)
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
        rationale: plan.rationale,
        action: plan.action
      }

      session.runLogSteps.push(runLogStep)

      await emitEvent({
        type: "step_planned",
        runId,
        step,
        action: plan.action,
        rationale: plan.rationale,
        snapshot: snapshotForPlanner
      })

      const actionSignature = `${fullSnapshot.url}|${JSON.stringify(plan.action)}`
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

      if (plan.action.type === "finish") {
        const success =
          plan.action.success ?? inferFinishSuccess(plan.action.message)

        await finalizeRunSession(session, {
          success,
          message: plan.action.message
        })
        return
      }

      if (isSensitiveAction(plan.action, fullSnapshot.elements)) {
        const confirmationReason = "This action appears destructive or final."

        runLogStep.confirmation = {
          required: true,
          reason: confirmationReason,
          approved: null
        }

        await emitEvent({
          type: "confirmation_required",
          runId,
          action: plan.action,
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
        plan.action,
        fullSnapshot.elements
      )
      assertRunNotStopped(session)

      runLogStep.execution = {
        result: execution.ok ? "success" : "error",
        details: execution.details,
        executedAt: new Date().toISOString()
      }

      const record: AgentStepRecord = {
        step,
        action: plan.action,
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
        record
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
