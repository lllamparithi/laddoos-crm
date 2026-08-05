// ============================================================
// POST /api/continuation-tokens
//
// Issues a Phase 2A continuation token (Instagram -> Website). Called
// by an account member (typically after replying to an Instagram DM
// with a product link) — cookie-session authenticated, matching the
// existing /api/contacts/[id]/tags convention.
//
// Purpose is hardcoded to 'ig_to_web': Phase 2A never issues any other
// purpose (see 046_continuation_tokens.sql's header comment). Accepting
// it from the request body would let a caller issue a 'web_to_wa' token
// before Phase 2B's WhatsApp handoff exists to consume one correctly.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  resolveWorkspaceBrandForAccount,
  WorkspaceContextError,
} from '@/lib/identity/workspace-context'
import {
  issueContinuationToken,
  ContinuationServiceError,
} from '@/lib/continuation/service'

interface IssueRequestBody {
  origin_conversation_id?: unknown
  origin_contact_id?: unknown
  origin_handle_id?: unknown
  campaign_id?: unknown
  ad_id?: unknown
  creative_id?: unknown
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = ((await request.json().catch(() => ({}))) ?? {}) as IssueRequestBody

    const { tenantId, brandId } = await resolveWorkspaceBrandForAccount(
      ctx.supabase,
      ctx.accountId
    )

    const issued = await issueContinuationToken(ctx.supabase, {
      accountId: ctx.accountId,
      tenantId,
      brandId,
      purpose: 'ig_to_web',
      originChannel: 'instagram',
      originConversationId: optionalString(body.origin_conversation_id),
      originContactId: optionalString(body.origin_contact_id),
      originHandleId: optionalString(body.origin_handle_id),
      campaignId: optionalString(body.campaign_id),
      adId: optionalString(body.ad_id),
      creativeId: optionalString(body.creative_id),
    })

    return NextResponse.json(
      { ref: issued.ref, expires_at: issued.expiresAt },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof WorkspaceContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof ContinuationServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return toErrorResponse(error)
  }
}
