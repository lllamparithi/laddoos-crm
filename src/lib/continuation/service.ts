// ============================================================
// Continuation-token issue/resolve service — Phase 2A.
//
// Combines ./sign.ts (pure HMAC) with ./tokens.ts (repo) into the two
// operations described in docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md
// §4: issue (Instagram bot sends a tracked link) and resolve (the
// website's server-side route resolves ?yali_ref=<token>).
//
// Phase 2A only ever issues 'ig_to_web' tokens (see 046_continuation_tokens.sql's
// header comment) — issueContinuationToken() accepts any purpose because
// the table does, but nothing in this pass's scope calls it with
// anything but 'ig_to_web'. Resolution logic is purpose-agnostic.
// ============================================================

import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import {
  generateTokenId,
  buildContinuationTokenRef,
  verifyContinuationTokenRef,
  hashTokenId,
} from './sign'
import {
  insertContinuationToken,
  getContinuationTokenByHash,
  recordContinuationTokenUse,
  revokeContinuationToken,
  type ContinuationTokenPurpose,
  type ContinuationTokenRow,
} from './tokens'

export class ContinuationServiceError extends Error {
  readonly status: number
  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ContinuationServiceError'
    this.status = status
  }
}

// Default TTL by purpose, per docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md
// §4.2 — "configurable, not hardcoded" there means per-account policy is a
// future refinement (Phase 2B+); these are the reviewed defaults, not a
// magic-number shortcut. messenger_to_web has no explicit default in the
// design doc; treated the same as ig_to_web since both are ad-DM origins.
const DEFAULT_TTL_MS: Record<ContinuationTokenPurpose, number> = {
  ig_to_web: 7 * 24 * 60 * 60 * 1000,
  messenger_to_web: 7 * 24 * 60 * 60 * 1000,
  web_to_wa: 60 * 60 * 1000,
  email_to_web: 30 * 24 * 60 * 60 * 1000,
  voice_to_web: 15 * 60 * 1000,
}

function resolveSigningSecret(explicit?: string): string {
  const secret = explicit ?? process.env.CONTINUATION_TOKEN_SIGNING_KEY
  if (!secret) {
    throw new ContinuationServiceError(
      'CONTINUATION_TOKEN_SIGNING_KEY is not set — refusing to issue or resolve tokens. ' +
        'Fail closed: an unset signing key must never silently produce unsigned or ' +
        'unverifiable refs.'
    )
  }
  return secret
}

export interface IssueContinuationTokenInput {
  accountId: string
  tenantId: string
  brandId: string
  purpose: ContinuationTokenPurpose
  originChannel: string
  originConversationId?: string | null
  originContactId?: string | null
  originHandleId?: string | null
  campaignId?: string | null
  adId?: string | null
  creativeId?: string | null
  maxUses?: number
  bindsIdentity?: boolean
  ttlMs?: number
  /** Explicit clock for deterministic tests — defaults to Date.now(). */
  now?: Date
}

export interface IssuedContinuationToken {
  /** The opaque ref to embed as ?yali_ref=<ref> — never store this raw value. */
  ref: string
  id: string
  expiresAt: string
}

export async function issueContinuationToken(
  db: AnySupabaseClient,
  input: IssueContinuationTokenInput,
  opts: { secret?: string } = {}
): Promise<IssuedContinuationToken> {
  const secret = resolveSigningSecret(opts.secret)
  const now = input.now ?? new Date()
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS[input.purpose]
  const expiresAt = new Date(now.getTime() + ttlMs)

  const tokenId = generateTokenId()
  const ref = buildContinuationTokenRef(tokenId, secret)
  const tokenHash = hashTokenId(tokenId)

  const row = await insertContinuationToken(db, {
    accountId: input.accountId,
    tenantId: input.tenantId,
    brandId: input.brandId,
    tokenHash,
    purpose: input.purpose,
    originChannel: input.originChannel,
    expiresAt,
    originConversationId: input.originConversationId,
    originContactId: input.originContactId,
    originHandleId: input.originHandleId,
    campaignId: input.campaignId,
    adId: input.adId,
    creativeId: input.creativeId,
    maxUses: input.maxUses,
    bindsIdentity: input.bindsIdentity,
  })

  return { ref, id: row.id, expiresAt: row.expires_at }
}

