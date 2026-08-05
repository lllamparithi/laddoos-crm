// ============================================================
// POST /api/web-events
//
// Public — no auth. The website's own SDK calls this to record a
// meaningful visit/page-view/chat/form event onto the Phase 2A
// timeline. Anonymous by necessity (most callers are visitors with no
// account), protected by a per-IP rate limit — same shape as the
// continuation-token resolve endpoint.
//
// Records (or re-observes) an identity_handles row for the visitor
// before writing the event, so a still-anonymous visit is attributed
// to a stable handle from the first call rather than only from
// whichever call happens to carry a continuation token — see
// docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §4.4: staying
// anonymous is the correct default, not a degraded one, and this
// endpoint never creates a contact — only a handle + an event.
//
// CORS: cross-origin callers on YALI_WEB_SDK_ALLOWED_ORIGINS are
// supported — the SDK's `Content-Type: application/json` makes this a
// non-simple request, so it preflights and needs the OPTIONS handler
// below. Every response goes through withCors(), including the 429 the
// rate limiter returns before any of this code runs: a 429 with no
// Access-Control-Allow-Origin reaches the browser as an opaque CORS
// failure instead of a rate-limit signal. See src/lib/cors.ts.
// ============================================================

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  resolveSingleAccountWorkspaceContext,
  WorkspaceContextError,
} from '@/lib/identity/workspace-context'
import { recordIdentityHandle, IdentityHandleError } from '@/lib/identity/handles'
import { recordWebEvent, TimelineIngestError, type WebEventType } from '@/lib/timeline/ingest'
import { TimelineEventError } from '@/lib/timeline/events'
import { withCors, preflightResponse } from '@/lib/cors'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

const WEB_EVENT_TYPES: ReadonlySet<string> = new Set([
  'web.visit',
  'web.page_view',
  'web.chat_started',
  'web.chat_turn',
  'web.form_submitted',
])

function isWebEventType(value: unknown): value is WebEventType {
  return typeof value === 'string' && WEB_EVENT_TYPES.has(value)
}

interface WebEventRequestBody {
  event_type?: unknown
  web_visitor_id?: unknown
  web_session_id?: unknown
  summary?: unknown
  dedupe_suffix?: unknown
  campaign_id?: unknown
  ad_id?: unknown
  creative_id?: unknown
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export async function OPTIONS(request: Request) {
  return preflightResponse(request, 'POST')
}

// Wrapped at one point rather than at each of the ten `return`s below,
// so a new early-return can't silently ship without CORS headers.
export async function POST(request: Request) {
  return withCors(request, await handleWebEvent(request))
}

async function handleWebEvent(request: Request): Promise<Response> {
  const ip = getClientIp(request)
  const limit = checkRateLimit(`web-events:${ip}`, RATE_LIMITS.webEventIngest)
  if (!limit.success) return rateLimitResponse(limit)

  const body = ((await request.json().catch(() => null)) ?? null) as WebEventRequestBody | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  if (!isWebEventType(body.event_type)) {
    return NextResponse.json(
      { error: `'event_type' must be one of: ${[...WEB_EVENT_TYPES].join(', ')}` },
      { status: 400 }
    )
  }
  const visitorId = requiredString(body.web_visitor_id)
  if (!visitorId) {
    return NextResponse.json({ error: "'web_visitor_id' is required" }, { status: 400 })
  }
  const sessionId = requiredString(body.web_session_id)
  if (!sessionId) {
    return NextResponse.json({ error: "'web_session_id' is required" }, { status: 400 })
  }
  const summary = requiredString(body.summary)
  if (!summary) {
    return NextResponse.json({ error: "'summary' is required" }, { status: 400 })
  }

  try {
    const db = supabaseAdmin()
    const { accountId, tenantId, brandId } = await resolveSingleAccountWorkspaceContext(db)

    // Visitor ids are anonymous client-generated tokens, not PII like a
    // phone or email — handle_value is stored directly (see
    // identity_handles' own "NULL when PII-minimised" comment; that
    // exception is for identifiers that ARE sensitive). handle_hash is
    // still computed, as every identity_handles row requires one.
    const handle = await recordIdentityHandle(db, {
      accountId,
      handleType: 'web_visitor_id',
      channel: 'web',
      handleHash: createHash('sha256').update(visitorId).digest('hex'),
      handleValue: visitorId,
    })

    await recordWebEvent(db, {
      accountId,
      tenantId,
      brandId,
      eventType: body.event_type,
      webSessionId: sessionId,
      handleId: handle.id,
      summary,
      dedupeSuffix: optionalString(body.dedupe_suffix),
      campaignId: optionalString(body.campaign_id),
      adId: optionalString(body.ad_id),
      creativeId: optionalString(body.creative_id),
    })

    // `{ ok: true }` — deliberately NOT the new event/handle row ids.
    //
    // This endpoint is anonymous: any caller on the internet reaches it
    // without a credential. Handing back crm.timeline_events.id and
    // crm.identity_handles.id gave every such caller two real internal
    // identifiers, and handle_id in particular is the identity-handle row
    // this visitor was just attributed to. Nothing ever consumed them —
    // the web SDK only reads `response.ok` — so they were pure leak with
    // no caller-side value.
    //
    // This also aligns the endpoint with its anonymous sibling:
    // /api/continuation-tokens/resolve is deliberate about never returning
    // token_hash or its own row id for exactly the same reason. Do not
    // reintroduce ids here; a caller that genuinely needs one needs a
    // credential first.
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkspaceContextError) {
      console.error('[web-events] workspace context error:', error.message)
      return NextResponse.json({ error: 'Service not configured' }, { status: error.status })
    }
    if (error instanceof TimelineIngestError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof IdentityHandleError || error instanceof TimelineEventError) {
      console.error('[web-events] write error:', error.message)
      return NextResponse.json({ error: 'Failed to record event' }, { status: error.status })
    }
    console.error('[web-events] unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
