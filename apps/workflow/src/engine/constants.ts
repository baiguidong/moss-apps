import { cpus } from 'os'

/** Hard cap on Agent node invocations per run — a backstop against runaway loops. */
export const WORKFLOW_MAX_AGENTS = 256

/** A single parallel, foreach, or pipeline container may not fan out wider than this. */
export const WORKFLOW_MAX_FANOUT = 4096

/** Definitions and individual node source fields are capped at 512 KiB. */
export const WORKFLOW_SCRIPT_MAX_BYTES = 524_288

/**
 * Wall-clock budget for one synchronous JavaScript node. Agent execution does
 * not consume it; a `while (true) {}` inside a code node does.
 */
export const WORKFLOW_SYNC_TIMEOUT_MS = 30_000

/** Hard stop for any explicit state-machine back edge. */
export const WORKFLOW_MAX_BACK_EDGE_TRAVERSALS = 100

/** Default wall-clock limit for one Workflow run. */
export const WORKFLOW_DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1_000

/** An agent that emits no progress for this long is reported as stalled. */
export const WORKFLOW_AGENT_STALL_MS = 180_000

/** Prompt/result previews shown in the progress view are clipped to this. */
export const WORKFLOW_PREVIEW_MAX_CHARS = 400

/** Labels are clipped to this when derived from the prompt. */
export const WORKFLOW_LABEL_MAX_CHARS = 60

/** Upper bound on log lines carried in the final result. */
export const WORKFLOW_MAX_COLLECTED_LOGS = 1000

/** Maximum characters retained from one workflow log call. */
export const WORKFLOW_LOG_MAX_CHARS = 2_000

/** Progress rows retained in task state; logs beyond this are dropped first. */
export const WORKFLOW_MAX_PROGRESS_ROWS = 500

/** Progress events are coalesced on this interval before touching AppState. */
export const WORKFLOW_PROGRESS_BATCH_MS = 16

/** Minimum spacing between task-panel progress emissions. */
export const WORKFLOW_PANEL_EMIT_INTERVAL_MS = 10_000

/** Agent type used for every subagent a structured workflow spawns. */
export const WORKFLOW_SUBAGENT_TYPE = 'workflow-subagent'

/** Run ids look like `wf_<8 hex>-<3 hex>`; agent ids append `-<index>`. */
export const WORKFLOW_RUN_ID_PATTERN = /^wf_[a-z0-9-]{6,}$/

/**
 * Concurrency ceiling for in-flight agents. Bounded by CPU count so a fan-out
 * of 500 items does not spawn 500 model streams on a laptop.
 */
export function getWorkflowConcurrency(
  cpuCount: number = cpus().length,
): number {
  return Math.min(16, Math.max(2, cpuCount - 2))
}

export const WORKFLOW_DATE_BANNED_MESSAGE =
  'Date() / Date.now() / new Date() are unavailable in workflow node JavaScript (breaks resume). ' +
  'Stamp results after the workflow returns, or bind a timestamp explicitly into the node input.'

export const WORKFLOW_RANDOM_BANNED_MESSAGE =
  'Math.random() is unavailable in workflow node JavaScript (breaks resume). ' +
  'For N independent samples, include the index in the agent label or prompt.'

export const WORKFLOW_IMPORT_BANNED_MESSAGE =
  'import() is not available in workflow node JavaScript.'

export const WORKFLOW_AGENT_CAP_MESSAGE =
  `Workflow Agent node invocation cap reached (${WORKFLOW_MAX_AGENTS}). ` +
  'Reduce foreach input size or loop traversals before resuming.'

/** System prompt for a workflow subagent that returns free text. */
export const WORKFLOW_SUBAGENT_PROMPT =
  'You are a subagent spawned by a structured workflow. Use the tools available to complete the task.\n' +
  'Do not create other agents, teams, or workflows; orchestration belongs to the parent Definition.\n' +
  'If the task cannot be completed because required inputs, files, access, or prerequisites are missing, return blocked instead of pretending success.\n' +
  'NOTE: You are running as an Agent node in a structured workflow. Your final text response is returned verbatim as a string ' +
  'to the workflow executor — it is your return value, not a message to a human. Output the literal result; do not ' +
  'output confirmations like "Done." Be concise.'

/** System prompt for a workflow subagent forced through StructuredOutput. */
export function workflowStructuredSubagentPrompt(toolName: string): string {
  return (
    'You are a subagent spawned by a structured workflow. Use the tools available to complete the task.\n' +
    'Do not create other agents, teams, or workflows; orchestration belongs to the parent Definition.\n' +
    'If the task cannot be completed because required inputs, files, access, or prerequisites are missing, return status="blocked" with a concrete reason.\n' +
    `- After calling ${toolName} successfully, end your turn. No acknowledgment needed.`
  )
}

/** Appended to a schema-bearing agent prompt so the model uses the tool. */
export function workflowStructuredOutputNote(toolName: string): string {
  return (
    `\nNOTE: You are running as an Agent node in a structured workflow. Return the final answer by calling the ${toolName} ` +
    "tool once the work is complete; its input schema defines the required shape. Use status=completed with output only after the task is actually complete. " +
    'Use status=blocked with a concrete reason when required input, files, access, or prerequisites are missing. Do your work, then call ' +
    `${toolName}; do not add a text acknowledgment. If validation rejects the call, correct the data and retry it.`
  )
}
