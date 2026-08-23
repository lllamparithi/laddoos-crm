import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import type { AutomationTriggerType } from '@/types'

/**
 * Manual trigger for testing or for external integrations that want
 * to fire automations. Auth is required — we resolve the caller's
 * account_id and dispatch over the account's automations.
 */
export async function POST(request: Request) {
  // Firing automations sends outbound WhatsApp — a write action. Require
  // at least `agent`; a viewer must not be able to trigger sends.
  let accountId: string
  try {
    const ctx = await requireRole('agent')
    accountId = ctx.accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body?.trigger_type) {
    return NextResponse.json({ error: 'trigger_type required' }, { status: 400 })
  }

  // `conversation_assigned` is not dispatchable through this generic
  // entrypoint. This route takes the trigger type, contact and context
  // verbatim from the caller, which is fine for a manual test fire but
  // would let an authenticated agent forge an assignment event —
  // running real automation actions against an arbitrary contact with
  // no assignment behind it. That trigger is owned by
  // POST /api/conversations/[id]/assign, which derives every field from
  // stored rows after persisting a real change.
  if (body.trigger_type === 'conversation_assigned') {
    return NextResponse.json(
      {
        error:
          'conversation_assigned cannot be fired here; use POST /api/conversations/[id]/assign',
      },
      { status: 400 },
    )
  }

  await runAutomationsForTrigger({
    accountId,
    triggerType: body.trigger_type as AutomationTriggerType,
    contactId: body.contact_id ?? null,
    context: body.context ?? {},
  })

  return NextResponse.json({ ok: true })
}
