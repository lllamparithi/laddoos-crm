// ============================================================
// Timeline → Inbox projection: write path + read model.
//
// The locked split (see 049_channel_threads.sql's header and CLAUDE.md):
// crm.timeline_events is the canonical customer history; the Inbox is an
// operational work queue over it. So a channel thread stores only queue
// state — status, assignment, read position — and message content is
// always DERIVED from timeline_events at read time. Nothing here copies
// a summary, a body or a media reference into channel_threads.
//
// Channels: WhatsApp keeps crm.conversations untouched. Instagram and
// Messenger (and any future handle-keyed channel) live here. The Inbox
// UI unions the two sources; this module owns only the second.
//
// IDENTITY RULE: projectTimelineEventToThread() cannot link a Contact.
// The SQL function it calls takes no contact_id parameter, and nothing
// in this file writes channel_threads.contact_id. Linking a handle to a
// Contact is a human-approved decision made through the identity
// machinery — never a side effect of a message arriving.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'

/** Channels whose threads live in channel_threads, not conversations. */
export const HANDLE_KEYED_CHANNELS = ['instagram', 'messenger'] as const
export type HandleKeyedChannel = (typeof HANDLE_KEYED_CHANNELS)[number]

export type ChannelThreadStatus = 'open' | 'pending' | 'closed'

/** Event types that count toward unread. Outbound never does. */
const INBOUND_EVENT_TYPE = 'message.inbound'

/**
 * Event types a thread's history shows. Deliberately message-only:
 * a thread is a conversation, not the customer's whole timeline. The
 * full cross-channel history stays on the Contact Timeline tab, which
 * already reads every event type via the handle union.
 */
const THREAD_HISTORY_EVENT_TYPES = ['message.inbound', 'message.outbound'] as const

export class ChannelThreadError extends Error {
  readonly status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ChannelThreadError'
    this.status = status
  }
}

export interface ChannelThreadRow {
  id: string
  account_id: string
  channel: string
  handle_id: string
  contact_id: string | null
  status: ChannelThreadStatus
  assigned_agent_id: string | null
  last_activity_at: string
  last_read_at: string | null
  created_at: string
  updated_at: string
}

// ── Write path ───────────────────────────────────────────────

export interface ProjectTimelineEventInput {
  accountId: string
  channel: string
  handleId: string
  /**
   * The event's occurred_at — payload-derived, never the clock. The SQL
   * function advances last_activity_at with GREATEST, so replaying an
   * older event cannot drag the thread backwards in the list.
   */
  occurredAt: Date
}

/**
 * Idempotent. Creates the thread if absent, otherwise advances its
 * activity time. Safe to call for every inbound event, including
 * redelivered ones: the fact layer already dedupes on
 * (account_id, dedupe_key, occurred_at), and this upsert is keyed on
 * (account_id, channel, handle_id), so a replay produces no new row and
 * no observable change.
 *
 * Returns the thread id. Throws if the handle belongs to a different
 * account — the SQL function performs that check because the projection
 * runs under the service-role client, which bypasses RLS entirely.
 */
export async function projectTimelineEventToThread(
  db: AnySupabaseClient,
  input: ProjectTimelineEventInput
): Promise<string> {
  const { data, error } = await db.rpc('upsert_channel_thread', {
    p_account_id: input.accountId,
    p_channel: input.channel,
    p_handle_id: input.handleId,
    p_occurred_at: input.occurredAt.toISOString(),
  })

  if (error) {
    throw new ChannelThreadError(
      `Failed to project timeline event to a channel thread: ${error.message}`
    )
  }
  if (!data) {
    throw new ChannelThreadError(
      'upsert_channel_thread returned no thread id — the projection did not run'
    )
  }
  return data as string
}

// ── Read model ───────────────────────────────────────────────

export interface ChannelThreadListItem {
  thread: ChannelThreadRow
  /** Newest message summary. Derived — never stored on the thread. */
  preview: string | null
  /** Inbound events since last_read_at. Derived, not a counter. */
  unreadCount: number
  /**
   * The handle's raw channel identifier, for display when no Contact is
   * linked yet. An opaque scoped id, not a human name — the UI should
   * treat it as a fallback label, not an identity claim.
   */
  handleValue: string | null
  contactId: string | null
}

