// ============================================================
// Trusted visitor -> Contact linking on continuation-token first use.
//
// This is the ONLY automatic identity-linking path in the product. It is
// deliberately narrow: the trust anchor is possession of a signed,
// unexpired, previously-unused continuation token that a known Contact
// was sent, not anything inferred from browsing behaviour. Nothing here
// guesses an identity from page views, form fields, checkout or a typed
// phone number — identity_evidence_policy (044) caps those at
// `probable` with auto_link = false, and this module never widens that.
//
// Two structural facts make the whole thing safe:
//
//   1. The caller can only reach here as the WINNER of the token-use
//      compare-and-set in recordContinuationTokenUse() — exactly one
//      request can ever observe isFirstUse === true, so replays and
//      concurrent redemptions cannot double-link.
//   2. The resolve route runs on the service-role client, which BYPASSES
//      RLS entirely. identity_handles_account_rw would normally enforce
//      the account boundary; here it cannot. That is why assertSameAccount
//      below is not defensive decoration — it is the only thing standing
//      between a token and another workspace's handle. Never remove it,
//      and never move an identity write in this file above it.
//
// Every rejection is a SILENT NO-OP, never an error: the resolve route
// must keep returning its uniform response so an anonymous caller cannot
// learn whether a link happened, whether a handle exists, or why not.
// ============================================================

import { createHash } from 'node:crypto'

import type { AnySupabaseClient } from '@/lib/supabase/any-client'
import {
  getIdentityHandleByHash,
  updateIdentityHandleGovernance,
} from '@/lib/identity/handles'
import { recordIdentityEvidence } from '@/lib/identity/evidence'

/** The handle_type /api/web-events writes. This module only ever reads it. */
const WEB_VISITOR_HANDLE_TYPE = 'web_visitor_id'

/**
 * Seeded in identity_evidence_policy (044) with max_confidence 'strong'
 * and auto_link = true. Both values below come from that policy; they are
 * not chosen here.
 */
const EVIDENCE_TYPE = 'continuation_token_first_use'
const LINK_CONFIDENCE = 'strong'

/**
 * Confidence values that represent a decision a human already made:
 * agent_manual_link is capped at 'verified', agent_manual_unlink and
 * customer_denial at 'rejected'. identity_handles has no link_source
 * column (unlike contacts.customer_link_source, which 039 protects by
 * name), so confidence is what distinguishes a human decision from an
 * automatic one. A token must never override either.
 */
const HUMAN_DECIDED: ReadonlySet<string> = new Set(['verified', 'rejected'])

/** Why no link happened. Diagnostic only — never returned to a caller. */
export type VisitorLinkOutcome =
  | 'linked'
  | 'not_first_use'
  | 'binds_identity_false'
  | 'no_origin_contact'
  | 'no_visitor_id'
  | 'handle_not_found'
  | 'account_mismatch'
  | 'already_linked'
  | 'human_decided'

export interface LinkVisitorOnFirstUseInput {
  /** The token's account. Handles outside it are never touched. */
  accountId: string
  originContactId: string | null
  bindsIdentity: boolean
  isFirstUse: boolean
  /** Raw visitor id from the request header, or null when absent. */
  visitorId: string | null
}

/**
 * Attempt the link. Returns the outcome for logging/tests; the caller
 * must not surface it. Writes at most two rows, in this order:
 *
 *   1. identity_evidence  (why the link happened)
 *   2. identity_handles   (the link itself)
 *
 * Evidence first is deliberate. If the second write fails, the trail
 * still records what was observed and a later manual link reconciles it;
 * the reverse would leave a link nobody can account for.
 *
 * Never writes timeline_events. The Contact Timeline reads through
 * handle_id, so historical and future events surface from this one
 * handle update with no backfill.
 */
export async function linkVisitorOnFirstUse(
  db: AnySupabaseClient,
  input: LinkVisitorOnFirstUseInput
): Promise<VisitorLinkOutcome> {
  if (!input.isFirstUse) return 'not_first_use'
  if (!input.bindsIdentity) return 'binds_identity_false'
  if (!input.originContactId) return 'no_origin_contact'

  const visitorId = input.visitorId?.trim()
  if (!visitorId) return 'no_visitor_id'

  const handleHash = createHash('sha256').update(visitorId).digest('hex')
  const handle = await getIdentityHandleByHash(
    db,
    input.accountId,
    WEB_VISITOR_HANDLE_TYPE,
    handleHash
  )

  // Absent is normal: the visitor may never have hit /api/web-events. This
  // module must not create the handle — that route is its sole owner.
  if (!handle) return 'handle_not_found'

  // The lookup above is already account-scoped, so this cannot fail today.
  // It is asserted anyway because the service-role client bypasses RLS: if
  // the lookup is ever widened, this is what still stops a cross-account
  // write. See this file's header.
  if (handle.account_id !== input.accountId) return 'account_mismatch'

  // Never overwrite or relink, even to the same contact.
  if (handle.contact_id !== null) return 'already_linked'
  if (HUMAN_DECIDED.has(handle.confidence)) return 'human_decided'

  await recordIdentityEvidence(db, {
    accountId: input.accountId,
    handleId: handle.id,
    contactId: input.originContactId,
    evidenceType: EVIDENCE_TYPE,
    confidence: LINK_CONFIDENCE,
    actorType: 'system',
  })

  // 'strong', never 'verified': possession of a forwarded link is not
  // proof of identity, and a shared device would otherwise bind the wrong
  // person irreversibly. verified stays reserved for a human decision.
  await updateIdentityHandleGovernance(db, handle.id, {
    contactId: input.originContactId,
    confidence: LINK_CONFIDENCE,
  })

  return 'linked'
}
