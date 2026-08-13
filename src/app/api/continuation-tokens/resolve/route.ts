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
// supported. That anticipated day has arrived — this GET now carries the
// visitor-id header, which makes it a non-simple request that DOES
// preflight. The OPTIONS handler below was already here for exactly
// this; the header is also on the Access-Control-Allow-Headers list in
// src/lib/cors.ts, without which the browser would drop it silently and
// identity linking would simply never happen.
//
// IDENTITY BINDING: on first use only, this route links the calling
// browser's existing visitor handle to the token's originating Contact.
// See src/lib/identity/link-visitor.ts for the guards. Nothing about
// whether that succeeded is observable in the response.
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
import { linkVisitorOnFirstUse } from '@/lib/identity/link-visitor'
import { VISITOR_ID_HEADER } from '@/lib/web-sdk/continuation'

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
    const { accountId, tenantId, brandId } = await resolveSingleAccountWorkspaceContext(db)

    const result = await resolveContinuationToken(db, ref, tenantId, brandId)
    if (!result.ok || !result.token) return NOT_OK_RESPONSE()

    // Identity binding, first use only. Every rejection inside is a silent
    // no-op returning an outcome we deliberately DISCARD: surfacing it —
    // even as a boolean — would tell an anonymous caller whether a handle
    // exists or was already linked, which is exactly the oracle this
    // endpoint's uniform-response rule exists to prevent. A failure here
    // must never fail the resolve either, so it is caught separately.
    try {
      await linkVisitorOnFirstUse(db, {
        accountId,
        originContactId: result.token.originContactId,
        bindsIdentity: result.token.bindsIdentity,
        isFirstUse: result.token.isFirstUse,
        visitorId: request.headers.get(VISITOR_ID_HEADER),
      })
    } catch (linkError) {
      console.error('[continuation-tokens/resolve] identity link failed:', linkError)
    }

    // No CRM row identifiers are returned. origin_contact_id,
    // origin_handle_id and origin_conversation_id are all internal ids
    // (contacts.id, identity_handles.id, conversations.id) that anybody
    // holding a valid ref could otherwise read; the server performs the
    // identity binding itself, so no client needs any of them. Same
    // reasoning /api/web-events already applies by returning { ok: true }.
    //
    // campaign/ad/creative stay: they are the caller's OWN marketing
    // identifiers, supplied when the token was issued precisely so the
    // destination page can attribute the visit. They are not CRM rows.
    return NextResponse.json({
      ok: true,
      purpose: result.token.purpose,
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
