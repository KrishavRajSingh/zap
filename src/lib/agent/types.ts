export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type PageIframe = {
  src: string
  title: string
  nameAttr: string
  idAttr: string
  visible: boolean
  inViewport: boolean
  contentDocumentAccessible: boolean
  rect: Rect
}

export type PageFrameCapture = {
  strategy: "main_document_only" | "all_frames"
  capturedFrameCount: number
  capturedSubframeCount: number
  discoveredIframeCount: number
  visibleIframeCount: number
  inViewportIframeCount: number
  accessibleIframeCount: number
  likelyMissedIframeContent: boolean
}

export type ElementControlKind =
  | "text"
  | "native_select"
  | "custom_select"
  | "select_option"
  | "radio"
  | "checkbox"
  | "button"
  | "link"
  | "other"

export type ElementPopupState = "closed" | "open" | "unknown"

export type ElementOptionSource = "aria_role" | "generic_popup" | null

export type ElementCandidate = {
  eid: string
  frameId: number
  frameUrl: string
  frameTitle: string
  controlKind: ElementControlKind
  popupState: ElementPopupState
  optionSource: ElementOptionSource
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
  rect: Rect
}

export type PageSnapshot = {
  url: string
  title: string
  timestamp: string
  viewport: {
    width: number
    height: number
  }
  frameCapture: PageFrameCapture
  iframes: PageIframe[]
  visibleTextPreview: string[]
  elements: ElementCandidate[]
}

export type AgentMemoryEntry = {
  id: string
  question: string
  answer: string
  createdAt: string
  updatedAt: string
}

export type AgentMemoryUpsertInput = {
  id?: string
  question: string
  answer: string
}

export type PlannerMemoryEntry = {
  id: string
  question: string
  answer: string
  updatedAt: string
}

export type PlannerTraceRequestMeta = {
  runId: string
  step: number
  attempt: number
}

export type PlannerSnapshotTopCandidate = {
  eid: string
  frameId: number
  frameUrl: string
  frameTitle: string
  controlKind: ElementControlKind
  popupState: ElementPopupState
  optionSource: ElementOptionSource
  tagName: string
  role: string | null
  inputType: string | null
  text: string
  label: string
  questionText: string
  context: string
  selector: string
  visible: boolean
  enabled: boolean
  inViewport: boolean
}

export type PlannerSnapshotSummary = {
  url: string
  title: string
  timestamp: string
  totalCandidates: number
  visibleCandidates: number
  enabledCandidates: number
  inViewportCandidates: number
  editableCandidates: number
  linkCandidates: number
  frameCapture: PageFrameCapture
  iframePreview: PageIframe[]
  visibleTextPreview: string[]
  topCandidates: PlannerSnapshotTopCandidate[]
}

export type PlannerTraceReference = {
  tracePath: string
  snapshotSummary: PlannerSnapshotSummary
}

export type AgentExecutionCandidateSummary = {
  eid: string
  frameId: number
  frameUrl: string
  controlKind: ElementControlKind
  popupState: ElementPopupState
  optionSource: ElementOptionSource
  label: string
  questionText: string
  selector: string
  interactionSelector: string
  ownerControlSelector: string
  popupContainerSelector: string
}

export type AgentExecutionNodeSummary = {
  selector: string
  tagName: string
  idAttr: string
  className: string
  role: string | null
  text: string
  title: string
  ariaLabel: string
  valuePreview: string
  visible: boolean
  rect: Rect
}

export type AgentExecutionPopupSummary = {
  popupState: ElementPopupState
  relatedOptionCount: number
  optionLabels: string[]
}

export type AgentExecutionSnapshotSummary = {
  url: string
  title: string
  timestamp: string
  totalCandidates: number
  visibleCandidates: number
  inViewportCandidates: number
  visibleTextPreview: string[]
  relatedOptions?: AgentExecutionPopupSummary
  target?: {
    popupState: ElementPopupState
    valuePreview: string
    visible: boolean
    inViewport: boolean
  }
}

export type AgentExecutionTrace = {
  actionType: AgentAction["type"]
  requestedCandidate?: AgentExecutionCandidateSummary
  resolvedElement?: AgentExecutionNodeSummary
  interactionElement?: AgentExecutionNodeSummary
  clickTarget?: AgentExecutionNodeSummary
  activeElementBefore?: AgentExecutionNodeSummary
  activeElementAfter?: AgentExecutionNodeSummary
  resolutionStrategy: string[]
  beforeUrl?: string
  afterUrl?: string
  topLevelUrlChanged?: boolean
  popupBefore?: AgentExecutionPopupSummary
  popupAfter?: AgentExecutionPopupSummary
  afterSnapshot?: AgentExecutionSnapshotSummary
}

export type AgentExecutionTraceSummary = {
  resolution: string
  clickedSelector: string
  clickedText: string
  afterUrl: string
  popupAfterState: ElementPopupState
  relatedOptionCount: number
  optionLabels: string[]
}

export type AgentExecutionTraceReference = {
  tracePath: string
  summary: AgentExecutionTraceSummary
}

export type AgentStepExecution = {
  result: "success" | "error"
  details: string
  executedAt: string
  trace?: AgentExecutionTrace | AgentExecutionTraceReference
}

export type AgentAction =
  | {
      type: "open_url"
      url: string
    }
  | {
      type: "click"
      eid: string
    }
  | {
      type: "type_text"
      eid: string
      text: string
      clearFirst?: boolean
    }
  | {
      type: "press_key"
      key: string
      eid?: string
    }
  | {
      type: "scroll"
      direction: "up" | "down"
      amount?: number
    }
  | {
      type: "wait"
      ms: number
    }
  | {
      type: "extract_text"
      eid: string
    }
  | {
      type: "finish"
      message: string
      success?: boolean
    }

export type AgentPlan = {
  rationale: string
  action: AgentAction
}

export type AgentStepRecord = {
  step: number
  action: AgentAction
  result: "success" | "error"
  details: string
}

export type AgentRunLogStep = {
  step: number
  plannedAt: string
  page: {
    url: string
    title: string
    timestamp: string
  }
  rationale: string
  action: AgentAction
  planner?: PlannerTraceReference
  confirmation?: {
    required: boolean
    reason: string
    approved: boolean | null
    resolvedAt?: string
  }
  execution?: AgentStepExecution
}

export type AgentRunLog = {
  runId: string
  command: string
  initialUrl: string
  startedAt: string
  finishedAt: string
  final: {
    success: boolean
    message: string
  }
  steps: AgentRunLogStep[]
}

export const AGENT_MAX_STEPS = 50
export const AGENT_MAX_CANDIDATES = 70
