import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { AnySupabaseClient } from './any-client'

// See client.ts's comment: typed as AnySupabaseClient, not the real
// generated `Database` type, pending a dedicated pass to fix 58
// pre-existing app-wide type mismatches that adopting it surfaces
// (docs/PHASE1_TEST_REPORT.md, Step 11).
export async function createClient(): Promise<AnySupabaseClient> {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'crm' },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
