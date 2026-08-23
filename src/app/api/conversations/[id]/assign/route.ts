import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchConversationAssigned } from '@/lib/automations/dispatch-assignment'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/conversations/[id]/assign  (agent+)
 *
 * Assign or unassign a conversation, and fire `conversation_assigned`
 * when the assignment actually changed.
 *
 * ── Why this endpoint exists ─────────────────────────────────────
 * The inbox previously wrote `assigned_agent_id` straight from the
 * browser and then asked the generic /api/automations/engine route to
 * fire the trigger, passing its own trigger type, contact id and
 * context. That let an authenticated agent forge a `conversation_assigned`
 * event — running real automation actions (outbound WhatsApp, tags, deals)
 * against an arbitrary contact with no assignment behind it.
 *
 * So the browser now supplies exactly ONE thing: the requested assignee.
 * Everything the automation sees — contact, conversation, previous and
 * next assignee — is derived server-side from stored rows the caller
 * cannot influence. An event is dispatched only after a real assignment
 * change has been persisted.
 *
 * Body: { agent_id: string | null }   — null unassigns.
 *
 * The conversation lookup and the write are both account-scoped through
 * the RLS client, so a conversation outside the caller's account is
 * simply not found (404).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id: conversationId } = await params

    const body = (await request.json().catch(() => null)) as {
      agent_id?: unknown
    } | null

    // Accept only null or a string. An absent field is a malformed
    // request, not an implicit unassign — unassigning must be explicit.
    if (!body || !('agent_id' in body)) {
      return NextResponse.json({ error: 'agent_id required' }, { status: 400 })
    }
    const requested = body.agent_id
    if (requested !== null && typeof requested !== 'string') {
      return NextResponse.json(
        { error: 'agent_id must be a string or null' },
        { status: 400 },
      )
    }

    // Only a literal JSON `null` may unassign. An empty or whitespace-only
    // string is malformed input, not an intent to unassign — coercing it
    // with `|| null` silently released the conversation, so a truncated or
    // mis-serialised client field would quietly drop the assignee instead
    // of failing loudly.
    let nextAgentId: string | null
    if (requested === null) {
      nextAgentId = null
    } else {
      const trimmed = requested.trim()
      if (!trimmed) {
        return NextResponse.json(
          { error: 'agent_id must be a non-empty string, or null to unassign' },
          { status: 400 },
        )
      }
      nextAgentId = trimmed
    }

    // Canonical current state. Everything downstream derives from this
    // row, never from the request body.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, assigned_agent_id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[conversations/assign] lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // The assignee must be a member of this account. Without this an
    // agent could park a conversation on a user from another tenant.
    if (nextAgentId) {
      const { data: member, error: memberErr } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', nextAgentId)
        .maybeSingle()
      if (memberErr) {
        console.error('[conversations/assign] member lookup error:', memberErr)
        return NextResponse.json(
          { error: 'Failed to validate assignee' },
          { status: 500 },
        )
      }
      if (!member) {
        return NextResponse.json(
          { error: 'Assignee is not a member of this account' },
          { status: 400 },
        )
      }
    }

    const previousAgentId =
      (conv as { assigned_agent_id?: string | null }).assigned_agent_id ?? null
    const contactId = (conv as { contact_id?: string | null }).contact_id ?? null

    // Re-selecting the current assignee changes nothing. Skip the write
    // and the dispatch rather than recording a no-op.
    if (previousAgentId === nextAgentId) {
      return NextResponse.json({ ok: true, changed: false, dispatched: false })
    }

    const { error: upErr } = await supabase
      .from('conversations')
      .update({ assigned_agent_id: nextAgentId })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[conversations/assign] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update assignment' },
        { status: 500 },
      )
    }

    // Only now, and only from stored values. The helper decides whether
    // this warrants a dispatch (it does not for an unassign) and never
    // rejects, so a failing automation cannot turn a completed
    // assignment into a 500.
    const dispatched = await dispatchConversationAssigned(
      {
        accountId,
        conversationId,
        contactId,
        previousAgentId,
        nextAgentId,
        origin: 'manual',
      },
      runAutomationsForTrigger,
    )

    return NextResponse.json({ ok: true, changed: true, dispatched })
  } catch (err) {
    return toErrorResponse(err)
  }
}
