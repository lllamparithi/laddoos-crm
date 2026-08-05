// ============================================================
// GET /api/continuation-tokens/resolve?ref=<token>
//
// Public — no auth. Called server-side by whatever page renders behind
// a tracked link (e.g. /products/millet-laddoo?yali_ref=<token>) to
// resolve the ref before binding the visiting web session. Anonymous by
// necessity — the visitor has no account session — protected by the
// token's own HMAC signature plus a per-IP rate limit, the same model
// /api/invitations/[token]/peek already uses for an anonymous,
// enumeration-sensitive lookup.
//
// Security model (docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §11,
// §12): malformed, wrong signature, unknown, expired, revoked,
// exhausted, and wrong-tenant are ALL indistinguishable on this wire —
// every failure is the identical `{ ok: false }` / 404. Distinguishing
// any of them would make this endpoint an oracle for probing which refs
// are "close" to valid. token_hash never appears in any response.
//
// CORS: cross-origin callers on YALI_WEB_SDK_ALLOWED_ORIGINS are
// supported. Unlike /api/web-events, the SDK's call here is a bare GET
// with no custom headers — a "simple" request that does NOT preflight,
// so this route needs only the response header, not the OPTIONS
// handler. The OPTIONS handler exists anyway (one line) so the two
// Phase 2A endpoints behave identically: the day someone adds a header
// to this GET, it keeps working instead of failing at a preflight that
// only one of the pair happened to implement.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  resolveSingleAccountWorkspaceContext,
  WorkspaceContextError,
} from '@/lib/identity/workspace-context'
import { resolveContinuationToken, ContinuationServiceError } from '@/lib/continuation/service'
import { withCors, preflightResponse } from '@/lib/cors'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

const NOT_OK_RESPONSE = () => NextResponse.json({ ok: false }, { status: 404 })

export async function OPTIONS(request: Request) {
  return preflightResponse(request, 'GET')
}

export async function GET(request: Request) {
  return withCors(request, await handleResolve(request))
}

async function handleResolve(request: Request): Promise<Response> {
  const ip = getClientIp(request)
  const limit = checkRateLimit(`continuation-resolve:${ip}`, RATE_LIMITS.continuationTokenResolve)
  if (!limit.success) return rateLimitResponse(limit)

  const { searchParams } = new URL(request.url)
  const ref = searchParams.get('ref')
  if (!ref) {
    // A missing parameter is a caller bug, not a signal about any
    // specific token's validity — distinct 400 is safe to return.
    return NextResponse.json({ error: "'ref' query parameter is required" }, { status: 400 })
  }

  try {
    const db = supabaseAdmin()
    const { tenantId, brandId } = await resolveSingleAccountWorkspaceContext(db)

    const result = await resolveContinuationToken(db, ref, tenantId, brandId)
    if (!result.ok || !result.token) return NOT_OK_RESPONSE()

    return NextResponse.json({
      ok: true,
      purpose: result.token.purpose,
      origin_conversation_id: result.token.originConversationId,
      origin_contact_id: result.token.originContactId,
      origin_handle_id: result.token.originHandleId,
      campaign_id: result.token.campaignId,
      ad_id: result.token.adId,
      creative_id: result.token.creativeId,
      binds_identity: result.token.bindsIdentity,
      is_first_use: result.token.isFirstUse,
    })
  } catch (error) {
    if (error instanceof WorkspaceContextError) {
      // Deployment isn't configured yet (no account / no active
      // workspace_brand_map) — a real operational state, not a signal
      // about the presented token. Fine to surface distinctly.
      console.error('[continuation-tokens/resolve] workspace context error:', error.message)
      return NextResponse.json({ error: 'Service not configured' }, { status: error.status })
    }
    if (error instanceof ContinuationServiceError) {
      // CONTINUATION_TOKEN_SIGNING_KEY is unset — fail closed with a
      // clear operational error, still never touching token validity.
      console.error('[continuation-tokens/resolve] service error:', error.message)
      return NextResponse.json({ error: 'Service not configured' }, { status: error.status })
    }
    console.error('[continuation-tokens/resolve] unexpected error:', error)
    return NOT_OK_RESPONSE()
  }
}
