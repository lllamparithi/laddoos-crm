// ============================================================
// identity_evidence / identity_evidence_policy repository — Phase 2A.
//
// Evidence is append-only: once observed, a piece of evidence is never
// edited, only accumulated. This module therefore never exposes an
// update function — recordIdentityEvidence() is the only write path.
//
// The evidence_type -> confidence/auto_link mapping is NOT re-validated
// here in application code. crm.identity_evidence.evidence_type carries
// a hard FK to crm.identity_evidence_policy (044_identity_evidence.sql);
// the database is the single enforcement point for "no evidence type
// outside the seeded allowlist", exactly as designed — see
// docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §2.3. Duplicating that
// check here would just be a second place to keep in sync with the seed.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import type { IdentityConfidence } from './handles'

export class IdentityEvidenceError extends Error {
  readonly status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'IdentityEvidenceError'
    this.status = status
  }
}

export type EvidenceActorType = 'system' | 'agent' | 'customer'

export interface IdentityEvidenceRow {
  id: string
  account_id: string
  handle_id: string
  contact_id: string | null
  evidence_type: string
  confidence: IdentityConfidence
  observed_at: string
  source_event_id: string | null
  actor_type: EvidenceActorType
  actor_user_id: string | null
  notes: string | null
  expires_at: string | null
}

export interface EvidencePolicyRow {
  evidence_type: string
  max_confidence: IdentityConfidence
  auto_link: boolean
  description: string
}

export interface RecordIdentityEvidenceInput {
  accountId: string
  handleId: string
  evidenceType: string
  confidence: IdentityConfidence
  actorType: EvidenceActorType
  contactId?: string | null
  sourceEventId?: string | null
  actorUserId?: string | null
  notes?: string | null
  expiresAt?: string | null
}

/**
 * Record one piece of evidence. `confidence` is supplied by the caller
 * rather than looked up from the policy table here — the caller
 * (typically a channel-specific ingestion helper, e.g. continuation
 * token redemption) already knows which policy row applies and what
 * confidence that specific observation earned; re-deriving it here would
 * require a second round trip for no added safety, since the FK already
 * guarantees evidence_type is a real, allowed value.
 */
export async function recordIdentityEvidence(
  db: AnySupabaseClient,
  input: RecordIdentityEvidenceInput
): Promise<IdentityEvidenceRow> {
  if (input.actorType === 'agent' && !input.actorUserId) {
    throw new IdentityEvidenceError(
      'actorUserId is required when actorType is "agent"',
      400
    )
  }

  const { data, error } = await db
    .from('identity_evidence')
    .insert({
      account_id: input.accountId,
      handle_id: input.handleId,
      contact_id: input.contactId ?? null,
      evidence_type: input.evidenceType,
      confidence: input.confidence,
      source_event_id: input.sourceEventId ?? null,
      actor_type: input.actorType,
      actor_user_id: input.actorUserId ?? null,
      notes: input.notes ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .select('*')
    .single()

  if (error || !data) {
    // A foreign-key violation here means evidenceType isn't in the
    // policy allowlist — surface that distinctly, it's a caller bug
    // (a hardcoded evidence type typo'd or never seeded), not a runtime
    // data problem.
    if ((error as { code?: string } | null)?.code === '23503') {
      throw new IdentityEvidenceError(
        `Unknown evidence_type "${input.evidenceType}" — not present in identity_evidence_policy`,
        400
      )
    }
    throw new IdentityEvidenceError(
      `Failed to record identity evidence: ${error?.message ?? 'unknown error'}`
    )
  }
  return data as IdentityEvidenceRow
}

export async function getEvidencePolicy(
  db: AnySupabaseClient,
  evidenceType: string
): Promise<EvidencePolicyRow | null> {
  const { data, error } = await db
    .from('identity_evidence_policy')
    .select('*')
    .eq('evidence_type', evidenceType)
    .maybeSingle()

  if (error) {
    throw new IdentityEvidenceError(`Failed to look up evidence policy: ${error.message}`)
  }
  return (data as EvidencePolicyRow | null) ?? null
}

export async function listEvidenceForHandle(
  db: AnySupabaseClient,
  accountId: string,
  handleId: string
): Promise<IdentityEvidenceRow[]> {
  const { data, error } = await db
    .from('identity_evidence')
    .select('*')
    .eq('account_id', accountId)
    .eq('handle_id', handleId)

  if (error) {
    throw new IdentityEvidenceError(`Failed to list identity evidence: ${error.message}`)
  }
  return (data as IdentityEvidenceRow[] | null) ?? []
}
