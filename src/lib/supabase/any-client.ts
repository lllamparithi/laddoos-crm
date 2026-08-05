import type { SupabaseClient } from '@supabase/supabase-js'

// Loosened alias for internal helper functions that operate generically
// on "some Supabase client" — they call .from()/.rpc() on whatever schema
// the caller's client is scoped to, and never relied on the literal
// 'public' schema pin they inherited by accident from the bare
// `SupabaseClient` default (see docs/PHASE1_MIGRATION_AUDIT.md /
// PHASE1_TEST_REPORT.md: this codebase never passed a Database generic
// anywhere before Phase 1, so there was no real row-level type safety at
// these call sites either — only an incidental, unused schema-name pin).
//
// Phase 1 (crm-schema move) surfaced this: supabaseAdmin() now correctly
// returns a client strictly typed to the `crm` schema, which the bare
// `SupabaseClient` default (implicitly 'public') no longer accepts. This
// alias is the honest fix — these functions are genuinely schema-agnostic
// at the type level, not a bypass of a real schema-mismatch bug.
export type AnySupabaseClient = SupabaseClient<any, any, any, any, any>
