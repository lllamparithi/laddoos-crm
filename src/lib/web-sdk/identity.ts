// ============================================================
// Visitor / session identifier generation and persistence — Phase 2A
// web SDK.
//
// visitor_id is long-lived (localStorage) — the same identity across
// separate visits, matching identity_handles.handle_type =
// 'web_visitor_id' on the server. session_id is scoped to the current
// tab/browsing session (sessionStorage, cleared when the tab closes) —
// used only for the timeline dedupe_key convention on the server
// (crm.timeline_events via /api/web-events), never stored as its own
// identity_handles row. See docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md
// §2.1 and src/lib/timeline/ingest.ts's own note on the same distinction.
//
// When storage is unavailable (SSR, private browsing, a blocking
// extension), both ids fall back to an in-memory value generated once
// per page load — the SDK still functions for that page view, it just
// can't recognize the same visitor on a later one. This is the "degrade
// safely" behaviour the task requires, not a special case to work
// around.
// ============================================================

import { safeGetItem, safeSetItem } from './storage'

const VISITOR_ID_KEY = 'yali_visitor_id'
const SESSION_ID_KEY = 'yali_session_id'

/**
 * A random-enough id — CSPRNG when available, a plain-Math.random
 * fallback otherwise. Not a security credential in either form (nothing
 * here needs to resist guessing, unlike ./continuation.ts's signed
 * tokens); exported so ./events.ts can reuse it for a per-event dedupe
 * suffix rather than duplicating the same fallback logic.
 */
export function generateRandomId(): string {
  return generateId()
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without Web Crypto's randomUUID. Not
  // cryptographically secure — acceptable here, this is an anonymous
  // tracking identifier, not a security credential (the continuation
  // token in ./continuation.ts is what actually needs CSPRNG + HMAC).
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

let memoryVisitorId: string | null = null
let memorySessionId: string | null = null

function getOrCreate(
  kind: 'local' | 'session',
  key: string,
  memoryCache: () => string | null,
  setMemoryCache: (id: string) => void
): string {
  const existing = safeGetItem(kind, key)
  if (existing) return existing

  const cached = memoryCache()
  if (cached) return cached

  const created = generateId()
  const persisted = safeSetItem(kind, key, created)
  if (!persisted) setMemoryCache(created)
  return created
}

export function getOrCreateVisitorId(): string {
  return getOrCreate(
    'local',
    VISITOR_ID_KEY,
    () => memoryVisitorId,
    (id) => {
      memoryVisitorId = id
    }
  )
}

export function getOrCreateSessionId(): string {
  return getOrCreate(
    'session',
    SESSION_ID_KEY,
    () => memorySessionId,
    (id) => {
      memorySessionId = id
    }
  )
}

/** Test-only: clears the in-memory fallback so tests don't leak ids across files/cases. */
export function __resetWebSdkIdentityForTests() {
  memoryVisitorId = null
  memorySessionId = null
}
