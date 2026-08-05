// ============================================================
// continuation_tokens repository — Phase 2A: raw CRUD only.
//
// HMAC signing/verification lives in ./sign.ts; the issue/resolve
// orchestration (which combines signing with these repo calls) lives in
// ./service.ts. This module is the table access layer, kept separate so
// each concern is independently testable — the same three-way split
// src/lib/webhooks/sign.ts (crypto) and src/lib/webhooks/deliver.ts
// (orchestration) already use in this codebase.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'

export class ContinuationTokenError extends Error {
  readonly status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ContinuationTokenError'
    this.status = status
  }
}

export type ContinuationTokenPurpose =
  | 'ig_to_web'
  | 'messenger_to_web'
  | 'web_to_wa'
  | 'email_to_web'
  | 'voice_to_web'

export interface ContinuationTokenRow {
  id: string
  account_id: string
  tenant_id: string
  brand_id: string
  token_hash: string
  purpose: ContinuationTokenPurpose
  origin_channel: string
  origin_conversation_id: string | null
  origin_contact_id: string | null
  origin_handle_id: string | null
  campaign_id: string | null
  ad_id: string | null
  creative_id: string | null
  issued_at: string
  expires_at: string
  max_uses: number
  use_count: number
  first_used_at: string | null
  binds_identity: boolean
  revoked_at: string | null
  revoked_reason: string | null
}

export interface InsertContinuationTokenInput {
  accountId: string
  tenantId: string
  brandId: string
  tokenHash: string
  purpose: ContinuationTokenPurpose
  originChannel: string
  expiresAt: Date
  originConversationId?: string | null
  originContactId?: string | null
  originHandleId?: string | null
  campaignId?: string | null
  adId?: string | null
  creativeId?: string | null
  maxUses?: number
  bindsIdentity?: boolean
}

export async function insertContinuationToken(
  db: AnySupabaseClient,
  input: InsertContinuationTokenInput
): Promise<ContinuationTokenRow> {
  const { data, error } = await db
    .from('continuation_tokens')
    .insert({
      account_id: input.accountId,
      tenant_id: input.tenantId,
      brand_id: input.brandId,
      token_hash: input.tokenHash,
      purpose: input.purpose,
      origin_channel: input.originChannel,
      origin_conversation_id: input.originConversationId ?? null,
      origin_contact_id: input.originContactId ?? null,
      origin_handle_id: input.originHandleId ?? null,
      campaign_id: input.campaignId ?? null,
      ad_id: input.adId ?? null,
      creative_id: input.creativeId ?? null,
      expires_at: input.expiresAt.toISOString(),
      max_uses: input.maxUses ?? 5,
      binds_identity: input.bindsIdentity ?? true,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new ContinuationTokenError(
      `Failed to insert continuation token: ${error?.message ?? 'unknown error'}`
    )
  }
  return data as ContinuationTokenRow
}

export async function getContinuationTokenByHash(
  db: AnySupabaseClient,
  tokenHash: string
): Promise<ContinuationTokenRow | null> {
  const { data, error } = await db
    .from('continuation_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    throw new ContinuationTokenError(`Failed to look up continuation token: ${error.message}`)
  }
  return (data as ContinuationTokenRow | null) ?? null
}

/**
 * Compare-and-swap use_count increment: succeeds only if use_count still
 * equals `expectedCurrentUseCount` at write time, so two near-simultaneous
 * redemptions of the same token can't both believe they were "the first
 * use" — the loser gets null back and the caller re-reads and retries.
 * Same optimistic-locking idiom already used in this codebase for
 * automation_pending_executions (src/app/api/automations/cron/route.ts):
 * `.update({status:'running'}).eq('id', id).eq('status','pending')`.
 * Supabase-js has no server-side `use_count = use_count + 1` expression,
 * so this is the correct way to get atomic-increment semantics without a
 * new database function (out of scope for this pass — see
 * docs/PHASE2_CANONICAL_PLAN.md, which specifies the table only).
 */
export async function recordContinuationTokenUse(
  db: AnySupabaseClient,
  tokenId: string,
  expectedCurrentUseCount: number
): Promise<ContinuationTokenRow | null> {
  const isFirstUse = expectedCurrentUseCount === 0
  const { data, error } = await db
    .from('continuation_tokens')
    .update({
      use_count: expectedCurrentUseCount + 1,
      ...(isFirstUse ? { first_used_at: new Date().toISOString() } : {}),
    })
    .eq('id', tokenId)
    .eq('use_count', expectedCurrentUseCount)
    .select('*')
    .maybeSingle()

  if (error) {
    throw new ContinuationTokenError(`Failed to record continuation token use: ${error.message}`)
  }
  return (data as ContinuationTokenRow | null) ?? null
}

export async function revokeContinuationToken(
  db: AnySupabaseClient,
  tokenId: string,
  reason: string
): Promise<ContinuationTokenRow> {
  const { data, error } = await db
    .from('continuation_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('id', tokenId)
    .select('*')
    .single()

  if (error || !data) {
    throw new ContinuationTokenError(
      `Failed to revoke continuation token: ${error?.message ?? 'not found'}`
    )
  }
  return data as ContinuationTokenRow
}
