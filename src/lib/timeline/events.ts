// ============================================================
// timeline_events repository — Phase 2A.
//
// Facts (event_type, occurred_at, channel, source, summary, payload_ref,
// handle_id, dedupe_key) are immutable once written — enforced by
// trg_timeline_events_immutable (045_timeline_events.sql). This module
// never exposes a way to edit them; recordTimelineEvent() only inserts,
// and the governance update function's patch type is restricted to the
// columns the trigger actually allows to change.
//
// dedupe_key + occurred_at is the idempotency guarantee (a composite
// UNIQUE constraint, not just dedupe_key alone — see 045's header
// comment on why occurred_at had to join both the primary key and this
// constraint for future partitioning readiness). A genuine webhook retry
// of the same event always carries the same occurred_at, so this never
// weakens the practical dedup guarantee — see docs/PHASE2_CANONICAL_PLAN.md §3.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

export type TimelineConfidence = 'verified' | 'strong' | 'probable' | 'unknown' | 'rejected'
export type TimelineVisibility = 'team' | 'restricted' | 'sensitive' | 'system'
export type TimelineActionState = 'none' | 'open' | 'snoozed' | 'done' | 'dismissed'

export class TimelineEventError extends Error {
  readonly status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'TimelineEventError'
    this.status = status
  }
}

export interface TimelineEventRow {
  id: string
  account_id: string
  tenant_id: string
  brand_id: string
  handle_id: string | null
  contact_id: string | null
  customer_id: string | null
  event_type: string
  channel: string
  source: string
  occurred_at: string
  recorded_at: string
  conversation_id: string | null
  session_id: string | null
  campaign_id: string | null
  ad_id: string | null
  creative_id: string | null
  summary: string
  payload_ref: Record<string, unknown>
  payload_hash: string | null
  confidence: TimelineConfidence
  visibility: TimelineVisibility
  owner_user_id: string | null
  action_state: TimelineActionState
  snoozed_until: string | null
  corrects_event_id: string | null
  dedupe_key: string
  created_by: string | null
}

export interface RecordTimelineEventInput {
  accountId: string
  tenantId: string
  brandId: string
  eventType: string
  channel: string
  source: string
  summary: string
  dedupeKey: string
  /** Defaults to now() — pass an explicit value for a historical/batched event. */
  occurredAt?: Date
  handleId?: string | null
  contactId?: string | null
  customerId?: string | null
  conversationId?: string | null
  sessionId?: string | null
  campaignId?: string | null
  adId?: string | null
  creativeId?: string | null
  payloadRef?: Record<string, unknown>
  payloadHash?: string | null
  confidence?: TimelineConfidence
  visibility?: TimelineVisibility
  createdBy?: string | null
}

/**
 * Insert one timeline event. Idempotent: a replayed dedupe_key (same
 * key, same occurred_at — the genuine-retry case) re-fetches and returns
 * the row that already exists rather than throwing, mirroring
 * addContactTagIfAbsent()'s treatment of 23505 as a successful no-op.
 * A dedupe_key collision at a DIFFERENT occurred_at is a caller bug
 * (two unrelated events sharing a key) and is NOT swallowed — it
 * surfaces as a real error.
 */
export async function recordTimelineEvent(
  db: AnySupabaseClient,
  input: RecordTimelineEventInput
): Promise<TimelineEventRow> {
  const occurredAt = (input.occurredAt ?? new Date()).toISOString()

  const { data, error } = await db
    .from('timeline_events')
    .insert({
      account_id: input.accountId,
      tenant_id: input.tenantId,
      brand_id: input.brandId,
      handle_id: input.handleId ?? null,
      contact_id: input.contactId ?? null,
      customer_id: input.customerId ?? null,
      event_type: input.eventType,
      channel: input.channel,
      source: input.source,
      occurred_at: occurredAt,
      conversation_id: input.conversationId ?? null,
      session_id: input.sessionId ?? null,
      campaign_id: input.campaignId ?? null,
      ad_id: input.adId ?? null,
      creative_id: input.creativeId ?? null,
      summary: input.summary,
      payload_ref: input.payloadRef ?? {},
      payload_hash: input.payloadHash ?? null,
      confidence: input.confidence ?? 'verified',
      dedupe_key: input.dedupeKey,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .maybeSingle()

  if (!error && data) return data as TimelineEventRow

  if (isUniqueViolation(error)) {
    const { data: existing, error: refetchError } = await db
      .from('timeline_events')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('dedupe_key', input.dedupeKey)
      .eq('occurred_at', occurredAt)
      .maybeSingle()

    if (existing) return existing as TimelineEventRow
    throw new TimelineEventError(
      `dedupe_key "${input.dedupeKey}" raced with a duplicate, but the ` +
        `duplicate could not be re-read at the same occurred_at: ${refetchError?.message ?? 'not found'}`
    )
  }

  if ((error as { code?: string } | null)?.code === '23503') {
    throw new TimelineEventError(
      `Unknown event_type "${input.eventType}" or a dangling reference — ` +
        `not present in timeline_event_types or a related table`,
      400
    )
  }

  throw new TimelineEventError(
    `Failed to record timeline event: ${error?.message ?? 'unknown error'}`
  )
}

export interface ListTimelineEventsOptions {
  limit?: number
  /** Only events strictly before this timestamp — for cursor pagination. */
  before?: Date
}

export async function listTimelineEventsForContact(
  db: AnySupabaseClient,
  accountId: string,
  contactId: string,
  opts: ListTimelineEventsOptions = {}
): Promise<TimelineEventRow[]> {
  let query = db
    .from('timeline_events')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .limit(opts.limit ?? 50)

  if (opts.before) {
    query = query.lt('occurred_at', opts.before.toISOString())
  }

  const { data, error } = await query
  if (error) {
    throw new TimelineEventError(`Failed to list timeline events: ${error.message}`)
  }
  return (data as TimelineEventRow[] | null) ?? []
}

/**
 * Governance-only patch — restricted to exactly the columns
 * trg_timeline_events_immutable (045) allows to change. Extending this
 * type to include a fact column (event_type, occurred_at, channel,
 * source, summary, payload_ref, handle_id, dedupe_key) would compile,
 * but the UPDATE would fail at the trigger — record a correction event
 * via recordTimelineEvent() instead, per the table's own design.
 */
export interface TimelineEventGovernancePatch {
  contactId?: string | null
  customerId?: string | null
  actionState?: TimelineActionState
  snoozedUntil?: string | null
  ownerUserId?: string | null
  visibility?: TimelineVisibility
}

export async function updateTimelineEventGovernance(
  db: AnySupabaseClient,
  eventId: string,
  patch: TimelineEventGovernancePatch
): Promise<TimelineEventRow> {
  const update: Record<string, unknown> = {}
  if (patch.contactId !== undefined) update.contact_id = patch.contactId
  if (patch.customerId !== undefined) update.customer_id = patch.customerId
  if (patch.actionState !== undefined) update.action_state = patch.actionState
  if (patch.snoozedUntil !== undefined) update.snoozed_until = patch.snoozedUntil
  if (patch.ownerUserId !== undefined) update.owner_user_id = patch.ownerUserId
  if (patch.visibility !== undefined) update.visibility = patch.visibility

  const { data, error } = await db
    .from('timeline_events')
    .update(update)
    .eq('id', eventId)
    .select('*')
    .single()

  if (error || !data) {
    throw new TimelineEventError(
      `Failed to update timeline event: ${error?.message ?? 'not found'}`
    )
  }
  return data as TimelineEventRow
}
