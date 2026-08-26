// ============================================================
// GET/POST /api/messenger/webhook — Messenger transport foundation.
//
// TRANSPORT ONLY. This route records verified inbound Messenger activity
// as canonical Customer Timeline facts. It does NOT create contacts,
// conversations, messages or inbox threads, and Messenger is NOT
// operationally visible in the Inbox after this route ships — that
// arrives only with the separately-approved Timeline-to-Inbox projection.
//
// Writes ONLY to identity_handles and timeline_events — never to
// crm.contacts/conversations/messages, per
// docs/PHASE2_ARCHITECTURE_DECISIONS.md C2/C3. Deliberately does not
// touch assignments, automations, templates or AI: a Messenger event is
// a recorded fact here, not an operational trigger.
//
// Sibling of /api/instagram/webhook and shares its adapter caveat: real
// per-Page account routing needs a config table mapping a Meta Page id
// to an account (the role whatsapp_config.phone_number_id plays for
// WhatsApp). That table does not exist and this pass adds no migration,
// so the single-account resolver is used instead — correct for the
// current single-tenant deployment, and it fails LOUDLY rather than
// guessing if a second account ever appears.
//
// TWO SECRETS, SEPARATED BY PURPOSE — do not collapse them:
//
//   POST — verifyMetaWebhookSignature() reads META_APP_SECRET only. It
//          is an HMAC signing key and must never be used as anything
//          else.
//   GET  — hub.verify_token is compared against
//          MESSENGER_WEBHOOK_VERIFY_TOKEN only, with NO fallback to
//          META_APP_SECRET.
//
// The verify token is typed into Meta's callback-setup dashboard and
// travels in a query string on every verification request, so it can
// land in access logs, browser history and Referer headers. Reusing the
// App Secret there would expose the HMAC signing key through all of
// those channels — anyone holding it could forge signed POSTs. Each
// variable fails closed independently when absent.
//
// NOTE ON object TYPE: Meta delivers Page-scoped Messenger events with
// object === 'page' (not 'messenger'). Instagram's route rejects 'page'
// and this one accepts only 'page', so the two routes never consume each
// other's deliveries even though both are subscribed under one Meta App.
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
import { recordMessengerMessageEvent } from '@/lib/timeline/ingest'
import { projectTimelineEventToThread } from '@/lib/inbox/channel-threads'

interface MessengerMessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
  }
}

interface MessengerWebhookEntry {
  id?: string
  time?: number
  messaging?: MessengerMessagingEvent[]
}

interface MessengerWebhookPayload {
  object?: string
  entry?: MessengerWebhookEntry[]
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
  // Deliberately NOT META_APP_SECRET, and deliberately no `??` fallback
  // to it — see the header note. An empty string is falsy here, so a
  // blank variable fails closed exactly like an absent one.
  const expectedToken = process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN

  if (mode !== 'subscribe' || !challenge || !verifyToken) {
    return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })
  }
  if (!expectedToken) {
    console.error(
      '[messenger/webhook] MESSENGER_WEBHOOK_VERIFY_TOKEN is not set — rejecting verification'
    )
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
  }
  if (!constantTimeEquals(verifyToken, expectedToken)) {
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

  let payload: MessengerWebhookPayload
  try {
    payload = JSON.parse(rawBody) as MessengerWebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (payload.object !== 'page') {
    // Not a Page/Messenger delivery — acknowledge so Meta doesn't retry
    // forever, but record nothing.
    return NextResponse.json({ received: true })
  }

  try {
    const db = supabaseAdmin()
    // account_id is derived server-side. Nothing about the account,
    // channel, identity or event type is ever taken from the request.
    const { accountId, tenantId, brandId } = await resolveSingleAccountWorkspaceContext(db)

    let recorded = 0
    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        // Echoes (our own sent messages mirrored back) and non-message
        // entries (reads, deliveries, postbacks) carry no inbound fact
        // worth a timeline row in this transport slice.
        if (event.message?.is_echo) continue
        const senderId = event.sender?.id
        const messageId = event.message?.mid
        if (!senderId || !messageId) continue

        // occurred_at must come from the payload, never the clock: the
        // idempotency constraint is (account_id, dedupe_key,
        // occurred_at), so a replay timestamped with now() would insert
        // a second row under the same dedupe_key. An event carrying no
        // usable timestamp is skipped rather than recorded at a
        // non-reproducible time.
        const rawTimestamp = event.timestamp ?? entry.time
        if (typeof rawTimestamp !== 'number' || !Number.isFinite(rawTimestamp)) continue
        const occurredAt = new Date(rawTimestamp)
        if (Number.isNaN(occurredAt.getTime())) continue

        const handle = await recordIdentityHandle(db, {
          accountId,
          handleType: 'messenger_scoped_id',
          channel: 'messenger',
          handleHash: createHash('sha256').update(senderId).digest('hex'),
          handleValue: senderId,
          // No contactId and no confidence override: a Messenger handle
          // is an observation only. Linking it to a Contact is a
          // human-approved decision made elsewhere — never automatic.
        })

        await recordMessengerMessageEvent(db, {
          accountId,
          tenantId,
          brandId,
          direction: 'inbound',
          messengerMessageId: messageId,
          handleId: handle.id,
          summary: event.message?.text ?? '[non-text Messenger message]',
          occurredAt,
          payloadRef: { messenger_sender_id: senderId },
        })

        // Project the fact into the operational Inbox queue. Runs AFTER
        // the timeline write so the canonical fact is durable first — a
        // thread without its event is a recoverable inconsistency (the
        // next event re-upserts it), an event without its thread is
        // merely invisible in the Inbox until the next one arrives.
        // Idempotent, so a replay changes nothing.
        await projectTimelineEventToThread(db, {
          accountId,
          channel: 'messenger',
          handleId: handle.id,
          occurredAt,
        })
        recorded++
      }
    }

    return NextResponse.json({ received: true, recorded })
  } catch (error) {
    if (error instanceof WorkspaceContextError) {
      // Still 200 to Meta — a config problem on our side shouldn't make
      // Meta hammer retries; log it so it's visible operationally.
      console.error('[messenger/webhook] workspace context error:', error.message)
      return NextResponse.json({ received: true, recorded: 0 })
    }
    console.error('[messenger/webhook] processing error:', error)
    return NextResponse.json({ received: true, recorded: 0 })
  }
}
