// ============================================================
// Continuation-token URL reading + resolution — Phase 2A web SDK.
//
// Thin wrapper over GET /api/continuation-tokens/resolve. Per
// docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §11/§12, the server
// deliberately returns the identical shape for every failure reason —
// malformed, wrong signature, unknown, expired, revoked, exhausted,
// wrong tenant. This module preserves that: the only thing a caller can
// ever learn is `resolved: true | false`, never why. Internal ids
// (the DB row id, token_hash) never appear in ContinuationResolveOutcome
// at all — only the fields the server itself already scoped for the
// public response.
// ============================================================

import type { WebSdkOptions } from './events'

const DEFAULT_PARAM_NAME = 'yali_ref'

/**
 * Header carrying the anonymous visitor id on the resolve call.
 *
 * A HEADER, not a query parameter, on purpose: query strings land in
 * server access logs, browser history, and `Referer` headers sent to
 * third parties. The visitor id is not PII, but it is a stable
 * cross-visit identifier and does not belong in any of those.
 *
 * Exported so the route that reads it and the CORS allow-list that must
 * permit it reference the same string — a rename would otherwise fail
 * silently at the browser preflight, with the header simply never
 * arriving and linking never happening.
 */
export const VISITOR_ID_HEADER = 'x-yali-visitor-id'

export interface ReadContinuationRefOptions {
  /** Defaults to window.location.href when available. */
  url?: string
  /** Query param to read. Defaults to 'yali_ref'. */
  paramName?: string
}

export function readContinuationRefFromUrl(
  opts: ReadContinuationRefOptions = {}
): string | null {
  const paramName = opts.paramName ?? DEFAULT_PARAM_NAME
  const source = opts.url ?? (typeof window !== 'undefined' ? window.location.href : undefined)
  if (!source) return null
  try {
    return new URL(source).searchParams.get(paramName)
  } catch {
    return null
  }
}

/**
 * Removes the ref from the visible address bar via history.replaceState
 * — per the design doc, so the raw token isn't left sitting in the URL
 * (copyable, screenshot-able, sent in a Referer header to third-party
 * assets on the page) longer than the one resolution attempt needs it.
 * Best-effort and silent: a failed cosmetic cleanup must never surface
 * as an error to the host page.
 */
export function stripContinuationRefFromUrl(paramName: string = DEFAULT_PARAM_NAME): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(paramName)) return
    url.searchParams.delete(paramName)
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // Cosmetic only — never throw for this.
  }
}

export interface ResolvedContinuationData {
  purpose: string
  originConversationId: string | null
  // originContactId / originHandleId are deliberately absent: the server
  // no longer returns them. Identity binding happens server-side on
  // first use, so an anonymous client has no reason to hold a CRM
  // contact or handle id — and every reason not to.
  campaignId: string | null
  adId: string | null
  creativeId: string | null
  bindsIdentity: boolean
  isFirstUse: boolean
}

export type ContinuationResolveOutcome =
  | { present: false }
  | { present: true; resolved: false }
  | { present: true; resolved: true; data: ResolvedContinuationData }

export interface ResolveContinuationOptions
  extends WebSdkOptions,
    ReadContinuationRefOptions {
  /** Strip the ref from the address bar after attempting resolution. Default true. */
  stripFromUrl?: boolean
  /**
   * The anonymous visitor id, sent in VISITOR_ID_HEADER so the server can
   * bind this browser to the originating Contact on first use. Omit it
   * and resolution still works — only the identity link is skipped.
   */
  visitorId?: string
}

/**
 * Reads `?yali_ref=` (or a custom param) from the current URL and, if
 * present, resolves it against the server. Returns a three-way outcome
 * so a caller can tell "nothing to do" (present: false — the normal
 * case for most page loads) from "tried and failed" (resolved: false)
 * without ever learning why the latter failed.
 */
export async function resolveContinuationFromUrl(
  opts: ResolveContinuationOptions = {}
): Promise<ContinuationResolveOutcome> {
  const paramName = opts.paramName ?? DEFAULT_PARAM_NAME
  const ref = readContinuationRefFromUrl(opts)
  if (!ref) return { present: false }

  if (opts.stripFromUrl !== false) stripContinuationRefFromUrl(paramName)

  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined)
  if (!fetchImpl) return { present: true, resolved: false }

  try {
    // The visitor id rides in a header, never in the query string. When
    // it is absent the server simply cannot link — a silent no-op, not
    // an error — so resolution still succeeds for attribution.
    const headers: Record<string, string> = {}
    if (opts.visitorId) headers[VISITOR_ID_HEADER] = opts.visitorId

    const response = await fetchImpl(
      `${opts.apiBaseUrl ?? ''}/api/continuation-tokens/resolve?ref=${encodeURIComponent(ref)}`,
      Object.keys(headers).length ? { headers } : undefined
    )
    if (!response.ok) return { present: true, resolved: false }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || body.ok !== true) return { present: true, resolved: false }

    return {
      present: true,
      resolved: true,
      data: {
        purpose: body.purpose as string,
        originConversationId: (body.origin_conversation_id as string | null) ?? null,
        campaignId: (body.campaign_id as string | null) ?? null,
        adId: (body.ad_id as string | null) ?? null,
        creativeId: (body.creative_id as string | null) ?? null,
        bindsIdentity: Boolean(body.binds_identity),
        isFirstUse: Boolean(body.is_first_use),
      },
    }
  } catch {
    return { present: true, resolved: false }
  }
}
