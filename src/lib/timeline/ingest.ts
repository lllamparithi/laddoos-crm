// ============================================================
// Channel ingestion helpers — web, Instagram and Messenger.
//
// Each function here knows one channel's dedupe_key convention (see
// docs/PHASE2_UNIFIED_TIMELINE_SPEC.md §6) and event_type choices, and
// delegates the actual write to recordTimelineEvent(). Phase 2C adds
// its own sibling function (voice) when that channel exists — this file
// stays scoped to the channels that actually write today.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import {
  recordTimelineEvent,
  type TimelineEventRow,
  type TimelineConfidence,
} from './events'

export class TimelineIngestError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TimelineIngestError'
    this.status = status
  }
}

interface TenancyContext {
  accountId: string
  tenantId: string
  brandId: string
}

// ── Website ──────────────────────────────────────────────────

export type WebEventType =
  | 'web.visit'
  | 'web.page_view'
  | 'web.chat_started'
  | 'web.chat_turn'
  | 'web.form_submitted'

// 'web.visit' is idempotent per session by design (the first page load
// of a session is a singleton fact) and needs no per-call discriminator.
// Every other web event type can legitimately repeat many times within
// one session, so the caller must supply a stable per-event id (e.g. a
// client-generated UUID retried unchanged on network failure) — without
// one, a real retry and a genuinely new second event would be
// indistinguishable.
const WEB_EVENT_TYPES_REQUIRING_DEDUPE_SUFFIX: ReadonlySet<WebEventType> = new Set([
  'web.page_view',
  'web.chat_started',
  'web.chat_turn',
  'web.form_submitted',
])

export interface RecordWebEventInput extends TenancyContext {
  eventType: WebEventType
  /**
   * The web SDK's own client-generated session id — NOT the same thing
   * as TimelineEventRow.session_id, which is reserved for
   * public.sessions.id (brain-owned, unused in Phase 2A). Stored in
   * payload_ref, not the session_id column, to avoid conflating the two.
   */
  webSessionId: string
  summary: string
  handleId?: string | null
  contactId?: string | null
  /** Required for every eventType except 'web.visit' — see the note above. */
  dedupeSuffix?: string
  campaignId?: string | null
  adId?: string | null
  creativeId?: string | null
  payloadRef?: Record<string, unknown>
  confidence?: TimelineConfidence
  occurredAt?: Date
}

export async function recordWebEvent(
  db: AnySupabaseClient,
  input: RecordWebEventInput
): Promise<TimelineEventRow> {
  if (
    WEB_EVENT_TYPES_REQUIRING_DEDUPE_SUFFIX.has(input.eventType) &&
    !input.dedupeSuffix
  ) {
    throw new TimelineIngestError(
      `dedupeSuffix is required for eventType "${input.eventType}" — it can repeat within a session and needs a stable per-event id to dedupe retries correctly`
    )
  }

  const dedupeKey =
    input.eventType === 'web.visit'
      ? `web:${input.webSessionId}:visit`
      : `web:${input.webSessionId}:${input.eventType}:${input.dedupeSuffix}`

  return recordTimelineEvent(db, {
    accountId: input.accountId,
    tenantId: input.tenantId,
    brandId: input.brandId,
    eventType: input.eventType,
    channel: 'web',
    source: 'web_sdk',
    summary: input.summary,
    dedupeKey,
    occurredAt: input.occurredAt,
    handleId: input.handleId,
    contactId: input.contactId,
    sessionId: undefined, // public.sessions.id (brain-owned) — Phase 2A has no brain session yet
    campaignId: input.campaignId,
    adId: input.adId,
    creativeId: input.creativeId,
    payloadRef: { ...(input.payloadRef ?? {}), web_session_id: input.webSessionId },
    confidence: input.confidence,
  })
}

// ── Instagram ────────────────────────────────────────────────

export interface RecordInstagramMessageEventInput extends TenancyContext {
  direction: 'inbound' | 'outbound'
  /** Meta's own message id — the dedupe key source (ig:<mid>). */
  igMessageId: string
  summary: string
  handleId?: string | null
  contactId?: string | null
  conversationId?: string | null
  /** Defaults to 'meta_webhook' for inbound, 'agent' for outbound. */
  source?: string
  payloadRef?: Record<string, unknown>
  confidence?: TimelineConfidence
  occurredAt?: Date
}

export async function recordInstagramMessageEvent(
  db: AnySupabaseClient,
  input: RecordInstagramMessageEventInput
): Promise<TimelineEventRow> {
  return recordTimelineEvent(db, {
    accountId: input.accountId,
    tenantId: input.tenantId,
    brandId: input.brandId,
    eventType: input.direction === 'inbound' ? 'message.inbound' : 'message.outbound',
    channel: 'instagram',
    source: input.source ?? (input.direction === 'inbound' ? 'meta_webhook' : 'agent'),
    summary: input.summary,
    dedupeKey: `ig:${input.igMessageId}`,
    occurredAt: input.occurredAt,
    handleId: input.handleId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    payloadRef: { ...(input.payloadRef ?? {}), ig_message_id: input.igMessageId },
    confidence: input.confidence,
  })
}

// ── Messenger ────────────────────────────────────────────────

export interface RecordMessengerMessageEventInput extends TenancyContext {
  direction: 'inbound' | 'outbound'
  /** Meta's own message id — the dedupe key source (messenger:<mid>). */
  messengerMessageId: string
  summary: string
  handleId?: string | null
  contactId?: string | null
  conversationId?: string | null
  /** Defaults to 'meta_webhook' for inbound, 'agent' for outbound. */
  source?: string
  payloadRef?: Record<string, unknown>
  confidence?: TimelineConfidence
  /**
   * Required, unlike the Instagram sibling. dedupe_key alone is not the
   * idempotency key — the constraint is (account_id, dedupe_key,
   * occurred_at) — so defaulting to now() would let a replayed webhook
   * land a second row under the same key at a different timestamp. The
   * Messenger caller derives this from the payload, never the clock.
   */
  occurredAt: Date
}

export async function recordMessengerMessageEvent(
  db: AnySupabaseClient,
  input: RecordMessengerMessageEventInput
): Promise<TimelineEventRow> {
  return recordTimelineEvent(db, {
    accountId: input.accountId,
    tenantId: input.tenantId,
    brandId: input.brandId,
    eventType: input.direction === 'inbound' ? 'message.inbound' : 'message.outbound',
    channel: 'messenger',
    source: input.source ?? (input.direction === 'inbound' ? 'meta_webhook' : 'agent'),
    summary: input.summary,
    dedupeKey: `messenger:${input.messengerMessageId}`,
    occurredAt: input.occurredAt,
    handleId: input.handleId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    payloadRef: {
      ...(input.payloadRef ?? {}),
      messenger_message_id: input.messengerMessageId,
    },
    confidence: input.confidence,
  })
}
