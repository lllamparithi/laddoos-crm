// ============================================================
// identity_handles repository — Phase 2A.
//
// A handle is an OBSERVATION, never edited beyond the small set of
// governance fields below — see the table comment on crm.identity_handles
// (043_identity_handles.sql) and docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md
// §2. Recording the same (account, type, hash) twice is idempotent by
// design (the unique constraint enforces it); this module's job is to
// make that idempotency painless for callers, the same way
// findExistingContact()/isUniqueViolation() already do for contacts.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

export type IdentityConfidence =
  | 'verified'
  | 'strong'
  | 'probable'
  | 'unknown'
  | 'rejected'

export class IdentityHandleError extends Error {
  readonly status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'IdentityHandleError'
    this.status = status
  }
}

export interface IdentityHandleRow {
  id: string
  account_id: string
  handle_type: string
  channel: string
  handle_value: string | null
  handle_hash: string
  contact_id: string | null
  confidence: IdentityConfidence
  verified_at: string | null
  first_seen_at: string
  last_seen_at: string
  metadata: Record<string, unknown>
}

export interface RecordIdentityHandleInput {
  accountId: string
  handleType: string
  channel: string
  handleHash: string
  /** NULL when PII-minimised to hash only — see the table comment. */
  handleValue?: string | null
  contactId?: string | null
  confidence?: IdentityConfidence
  metadata?: Record<string, unknown>
}

/**
 * Record an observation of a handle. Idempotent: if (account, type, hash)
 * already exists, bumps last_seen_at and returns the existing row rather
 * than erroring — the same race the unique index on contacts (022)
 * exists to resolve, applied here via isUniqueViolation() re-resolution
 * instead of an upsert, so a concurrent duplicate observation never
 * clobbers a confidence/contact_id another writer already set.
 */
export async function recordIdentityHandle(
  db: AnySupabaseClient,
  input: RecordIdentityHandleInput
): Promise<IdentityHandleRow> {
  const { data: created, error } = await db
    .from('identity_handles')
    .insert({
      account_id: input.accountId,
      handle_type: input.handleType,
      channel: input.channel,
      handle_hash: input.handleHash,
      handle_value: input.handleValue ?? null,
      contact_id: input.contactId ?? null,
      confidence: input.confidence ?? 'unknown',
      metadata: input.metadata ?? {},
    })
    .select('*')
    .maybeSingle()

  if (!error && created) return created as IdentityHandleRow

  if (isUniqueViolation(error)) {
    const existing = await getIdentityHandleByHash(
      db,
      input.accountId,
      input.handleType,
      input.handleHash
    )
    if (existing) {
      return touchIdentityHandleLastSeen(db, existing.id)
    }
    throw new IdentityHandleError(
      'Handle insert raced with a duplicate, but the duplicate could not be re-read'
    )
  }

  throw new IdentityHandleError(
    `Failed to record identity handle: ${error?.message ?? 'unknown error'}`
  )
}

export async function getIdentityHandleByHash(
  db: AnySupabaseClient,
  accountId: string,
  handleType: string,
  handleHash: string
): Promise<IdentityHandleRow | null> {
  const { data, error } = await db
    .from('identity_handles')
    .select('*')
    .eq('account_id', accountId)
    .eq('handle_type', handleType)
    .eq('handle_hash', handleHash)
    .maybeSingle()

  if (error) {
    throw new IdentityHandleError(`Failed to look up identity handle: ${error.message}`)
  }
  return (data as IdentityHandleRow | null) ?? null
}

export async function listIdentityHandlesForContact(
  db: AnySupabaseClient,
  accountId: string,
  contactId: string
): Promise<IdentityHandleRow[]> {
  const { data, error } = await db
    .from('identity_handles')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)

  if (error) {
    throw new IdentityHandleError(`Failed to list identity handles: ${error.message}`)
  }
  return (data as IdentityHandleRow[] | null) ?? []
}

export async function touchIdentityHandleLastSeen(
  db: AnySupabaseClient,
  handleId: string
): Promise<IdentityHandleRow> {
  const { data, error } = await db
    .from('identity_handles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', handleId)
    .select('*')
    .single()

  if (error || !data) {
    throw new IdentityHandleError(
      `Failed to update identity handle last_seen_at: ${error?.message ?? 'not found'}`
    )
  }
  return data as IdentityHandleRow
}

/**
 * Governance-only patch. Restricted to confidence/contact_id/verified_at —
 * the fields the table comment names as legitimately mutable. handle_type,
 * channel, handle_hash, handle_value and account_id are never in this
 * type, so a caller cannot accidentally rewrite what was actually
 * observed — the same discipline the DB trigger enforces mechanically
 * on crm.timeline_events, applied here at the type level since this
 * table has no equivalent trigger (see 043's own comment on why not:
 * handle_type is deliberately unconstrained, not a candidate for a
 * blanket immutability trigger the way timeline_events' fixed fact
 * columns are).
 */
export interface IdentityHandleGovernancePatch {
  confidence?: IdentityConfidence
  contactId?: string | null
  verifiedAt?: string | null
}

export async function updateIdentityHandleGovernance(
  db: AnySupabaseClient,
  handleId: string,
  patch: IdentityHandleGovernancePatch
): Promise<IdentityHandleRow> {
  const update: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
  if (patch.confidence !== undefined) update.confidence = patch.confidence
  if (patch.contactId !== undefined) update.contact_id = patch.contactId
  if (patch.verifiedAt !== undefined) update.verified_at = patch.verifiedAt

  const { data, error } = await db
    .from('identity_handles')
    .update(update)
    .eq('id', handleId)
    .select('*')
    .single()

  if (error || !data) {
    throw new IdentityHandleError(
      `Failed to update identity handle: ${error?.message ?? 'not found'}`
    )
  }
  return data as IdentityHandleRow
}