export interface ResolveContinuationTokenResult {
  ok: boolean
  /** Only present when ok === true. */
  token?: {
    id: string
    purpose: ContinuationTokenPurpose
    originChannel: string
    originConversationId: string | null
    originContactId: string | null
    originHandleId: string | null
    campaignId: string | null
    adId: string | null
    creativeId: string | null
    bindsIdentity: boolean
    /**
     * True only for the very first successful redemption. Per
     * docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §4.1 step 6 and
     * §4.3: identity binds ONLY on first use. A caller must gate any
     * identity-linking action on this flag — every other field above is
     * safe to use for attribution regardless of isFirstUse.
     */
    isFirstUse: boolean
  }
}

const NOT_OK: ResolveContinuationTokenResult = { ok: false }

// Bounded retry for the compare-and-swap race in recordContinuationTokenUse —
// see that function's own comment. 3 attempts is generous for a single
// HTTP request's worth of genuinely concurrent redemptions.
const MAX_CAS_ATTEMPTS = 3

/**
 * Resolve a presented ref. Every rejection reason — malformed, bad
 * signature, not found, expired, revoked, exhausted, wrong tenant/brand —
 * returns the identical `{ ok: false }`, on purpose: distinguishing them
 * would turn this endpoint into an oracle an attacker could use to probe
 * which refs are "close" to valid. See
 * docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §11 (T2) and §12.
 */
export async function resolveContinuationToken(
  db: AnySupabaseClient,
  ref: string,
  servingTenantId: string,
  servingBrandId: string,
  opts: { secret?: string; now?: Date } = {}
): Promise<ResolveContinuationTokenResult> {
  const secret = resolveSigningSecret(opts.secret)
  const now = opts.now ?? new Date()

  // Steps 1-2: parse + verify HMAC. No DB hit on failure.
  const tokenId = verifyContinuationTokenRef(ref, secret)
  if (!tokenId) return NOT_OK

  // Step 3: hash lookup.
  const tokenHash = hashTokenId(tokenId)
  const row = await getContinuationTokenByHash(db, tokenHash)
  if (!row) return NOT_OK

  // Step 4: revoked / expired / exhausted.
  if (row.revoked_at !== null) return NOT_OK
  if (new Date(row.expires_at).getTime() <= now.getTime()) return NOT_OK
  if (row.use_count >= row.max_uses) return NOT_OK

  // Step 5: tenant/brand binding (T5 — cross-tenant token use).
  if (row.tenant_id !== servingTenantId || row.brand_id !== servingBrandId) return NOT_OK

  // Step 6: record redemption, retrying the bounded CAS race.
  let current: ContinuationTokenRow = row
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    if (current.use_count >= current.max_uses) return NOT_OK

    const updated = await recordContinuationTokenUse(db, current.id, current.use_count)
    if (updated) {
      return {
        ok: true,
        token: {
          id: updated.id,
          purpose: updated.purpose,
          originChannel: updated.origin_channel,
          originConversationId: updated.origin_conversation_id,
          originContactId: updated.origin_contact_id,
          originHandleId: updated.origin_handle_id,
          campaignId: updated.campaign_id,
          adId: updated.ad_id,
          creativeId: updated.creative_id,
          bindsIdentity: updated.binds_identity,
          isFirstUse: current.use_count === 0,
        },
      }
    }

    // Lost the CAS race — someone else redeemed concurrently. Re-read
    // and retry against the current state rather than the stale one.
    const refreshed = await getContinuationTokenByHash(db, tokenHash)
    if (!refreshed || refreshed.revoked_at !== null) return NOT_OK
    current = refreshed
  }

  return NOT_OK
}

export async function revokeIssuedToken(
  db: AnySupabaseClient,
  tokenId: string,
  reason: string
) {
  return revokeContinuationToken(db, tokenId, reason)
}
