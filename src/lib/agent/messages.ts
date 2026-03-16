import type { AgentAction, AgentStepRecord, PageSnapshot } from "~lib/agent/types"

export type AgentStartMessage = {
  type: "agent/start"
  command: string
}

export type AgentConfirmMessage = {
  type: "agent/confirm"
  runId: string
  approve: boolean
}

export type AgentOpenPanelMessage = {
  type: "agent/open-panel"
}

export type AgentHealthMessage = {
  type: "agent/health"
}

export type AgentRuntimeMessage =
  | AgentStartMessage
  | AgentConfirmMessage
  | AgentOpenPanelMessage
  | AgentHealthMessage

export type AgentEvent =
  | {
      type: "run_started"
      runId: string
      command: string
      url: string
    }
  | {
      type: "step_planned"
      runId: string
      step: number
      action: AgentAction
      rationale: string
      snapshot: PageSnapshot
    }
  | {
      type: "step_result"
      runId: string
      step: number
      record: AgentStepRecord
    }
  | {
      type: "confirmation_required"
      runId: string
      action: AgentAction
      reason: string
    }
  | {
      type: "run_finished"
      runId: string
      success: boolean
      message: string
    }
  | {
      type: "run_error"
      runId: string
      message: string
    }

export type AgentEventEnvelope = {
  type: "agent/event"
  event: AgentEvent
}
