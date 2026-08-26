// ============================================================
// GET/PUT /api/yali/voice-config
//
// The on/off switch for the storefront's browser voice widget (Kyochi
// port — see plan). Two very different callers:
//
//   GET  — public, cross-origin. laddoos-website's /api/livekit-token
//          calls this server-to-server before minting a LiveKit token.
//          Returns ONLY { enabled: boolean } — same "anonymous endpoints
//          leak nothing" rule /api/web-events follows (CLAUDE.md). No
//          rate limit: read-only, no PII, nothing an attacker gains from
//          hammering it. `ponytail: skip rate limiting, add if abuse
//          shows up.`
//
//   PUT  — authed, dashboard-only. The /agents "Voice" tab's toggle.
//          admin+ (canEditSettings), mirrors /api/ai/config's POST.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveSingleAccountWorkspaceContext, WorkspaceContextError } from '@/lib/identity/workspace-context'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { withCors, preflightResponse } from '@/lib/cors'

export async function OPTIONS(request: Request) {
  return preflightResponse(request, 'GET')
}

export async function GET(request: Request) {
  return withCors(request, await handleGet())
}

async function handleGet(): Promise<Response> {
  try {
    const db = supabaseAdmin()
    const { accountId } = await resolveSingleAccountWorkspaceContext(db)

    const { data, error } = await db
      .from('yali_voice_config')
      .select('enabled')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[yali/voice-config GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load voice config' }, { status: 500 })
    }

    // No row yet = never toggled on = off, same as the column default.
    return NextResponse.json({ enabled: data?.enabled ?? false })
  } catch (error) {
    if (error instanceof WorkspaceContextError) {
      console.error('[yali/voice-config GET] workspace context error:', error.message)
      return NextResponse.json({ error: 'Service not configured' }, { status: error.status })
    }
    console.error('[yali/voice-config GET] unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
    if (!body || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: "'enabled' must be a boolean" }, { status: 400 })
    }

    const { error } = await supabase.from('yali_voice_config').upsert(
      {
        account_id: accountId,
        enabled: body.enabled,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )

    if (error) {
      console.error('[yali/voice-config PUT] upsert error:', error)
      return NextResponse.json({ error: 'Failed to save voice config' }, { status: 500 })
    }

    return NextResponse.json({ enabled: body.enabled })
  } catch (err) {
    return toErrorResponse(err)
  }
}
