// ============================================================
// Event-sending client helper — Phase 2A web SDK.
//
// Thin wrapper over POST /api/web-events. Never throws into the host
// page — every failure (network error, non-2xx response, no fetch
// available) resolves to `false` rather than rejecting, the same
// "a broken tracking call must never break the site" discipline every
// production analytics SDK (Segment, GA, Amplitude) follows.
//
// SCOPE NOTE — read before adding a new trackX() function: the task
// that requested this SDK asked for "page view / product view / CTA
// click", but only page view has a real server-side home. Server-side,
// crm.timeline_event_types (045_timeline_events.sql) is seeded with
// exactly: message.inbound/outbound, web.visit/page_view/chat_started/
// chat_turn/form_submitted, campaign.*, identity.*, system.correction —
// there is no `web.product_view` or `web.cta_click` row, and this pass
// was explicitly told not to modify migrations without a real bug.
// Per that instruction's own escape clause ("... unless already
// specified in the canonical plan"), this file follows what's already
// specified rather than inventing new server-side types:
//   - trackPageView()    -> web.page_view (as seeded)
//   - trackProductView() -> ALSO web.page_view, specialised via summary
//                           + a product_id in the request (a page view
//                           IS a page view; this isn't a workaround)
//   - trackCtaClick()    -> NOT implemented. See its own doc comment.
// ============================================================

import { getOrCreateVisitorId, getOrCreateSessionId, generateRandomId } from './identity'
import type { WebEventType } from '@/lib/timeline/ingest'

export interface WebSdkOptions {
  /** Cross-origin base URL for the CRM's API, e.g. "https://admin.laddoosdotcom.in".
   *  Empty string (default) assumes the SDK is served same-origin with the API —
   *  see docs/PHASE2_WEB_SDK_INTEGRATION.md for the cross-origin/CORS caveat. */
  apiBaseUrl?: string
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

export interface SendWebEventInput {
  eventType: WebEventType
  summary: string
  /** Required by the server for every eventType except 'web.visit'. */
  dedupeSuffix?: string
  campaignId?: string
  adId?: string
  creativeId?: string
}

/**
 * Sends one event to POST /api/web-events. Returns whether it was
 * accepted (HTTP 2xx) — never throws, never returns a reason on
 * failure (network/validation/server errors are all just `false` to the
 * caller; a page embedding this SDK has no actionable response to any
 * of them, so there's nothing to gain from distinguishing them here).
 */
export async function sendWebEvent(
  input: SendWebEventInput,
  opts: WebSdkOptions = {}
): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined)
  if (!fetchImpl) return false

  try {
    const response = await fetchImpl(`${opts.apiBaseUrl ?? ''}/api/web-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: input.eventType,
        web_visitor_id: getOrCreateVisitorId(),
        web_session_id: getOrCreateSessionId(),
        summary: input.summary,
        dedupe_suffix: input.dedupeSuffix,
        campaign_id: input.campaignId,
        ad_id: input.adId,
        creative_id: input.creativeId,
      }),
    })
    return response.ok
  } catch {
    return false
  }
}

export interface TrackPageViewInput {
  /** Path or full URL of the page — used only for the summary line. */
  path: string
  title?: string
  /** Override the auto-generated per-call dedupe suffix for manual retry-safety. */
  dedupeSuffix?: string
  campaignId?: string
  adId?: string
  creativeId?: string
}

export async function trackPageView(
  input: TrackPageViewInput,
  opts: WebSdkOptions = {}
): Promise<boolean> {
  return sendWebEvent(
    {
      eventType: 'web.page_view',
      summary: input.title ? `Viewed ${input.title}` : `Viewed ${input.path}`,
      dedupeSuffix: input.dedupeSuffix ?? generateRandomId(),
      campaignId: input.campaignId,
      adId: input.adId,
      creativeId: input.creativeId,
    },
    opts
  )
}

export interface TrackProductViewInput {
  productId: string
  productName?: string
  dedupeSuffix?: string
  campaignId?: string
  adId?: string
  creativeId?: string
}

/**
 * Records a product-page view as `web.page_view` (see this file's
 * module comment for why there's no separate `web.product_view` type).
 * The summary line and productId are what make it findable/distinct
 * from a generic page view when reading the timeline later.
 */
export async function trackProductView(
  input: TrackProductViewInput,
  opts: WebSdkOptions = {}
): Promise<boolean> {
  return sendWebEvent(
    {
      eventType: 'web.page_view',
      summary: input.productName
        ? `Viewed product: ${input.productName} (${input.productId})`
        : `Viewed product ${input.productId}`,
      dedupeSuffix: input.dedupeSuffix ?? generateRandomId(),
      campaignId: input.campaignId,
      adId: input.adId,
      creativeId: input.creativeId,
    },
    opts
  )
}

/**
 * NOT YET SUPPORTED. See this file's module comment. Kept as an
 * explicit, documented stub rather than omitted silently — a CTA click
 * has no matching crm.timeline_event_types row today, so sending one
 * would be rejected by the server's foreign-key constraint. Always
 * resolves to `false` and logs one console.warn; never throws.
 */
export function trackCtaClick(): Promise<boolean> {
  if (typeof console !== 'undefined') {
    console.warn(
      '[yali-web-sdk] trackCtaClick() is not implemented — no server-side timeline_event_type ' +
        'exists yet for CTA clicks. See docs/PHASE2_WEB_SDK_INTEGRATION.md.'
    )
  }
  return Promise.resolve(false)
}
