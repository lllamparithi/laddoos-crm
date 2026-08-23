// ============================================================
// conversation_assigned — the one shared decision + dispatch path.
//
// The trigger was selectable in the builder (automation-builder.tsx),
// had metadata (trigger-meta.ts) and even a context field on the engine
// (`agent_id`), but nothing ever dispatched it. A founder could build an
// automation on "Conversation assigned", activate it, and watch it never
// run — no error, no automation_logs row, because the engine only logs
// runs that actually start. This module is that missing dispatch.
//
// Why the dispatcher is injected rather than imported: one of the three
// call sites (`components/inbox/message-thread.tsx`) is a CLIENT
// component. `runAutomationsForTrigger` uses the service-role client and
// is server-only, so importing it here would drag server code into the
// browser bundle. Keeping this module dependency-free lets the client
// import `shouldDispatchConversationAssigned` for the decision and post
// to the existing `/api/automations/engine` route to do the work.
// ============================================================

/**
 * Where the assignment came from.
 *
 * `automation` is the loop guard: an automation whose action assigns a
 * conversation must NOT re-fire `conversation_assigned`, or an assign
 * automation triggers an assign automation forever. Treated as an
 * internal origin and skipped by construction, not by a comment.
 */
export type AssignmentOrigin = 'manual' | 'ai_handoff' | 'automation'

export interface AssignmentChange {
  /** Assignee before the write. `null`/undefined when previously unassigned. */
  previousAgentId?: string | null
  /** Assignee after the write. `null` means the thread was unassigned. */
  nextAgentId?: string | null
  origin: AssignmentOrigin
}

/**
 * Whether this assignment should fire `conversation_assigned`.
 *
 * Pure and dependency-free so both the client component and the server
 * routes reach the identical verdict — the decision must not drift
 * between call sites.
 */
export function shouldDispatchConversationAssigned(
  change: AssignmentChange,
): boolean {
  // Loop guard first: an automation-driven assignment never re-dispatches,
  // whatever else is true about the change.
  if (change.origin === 'automation') return false

  // Unassigning is not an assignment. `conversation_assigned` promises an
  // agent in context (`AutomationContext.agent_id`); firing it with none
  // would hand every condition a null it never expects.
  const next = change.nextAgentId
  if (!next) return false

  // Re-selecting the current assignee is a no-op write. The UI issues one
  // on every dropdown interaction, so without this a founder's automation
  // would fire on clicks that changed nothing.
  if (change.previousAgentId === next) return false

  return true
}

/** Minimal shape of `runAutomationsForTrigger`, injected by the caller. */
export type AutomationDispatcher = (input: {
  accountId: string
  triggerType: 'conversation_assigned'
  contactId?: string | null
  context?: { conversation_id?: string; agent_id?: string }
}) => Promise<void>

export interface DispatchAssignmentInput extends AssignmentChange {
  accountId: string
  conversationId: string
  contactId?: string | null
}

/**
 * Dispatch `conversation_assigned` when the change warrants it.
 *
 * Non-blocking by contract: this resolves even when dispatch throws, so a
 * failing automation can never undo or block an assignment that already
 * committed. Mirrors how the webhook treats automation dispatch — the
 * write is the source of truth, the automation is a side effect.
 *
 * Returns whether a dispatch was attempted, which is what the tests and
 * callers assert on.
 */
export async function dispatchConversationAssigned(
  input: DispatchAssignmentInput,
  dispatch: AutomationDispatcher,
): Promise<boolean> {
  if (!shouldDispatchConversationAssigned(input)) return false

  try {
    await dispatch({
      accountId: input.accountId,
      triggerType: 'conversation_assigned',
      contactId: input.contactId ?? null,
      context: {
        conversation_id: input.conversationId,
        agent_id: input.nextAgentId as string,
      },
    })
  } catch (err) {
    // Swallowed on purpose. The assignment already succeeded; surfacing
    // this to the caller would let a broken automation look like a failed
    // assignment and tempt a rollback of a write the user asked for.
    console.error('[conversation_assigned] dispatch failed:', err)
  }
  return true
}
