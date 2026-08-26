// ============================================================
// CORS for the Phase 2A anonymous endpoints — and ONLY those.
//
// Three routes need cross-origin browser access, because the Laddoos
// marketing website is served from a different origin than this CRM's
// API (e.g. laddoos.com calling admin.laddoosdotcom.in):
//
//   POST /api/web-events
//   GET  /api/continuation-tokens/resolve
//   GET  /api/yali/voice-config
//
// (voice-config is actually called server-to-server, from
// laddoos-website's own /api/livekit-token route, not the browser
// directly — it's on this list anyway so a future same-origin-only
// refactor doesn't have to rediscover why CORS is here.)
//
// Nothing else in this app gets CORS. Not the /api/v1 API-key routes,
// not the cookie-session dashboard routes, not the WhatsApp or
// Instagram webhooks. This helper is deliberately applied per-route
// rather than in middleware.ts: middleware matches every /api/* path,
// and a path-prefix rule there is exactly how CORS leaks onto a
// sibling route that should never have had it (this app already has
// that trap in the wild — /api/invitations/[token]/peek is anonymous
// while its /redeem sibling is authenticated).
//
// ── Why a disallowed origin is NOT rejected ──────────────────────
// Browsers send an `Origin` header on same-origin POSTs too, not just
// cross-origin ones. So "403 when Origin isn't on the allow-list"
// would break this app's OWN same-origin calls unless the CRM's
// production origin were also added to the allow-list in every
// environment — one forgotten env var away from breaking the working
// same-origin path in production.
//
// Instead: a disallowed or absent origin gets no
// Access-Control-Allow-Origin header, and the request is otherwise
// processed normally. That IS fail-closed — CORS is enforced by the
// browser, and a response with no ACAO is unreadable to a
// cross-origin caller. Same-origin is unaffected because browsers
// don't apply CORS to same-origin requests at all.
//
// The OPTIONS preflight is the one place a hard 403 is safe and
// useful: these two routes have no legitimate same-origin OPTIONS
// traffic, so a rejected preflight can only ever be a cross-origin
// caller, and a visible 403 in devtools beats debugging a silently
// missing header.
//
// ── Why no Access-Control-Allow-Credentials ──────────────────────
// The web SDK sends no cookies (it uses fetch's default
// `credentials: 'same-origin'`), and these endpoints authenticate
// nothing — /api/web-events is anonymous by design and
// /continuation-tokens/resolve is gated by the token's own HMAC. A
// reflected-origin ACAO combined with ACAC is the classic
// cross-origin-credential footgun; do not add it without re-reading
// this comment.
// ============================================================

import { VISITOR_ID_HEADER } from '@/lib/web-sdk/continuation'

const ENV_VAR = 'YALI_WEB_SDK_ALLOWED_ORIGINS'

/**
 * Preflight cache lifetime. Ten minutes keeps preflight traffic
 * negligible (browsers reuse the result for every subsequent call)
 * without pinning a stale allow-list in browser caches for long after
 * the env var changes — an origin removed from the list stops working
 * within ten minutes rather than within a day.
 */
const MAX_AGE_SECONDS = 600

/**
 * Parses the comma-separated allow-list. Read per call, never cached at
 * module load — same reason `resolveSigningSecret()` does
 * (src/lib/continuation/service.ts): a module-load read can't be varied
 * by a test and silently freezes whatever the env was at import time.
 *
 * Each entry is normalised through `new URL().origin`, so
 * "https://laddoos.com/", "https://laddoos.com", and
 * "https://LADDOOS.com" all resolve to the same allow-list member.
 * Entries that aren't parseable URLs are dropped rather than throwing —
 * one typo in the env var must not take the endpoint down, and the
 * result of dropping it is that the typo'd origin simply isn't allowed.
 */
export function parseAllowedOrigins(raw = process.env[ENV_VAR]): ReadonlySet<string> {
  const origins = new Set<string>()
  if (!raw?.trim()) return origins

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    try {
      origins.add(new URL(trimmed).origin)
    } catch {
      // Not a parseable absolute URL — ignore this entry.
    }
  }
  return origins
}

/**
 * The request's origin if it is on the allow-list, otherwise null.
 *
 * `null` (the literal string) is never allowed: browsers send
 * `Origin: null` for sandboxed iframes, file:// pages, and some
 * redirect chains. Reflecting it back would hand cross-origin read
 * access to any attacker who can get a page into a sandboxed frame.
 */
export function allowedOriginFor(request: Request): string | null {
  const origin = request.headers.get('origin')
  if (!origin || origin === 'null') return null
  return parseAllowedOrigins().has(origin) ? origin : null
}

/**
 * Applies the CORS response headers to a response and returns it
 * (mutated in place — NextResponse headers are mutable).
 *
 * `Vary: Origin` is set unconditionally, even when no ACAO is emitted:
 * the response genuinely differs by origin, so any cache that didn't
 * know that could serve an ACAO-less response to an allowed origin, or
 * leak an allowed origin's ACAO to a disallowed one.
 */
export function withCors<T extends Response>(request: Request, response: T): T {
  response.headers.append('Vary', 'Origin')

  const origin = allowedOriginFor(request)
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin)

  return response
}

/**
 * Response for an OPTIONS preflight. 204 with the CORS headers for an
 * allowed origin; 403 otherwise (see this module's header comment for
 * why rejecting is safe here but not on the actual request).
 *
 * `Access-Control-Allow-Headers` is the fixed set the SDK actually
 * sends rather than a reflection of `Access-Control-Request-Headers` —
 * reflecting would allow any header a caller asks for.
 */
export function preflightResponse(request: Request, methods: string): Response {
  const origin = allowedOriginFor(request)
  if (!origin) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } })
  }

  return new Response(null, {
    status: 204,
    headers: {
      Vary: 'Origin',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': `${methods}, OPTIONS`,
      // Content-Type for /api/web-events' JSON POST, and the visitor-id
      // header the continuation-resolve GET now carries. Imported rather
      // than written literally: a rename that missed this list would fail
      // ONLY at the browser preflight, where the header is silently
      // dropped and identity linking quietly stops happening.
      'Access-Control-Allow-Headers': `Content-Type, ${VISITOR_ID_HEADER}`,
      'Access-Control-Max-Age': String(MAX_AGE_SECONDS),
    },
  })
}
