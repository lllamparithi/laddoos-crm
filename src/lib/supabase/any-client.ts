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
// This alias is INTENTIONALLY schema-agnostic: the helpers that accept it call
// .from()/.rpc() on whatever schema the caller's client is already scoped to,
// so every generic parameter is deliberately unconstrained rather than unknown.
//
// It must NOT be used to hide a schema mismatch in domain code. If a call site
// fails to typecheck because it is pointed at the wrong schema, fix the schema
// — never widen the parameter to this alias to silence it.
// See docs/PHASE1_1_GENERATED_TYPES_ADOPTION.md.
//
// The disable must stay on the line directly above the declaration; ESLint
// applies `-next-line` to the immediately following line only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySupabaseClient = SupabaseClient<any, any, any, any, any>
