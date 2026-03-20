import type {
  AgentEvent,
  AgentRuntimeMessage,
  AgentStartMessage
} from "~lib/agent/messages"
import { rankCandidates } from "~lib/agent/ranking"
import type {
  AgentAction,
  AgentPlan,
  AgentRunLog,
  AgentRunLogStep,
  AgentStepRecord,
  ElementCandidate,
  PageSnapshot
} from "~lib/agent/types"
import { AGENT_MAX_CANDIDATES, AGENT_MAX_STEPS } from "~lib/agent/types"
import { isSensitiveAction } from "~lib/agent/validation"

type PendingConfirmation = {
  resolve: (approved: boolean) => void
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
}

const sessions = new Map<string, RunSession>()

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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  return "Unknown error"
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
      label: getLabel(element),
      placeholder,
      href: (htmlElement as HTMLAnchorElement).href ?? "",
      valuePreview,
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

const executeAction = async (
  tabId: number,
  action: AgentAction,
  candidates: ElementCandidate[]
) => {
  if (action.type === "open_url") {
    await chrome.tabs.update(tabId, { url: action.url })
    await waitForTabComplete(tabId)
    return { ok: true, details: `Opened ${action.url}` }
  }

  if (action.type === "wait") {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, action.ms)))
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

const fetchPlan = async (
  command: string,
  snapshot: PageSnapshot,
  history: AgentStepRecord[]
) => {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= PLAN_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, PLAN_REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${AGENT_API_BASE}/api/agent/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command,
          snapshot,
          history
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
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
      lastError =
        error instanceof Error ? error : new Error(toErrorMessage(error))

      if (attempt < PLAN_MAX_ATTEMPTS && shouldRetryPlanError(error)) {
        await sleep(PLAN_RETRY_BASE_DELAY_MS * attempt)
        continue
      }

      throw lastError
    } finally {
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
  const response = await fetch(`${AGENT_API_BASE}/api/agent/health`, {
    method: "GET"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Health check failed: ${response.status} ${errorText}`)
  }

  return (await response.json()) as {
    ok: boolean
    hasOpenRouterKey: boolean
    model: string
  }
}

const waitForConfirmation = (session: RunSession) => {
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
    const response = await fetch(`${AGENT_API_BASE}/api/agent/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(runLog),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
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

  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`

  const session: RunSession = {
    runId,
    tabId: tab.id!,
    command: startMessage.command,
    initialUrl: tab.url ?? "",
    startedAt: new Date().toISOString(),
    history: [],
    runLogSteps: [],
    pendingConfirmation: null
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
      const fullSnapshot = await readSnapshot(session.tabId)
      const rankedElements = rankCandidates(
        fullSnapshot.elements,
        session.command,
        AGENT_MAX_CANDIDATES
      )

      const snapshotForPlanner: PageSnapshot = {
        ...fullSnapshot,
        elements: rankedElements
      }

      const plan = await fetchPlan(
        session.command,
        snapshotForPlanner,
        session.history
      )

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

        if (!approved) {
          await finalizeRunSession(session, {
            success: false,
            message: "Action rejected by user"
          })
          return
        }
      }

      const execution = await executeAction(
        session.tabId,
        plan.action,
        fullSnapshot.elements
      )

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

    if (message.type === "agent/confirm") {
      const session = sessions.get(message.runId)

      if (!session || !session.pendingConfirmation) {
        sendResponse({ ok: false, error: "No pending confirmation found" })
        return false
      }

      session.pendingConfirmation.resolve(message.approve)
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

    sendResponse({ ok: false, error: "Unsupported message type" })
    return false
  }
)

export {}
