import type {
  AgentAction,
  AgentMemoryUpsertInput,
  AgentStepExecution,
  AgentStepRecord,
  PageSnapshot,
  PlannerTraceReference
} from "~lib/agent/types"

export type AgentStartMessage = {
  type: "agent/start"
  command: string
}

export type AgentStopMessage = {
  type: "agent/stop"
  runId: string
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

export type AgentMemoryListMessage = {
  type: "agent/memory/list"
}

export type AgentMemoryUpsertMessage = {
  type: "agent/memory/upsert"
  entry: AgentMemoryUpsertInput
}

export type AgentMemoryDeleteMessage = {
  type: "agent/memory/delete"
  id: string
}

export type AgentAuthSession = {
  accessToken: string
  expiresAt: number | null
  userId: string
  email: string | null
}

export type AgentAuthSessionMessage = {
  type: "agent/auth/session"
  session: AgentAuthSession | null
}

export type AgentRuntimeMessage =
  | AgentStartMessage
  | AgentStopMessage
  | AgentConfirmMessage
  | AgentOpenPanelMessage
  | AgentHealthMessage
  | AgentMemoryListMessage
  | AgentMemoryUpsertMessage
  | AgentMemoryDeleteMessage
  | AgentAuthSessionMessage

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
      planner?: PlannerTraceReference
    }
  | {
      type: "step_result"
      runId: string
      step: number
      record: AgentStepRecord
      execution?: AgentStepExecution
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
  | {
      type: "run_log_saved"
      runId: string
      ok: boolean
      skipped?: boolean
      path?: string
      message: string
    }

export type AgentEventEnvelope = {
  type: "agent/event"
  event: AgentEvent
}