export interface ListChannelThreadsOptions {
  /** Restrict to one channel. Omit for every handle-keyed channel. */
  channel?: string
  status?: ChannelThreadStatus
  /** Keyset cursor: return threads strictly older than this. */
  before?: Date
  limit?: number
}

const DEFAULT_THREAD_LIMIT = 30

/**
 * Thread list for the Inbox, newest activity first, keyset-paginated.
 *
 * Reads under the caller's own client. With the browser client that is
 * RLS-enforced by channel_threads_select (is_account_member), which is
 * the same predicate already proven client-safe for timeline_events by
 * /hub and the Contact Timeline tab. accountId is still passed and
 * filtered explicitly rather than relying on RLS alone — defence in
 * depth, and it makes the service-role path (which bypasses RLS) correct
 * by construction instead of by accident.
 */
export async function listChannelThreads(
  db: AnySupabaseClient,
  accountId: string,
  options: ListChannelThreadsOptions = {}
): Promise<ChannelThreadListItem[]> {
  const limit = options.limit ?? DEFAULT_THREAD_LIMIT

  let query = db
    .from('channel_threads')
    .select('*')
    .eq('account_id', accountId)

  if (options.channel) query = query.eq('channel', options.channel)
  if (options.status) query = query.eq('status', options.status)
  if (options.before) query = query.lt('last_activity_at', options.before.toISOString())

  const { data, error } = await query
    .order('last_activity_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new ChannelThreadError(`Failed to list channel threads: ${error.message}`)
  }

  const threads = (data as ChannelThreadRow[] | null) ?? []
  if (threads.length === 0) return []

  // Derive preview + unread per thread. Kept as explicit per-thread reads
  // rather than one clever aggregate so the account filter is applied
  // uniformly and each thread's isolation is obvious at the call site.
  // ponytail: N+1 over a page of 30; if the thread list ever paginates
  // deeper or the Inbox grows past a few hundred threads, replace with a
  // single lateral-join view rather than widening this loop.
  return Promise.all(
    threads.map(async (thread) => {
      const [preview, unreadCount, handleValue] = await Promise.all([
        fetchThreadPreview(db, accountId, thread.handle_id),
        countUnreadForThread(db, accountId, thread.handle_id, thread.last_read_at),
        fetchHandleValue(db, accountId, thread.handle_id),
      ])
      return {
        thread,
        preview,
        unreadCount,
        handleValue,
        contactId: thread.contact_id,
      }
    })
  )
}

async function fetchThreadPreview(
  db: AnySupabaseClient,
  accountId: string,
  handleId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('timeline_events')
    .select('summary')
    .eq('account_id', accountId)
    .eq('handle_id', handleId)
    .in('event_type', THREAD_HISTORY_EVENT_TYPES)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new ChannelThreadError(`Failed to read thread preview: ${error.message}`)
  }
  return (data as { summary?: string } | null)?.summary ?? null
}

async function countUnreadForThread(
  db: AnySupabaseClient,
  accountId: string,
  handleId: string,
  lastReadAt: string | null
): Promise<number> {
  let query = db
    .from('timeline_events')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('handle_id', handleId)
    .eq('event_type', INBOUND_EVENT_TYPE)

  // NULL last_read_at means nothing has been read, so every inbound
  // event counts — not zero.
  if (lastReadAt) query = query.gt('occurred_at', lastReadAt)

  const { count, error } = await query
  if (error) {
    throw new ChannelThreadError(`Failed to count unread events: ${error.message}`)
  }
  return count ?? 0
}

async function fetchHandleValue(
  db: AnySupabaseClient,
  accountId: string,
  handleId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('identity_handles')
    .select('handle_value')
    .eq('account_id', accountId)
    .eq('id', handleId)
    .maybeSingle()

  if (error) {
    throw new ChannelThreadError(`Failed to read handle: ${error.message}`)
  }
  return (data as { handle_value?: string | null } | null)?.handle_value ?? null
}

// ── Thread history ───────────────────────────────────────────

