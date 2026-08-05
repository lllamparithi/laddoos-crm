import { createBrowserClient } from '@supabase/ssr'
import type { AnySupabaseClient } from './any-client'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
//
// Typed as AnySupabaseClient, not the real generated `Database` (see
// database.types.ts) — the real `crm` types now exist and are verified
// (docs/PHASE1_TEST_REPORT.md, Step 11), but wiring them in here surfaces
// 58 PRE-EXISTING type mismatches across ~15 dashboard page components
// (hand-written domain interfaces like `Contact`/`Broadcast`/`Pipeline`
// vs. real column nullability — e.g. `created_at: string` hand-written
// vs. the real `string | null`). That's app-wide UI type-hygiene debt
// that predates Phase 1 (this codebase never had generated types before —
// see PHASE1_MIGRATION_AUDIT.md), not something introduced by the schema
// move, and out of scope to fix here. Adopt Database/'crm' at this call
// site as a dedicated follow-up pass once those 58 are triaged.
let browserClient: AnySupabaseClient | undefined

export function createClient(): AnySupabaseClient {
  if (browserClient) return browserClient

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: 'crm' } }
  )

  return browserClient
}
