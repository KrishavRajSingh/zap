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

export const AGENT_MAX_STEPS = 16
export const AGENT_MAX_CANDIDATES = 70
