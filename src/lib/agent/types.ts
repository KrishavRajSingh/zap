export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type ElementCandidate = {
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
  confirmation?: {
    required: boolean
    reason: string
    approved: boolean | null
    resolvedAt?: string
  }
  execution?: {
    result: "success" | "error"
    details: string
    executedAt: string
  }
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

export const AGENT_MAX_STEPS = 16
export const AGENT_MAX_CANDIDATES = 70
