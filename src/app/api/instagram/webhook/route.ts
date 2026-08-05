// ============================================================
// GET/POST /api/instagram/webhook — Phase 2A adapter stub.
//
// Deliberately an ADAPTER, not a fully production-wired webhook: real
// per-page account routing needs an instagram_config table mapping a
// Meta Page/IG-user id to an account (the same role
// whatsapp_config.phone_number_id plays for WhatsApp) — that table
// doesn't exist yet and isn't part of 043-046 (no new migration in this
// pass). This route uses the single-account resolver instead, correct
// for Laddoos' current single-tenant deployment and explicitly not
// something that scales to a second Instagram-connected account without
// that config table. See docs/PHASE2_SCOPE_REDUCTION.md.
//
// Reuses verifyMetaWebhookSignature() unchanged from the WhatsApp
// webhook — same Meta App, same HMAC-SHA256(META_APP_SECRET) scheme, no
// new secret needed. GET verification compares hub.verify_token against
// META_APP_SECRET directly (no per-page verify_token row to check
// against, unlike whatsapp_config — there's only one Instagram
// integration for the one account).
//
// Writes ONLY to identity_handles and timeline_events — never to
// crm.contacts/conversations/messages. Those stay exclusively
// WhatsApp's, per docs/PHASE2_ARCHITECTURE_DECISIONS.md C2/C3: Instagram
// activity lives on the timeline, not in the inbox tables, until a
// later phase migrates the inbox to read the timeline.
// ============================================================

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import {
  resolveSingleAccountWorkspaceContext,
  WorkspaceContextError,
} from '@/lib/identity/workspace-context'
import { recordIdentityHandle } from '@/lib/identity/handles'
import { recordInstagramMessageEvent } from '@/lib/timeline/ingest'

interface InstagramMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
  }
}

interface InstagramWebhookEntry {
  id?: string
  time?: number
  messaging?: InstagramMessagingEvent[]
}

interface InstagramWebhookPayload {
  object?: string
  entry?: InstagramWebhookEntry[]
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const challenge = searchParams.get('hub.challenge')
  const verifyToken = searchParams.get('hub.verify_token')
  const appSecret = process.env.META_APP_SECRET

  if (mode !== 'subscribe' || !challenge || !verifyToken) {
    return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })
  }
  if (!appSecret) {
    console.error('[instagram/webhook] META_APP_SECRET is not set — rejecting verification')
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
  }
  if (!constantTimeEquals(verifyToken, appSecret)) {
    return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })
  }

  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  let payload: InstagramWebhookPayload
  try {
    payload = JSON.parse(rawBody) as InstagramWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.object !== 'instagram') {
    // Not our event type — acknowledge so Meta doesn't retry forever,
    // but do nothing with it.
    return NextResponse.json({ received: true })
  }

  try {
    const db = supabaseAdmin()
    const { accountId, tenantId, brandId } = await resolveSingleAccountWorkspaceContext(db)

    let recorded = 0
    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        // Echoes (our own sent messages mirrored back) and events with
        // no message body (reads, deliveries) carry no mid/text worth a
        // timeline row in this smallest slice — skip them rather than
        // recording an empty fact.
        if (event.message?.is_echo) continue
        const senderId = event.sender?.id
        const messageId = event.message?.mid
        if (!senderId || !messageId) continue

        const handle = await recordIdentityHandle(db, {
          accountId,
          handleType: 'instagram_scoped_id',
          channel: 'instagram',
          handleHash: createHash('sha256').update(senderId).digest('hex'),
          handleValue: senderId,
        })

        await recordInstagramMessageEvent(db, {
          accountId,
          tenantId,
          brandId,
          direction: 'inbound',
          igMessageId: messageId,
          handleId: handle.id,
          summary: event.message?.text ?? '[non-text Instagram message]',
          occurredAt: event.timestamp ? new Date(event.timestamp) : undefined,
          payloadRef: { ig_sender_id: senderId },
        })
        recorded++
      }
    }

    return NextResponse.json({ received: true, recorded })
  } catch (error) {
    if (error instanceof WorkspaceContextError) {
      // Still 200 to Meta — a config problem on our side shouldn't make
      // Meta hammer retries; log it so it's visible operationally.
      console.error('[instagram/webhook] workspace context error:', error.message)
      return NextResponse.json({ received: true, recorded: 0 })
    }
    console.error('[instagram/webhook] processing error:', error)
    return NextResponse.json({ received: true, recorded: 0 })
  }
}