export interface ThreadHistoryEvent {
  id: string
  event_type: string
  channel: string
  source: string
  occurred_at: string
  summary: string
  payload_ref: Record<string, unknown>
}

export interface ListThreadHistoryOptions {
  /** Keyset cursor: events strictly older than this. */
  before?: Date
  limit?: number
}

const DEFAULT_HISTORY_LIMIT = 50

/**
 * Full channel history for one thread, newest first, keyset-paginated.
 *
 * Reads timeline_events by handle_id — the immutable fact key — so
 * history is complete regardless of whether a Contact is linked, and
 * linking later adds nothing here because it was never filtered on
 * contact_id in the first place.
 *
 * Served by 045's idx_timeline_handle_time (handle_id, occurred_at DESC);
 * no new index was needed.
 */
export async function listThreadHistory(
  db: AnySupabaseClient,
  accountId: string,
  handleId: string,
  options: ListThreadHistoryOptions = {}
): Promise<ThreadHistoryEvent[]> {
  let query = db
    .from('timeline_events')
    .select('id, event_type, channel, source, occurred_at, summary, payload_ref')
    .eq('account_id', accountId)
    .eq('handle_id', handleId)
    .in('event_type', THREAD_HISTORY_EVENT_TYPES)

  if (options.before) query = query.lt('occurred_at', options.before.toISOString())

  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .limit(options.limit ?? DEFAULT_HISTORY_LIMIT)

  if (error) {
    throw new ChannelThreadError(`Failed to read thread history: ${error.message}`)
  }
  return (data as ThreadHistoryEvent[] | null) ?? []
}

// ── Operational mutations ────────────────────────────────────

/**
 * Mark a thread read up to a point in time. Idempotent and monotonic:
 * an older timestamp never rewinds the read position, so a retried or
 * out-of-order call cannot resurrect already-read messages.
 */
export async function markThreadRead(
  db: AnySupabaseClient,
  accountId: string,
  threadId: string,
  readAt: Date = new Date()
): Promise<ChannelThreadRow> {
  const { data: existing, error: readError } = await db
    .from('channel_threads')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', threadId)
    .maybeSingle()

  if (readError) {
    throw new ChannelThreadError(`Failed to load thread: ${readError.message}`)
  }
  if (!existing) {
    throw new ChannelThreadError('Thread not found in this account', 404)
  }

  const current = existing as ChannelThreadRow
  if (current.last_read_at && new Date(current.last_read_at) >= readAt) {
    return current
  }

  const { data, error } = await db
    .from('channel_threads')
    .update({ last_read_at: readAt.toISOString() })
    .eq('account_id', accountId)
    .eq('id', threadId)
    .select('*')
    .single()

  if (error || !data) {
    throw new ChannelThreadError(
      `Failed to mark thread read: ${error?.message ?? 'not found'}`
    )
  }
  return data as ChannelThreadRow
}

/**
 * Operational state only — status and assignment. Deliberately cannot
 * set contact_id: linking an identity is a human-approved decision made
 * through the identity machinery, not an inbox action. Adding contactId
 * to this patch type would silently reintroduce auto-linking.
 */
export interface ChannelThreadOperationalPatch {
  status?: ChannelThreadStatus
  assignedAgentId?: string | null
}

export async function updateChannelThreadState(
  db: AnySupabaseClient,
  accountId: string,
  threadId: string,
  patch: ChannelThreadOperationalPatch
): Promise<ChannelThreadRow> {
  const update: Record<string, unknown> = {}
  if (patch.status !== undefined) update.status = patch.status
  if (patch.assignedAgentId !== undefined) update.assigned_agent_id = patch.assignedAgentId

  if (Object.keys(update).length === 0) {
    throw new ChannelThreadError('No operational fields supplied', 400)
  }

  const { data, error } = await db
    .from('channel_threads')
    .update(update)
    .eq('account_id', accountId)
    .eq('id', threadId)
    .select('*')
    .single()

  if (error || !data) {
    throw new ChannelThreadError(
      `Failed to update thread state: ${error?.message ?? 'not found'}`,
      error ? 500 : 404
    )
  }
  return data as ChannelThreadRow
}
