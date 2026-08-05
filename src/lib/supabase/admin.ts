import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import type { AnySupabaseClient } from './any-client'

// Shared lazy, service-role client for every server-side path that needs
// to bypass RLS (webhook handler, automations engine, flows engine, AI
// reply, the public API's requireApiKey()). Previously duplicated
// byte-for-byte across src/lib/flows/admin-client.ts,
// src/lib/automations/admin-client.ts, src/lib/ai/admin-client.ts, and
// inline in src/app/api/whatsapp/webhook/route.ts — consolidated here as
// part of Phase 1's crm-schema move (see docs/PHASE1_SCHEMA_OWNERSHIP.md).
//
// supabaseAdmin() is typed as AnySupabaseClient, not the real generated
// `Database`/'crm' — see client.ts's comment and docs/PHASE1_TEST_REPORT.md
// Step 11: the real types exist and are verified, but adopting them here
// surfaces 58 pre-existing app-wide type mismatches out of Phase 1's scope.
let _adminClient: AnySupabaseClient | null = null
let _publicAdminClient: SupabaseClient<Database, 'public'> | null = null

export function supabaseAdmin(): AnySupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'crm' } },
    )
  }
  return _adminClient
}

// Explicit `public`-schema counterpart — for reading the Yali brain's
// tables (customers, orders, leads, …). Deliberately a SEPARATE client
// rather than one client that silently defaults to `crm`: every call
// site that needs `public` data must import this one by name, so the
// schema it's reading is obvious from the import, not implicit. Fully
// typed already (this is the REAL generated public schema, not a
// placeholder, and public-schema consumers don't hit the same UI-type
// mismatch problem since nothing in this app's frontend reads `public`
// tables yet).
export function supabasePublicAdmin(): SupabaseClient<Database, 'public'> {
  if (!_publicAdminClient) {
    _publicAdminClient = createClient<Database, 'public'>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'public' } },
    )
  }
  return _publicAdminClient
}
