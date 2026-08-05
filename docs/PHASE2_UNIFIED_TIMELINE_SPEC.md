# Phase 2 — Unified Customer Timeline

**Status:** PROPOSAL. Nothing implemented, nothing applied.
**Companion:** `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md`

---

## 1. Why a new table is justified

The audit rule for Phase 2 is: *do not create a duplicate concept without
explaining why the existing model cannot support the requirement.* Four
event-like tables already exist. None of them can carry this.

| Existing | Scope | Why it can't be the timeline |
|---|---|---|
| `crm.flow_run_events` | One flow run | FK'd to `flow_run_id`. Cannot represent an order, a call, or a web visit |
| `crm.automation_logs` | One automation execution | Same — FK'd to `automation_id`, and it is a *log*, not a customer record |
| `crm.messages` | WhatsApp messages in a conversation | No channel, no non-message events. Requires a conversation, which a web visit has no reason to have |
| `public.audit_events` | System actions, tenant-scoped | Brain-owned, actor/resource shaped. Writing customer history into another repo's audit table conflates two purposes and violates the ownership split |

**Genuinely new.** Nothing in either schema can hold "a thing that
happened to a person, on some channel, at some time, with a confidence
and a visibility."

What is **not** new, and is reused rather than rebuilt: message bodies
stay in `crm.messages`, orders in `public.orders`, chat turns in
`public.chat_turns`, call turns in `public.realtime_turns`. The timeline
stores a **reference and a summary**, never a second copy of the content.
It is an index of a life, not a warehouse.

---

## 2. Table

```sql
-- 048_timeline_events.sql

CREATE TABLE IF NOT EXISTS timeline_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy. account_id drives RLS; tenant/brand are denormalised so
  -- brain-side joins and the cross-tenant guard need no extra lookup.
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL,
  brand_id          UUID NOT NULL,

  -- Identity. handle_id is the IMMUTABLE fact ("this browser did this").
  -- contact_id / customer_id are RESOLVED and may change on merge/split.
  -- This split is what makes the table append-only AND late-bindable.
  handle_id         UUID REFERENCES identity_handles(id) ON DELETE SET NULL,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_id       UUID,                       -- public.customers.id, no FK (brain-owned)

  -- What happened
  event_type        TEXT NOT NULL,              -- see §4 taxonomy
  channel           TEXT NOT NULL,              -- 'instagram','whatsapp','web','voice','email','system'
  source            TEXT NOT NULL,              -- 'meta_webhook','web_sdk','voice_agent','comez','agent','ai'
  occurred_at       TIMESTAMPTZ NOT NULL,       -- when it happened in the world
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when we learned of it

  -- Context
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  session_id        UUID,                       -- public.sessions.id, no FK
  campaign_id       TEXT,
  ad_id             TEXT,
  creative_id       TEXT,

  -- Content: a pointer and a human-readable line. Never the payload itself.
  summary           TEXT NOT NULL,
  payload_ref       JSONB NOT NULL DEFAULT '{}'::jsonb,
                    -- e.g. {"table":"crm.messages","id":"…"}
                    --      {"bucket":"recordings","path":"…","expires_at":"…"}
  payload_hash      TEXT,                       -- integrity check for external blobs

  -- Governance
  confidence        TEXT NOT NULL DEFAULT 'verified'
                      CHECK (confidence IN
                        ('verified','strong','probable','unknown','rejected')),
  visibility        TEXT NOT NULL DEFAULT 'team'
                      CHECK (visibility IN ('team','restricted','sensitive','system')),
  owner_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_state      TEXT NOT NULL DEFAULT 'none'
                      CHECK (action_state IN
                        ('none','open','snoozed','done','dismissed')),
  snoozed_until     TIMESTAMPTZ,

  -- Corrections are new rows, never edits.
  corrects_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL,

  -- Idempotency: webhooks retry. Same fact must never appear twice.
  dedupe_key        TEXT NOT NULL,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  UNIQUE (account_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_timeline_contact_time
  ON timeline_events (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_handle_time
  ON timeline_events (handle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_account_time
  ON timeline_events (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_open_actions
  ON timeline_events (account_id, action_state, occurred_at DESC)
  WHERE action_state IN ('open','snoozed');
CREATE INDEX IF NOT EXISTS idx_timeline_type_time
  ON timeline_events (account_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_campaign
  ON timeline_events (account_id, campaign_id) WHERE campaign_id IS NOT NULL;
```

### 2.1 Enforcing append-only

Grants alone are not enough — `action_state` and `contact_id` legitimately
change. The rule is: **governance columns are mutable, facts are not.**

```sql
CREATE OR REPLACE FUNCTION timeline_events_immutable_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
BEGIN
  IF NEW.event_type  IS DISTINCT FROM OLD.event_type
  OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
  OR NEW.channel     IS DISTINCT FROM OLD.channel
  OR NEW.source      IS DISTINCT FROM OLD.source
  OR NEW.summary     IS DISTINCT FROM OLD.summary
  OR NEW.payload_ref IS DISTINCT FROM OLD.payload_ref
  OR NEW.handle_id   IS DISTINCT FROM OLD.handle_id
  OR NEW.dedupe_key  IS DISTINCT FROM OLD.dedupe_key THEN
    RAISE EXCEPTION
      'timeline_events is append-only: % is immutable. Record a correction event instead.',
      TG_ARGV[0];
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_timeline_events_immutable
  BEFORE UPDATE ON timeline_events
  FOR EACH ROW EXECUTE FUNCTION timeline_events_immutable_guard();

REVOKE DELETE ON timeline_events FROM authenticated, anon;
```

Mutable by design: `contact_id`, `customer_id` (re-resolution),
`action_state`, `snoozed_until`, `owner_user_id`, `visibility`.

Per the Phase 1 `041` lesson, this migration declares its own explicit
`REVOKE`/`GRANT` and adds no blanket grant.

---

## 3. Late binding — how anonymous history joins a person

The single most important behaviour in this spec.

```
Day 1   anonymous visit
        timeline_events(handle_id = H_web, contact_id = NULL)   ← fact

Day 3   same browser, chat, gives phone, confirms OTP
        identity_handles(H_web).contact_id = C_meera            ← hypothesis

        re-resolution: UPDATE timeline_events
                       SET contact_id = C_meera
                       WHERE handle_id = H_web AND contact_id IS NULL

        Day 1's visit now appears on Meera's timeline.
        The event row's FACTS were never touched.
```

Re-resolution runs on merge, split and reconciliation. It is idempotent
and safe to re-run — the same discipline as
`reconcile_contact_customer_links()` in `039`.

**On split it runs in reverse**: handles detached from a contact take
their events with them. Nothing is deleted; the resolution simply
recomputes.

```sql
CREATE OR REPLACE FUNCTION resolve_timeline_identities(p_handle_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, crm, extensions, public, pg_temp
AS $$
DECLARE v_contact UUID; v_customer UUID; v_n INTEGER;
BEGIN
  SELECT h.contact_id, c.customer_id INTO v_contact, v_customer
  FROM identity_handles h
  LEFT JOIN contacts c ON c.id = h.contact_id
  WHERE h.id = p_handle_id;

  UPDATE timeline_events
     SET contact_id = v_contact, customer_id = v_customer
   WHERE handle_id = p_handle_id
     AND (contact_id IS DISTINCT FROM v_contact
       OR customer_id IS DISTINCT FROM v_customer);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
```

---

## 4. Event taxonomy

Namespaced `domain.action`. Stored as `TEXT` with a FK to a seed table
rather than a `CHECK` constraint — adding an event type must not require
altering a large table.

```sql
CREATE TABLE IF NOT EXISTS timeline_event_types (
  event_type        TEXT PRIMARY KEY,
  domain            TEXT NOT NULL,
  default_visibility TEXT NOT NULL DEFAULT 'team',
  is_customer_action BOOLEAN NOT NULL DEFAULT false,  -- resets follow-up timers
  is_meaningful     BOOLEAN NOT NULL DEFAULT false,   -- counts as engagement
  description       TEXT NOT NULL
);
```

| Domain | Types | `customer_action` |
|---|---|---|
| `message` | `inbound` `outbound` `reaction` `failed` `template_sent` | inbound ✓ |
| `web` | `visit` `page_view` `chat_started` `chat_turn` `form_submitted` | all ✓ |
| `cart` | `item_added` `item_removed` `abandoned` `recovered` | added/removed ✓ |
| `order` | `placed` `paid` `cancelled` `refunded` | placed/paid ✓ |
| `fulfilment` | `dispatched` `in_transit` `delivered` `failed` `returned` | — |
| `call` | `inbound` `outbound` `missed` `completed` `transcript_ready` `recording_ready` | inbound ✓ |
| `email` | `sent` `delivered` `opened` `clicked` `replied` `bounced` | replied/clicked ✓ |
| `identity` | `handle_observed` `linked` `merged` `split` `rejected` `verification_sent` `verified` | — |
| `consent` | `granted` `withdrawn` `updated` | ✓ |
| `campaign` | `click` `token_issued` `token_redeemed` `token_rejected` | click ✓ |
| `note` | `added` `edited` | — |
| `task` | `created` `assigned` `completed` `overdue` | — |
| `followup` | `scheduled` `sent` `suppressed` `cancelled` | — |
| `calendar` | `event_created` `event_updated` `reminder_due` | — |
| `ai` | `warning` `summary_updated` `recommendation` `escalation` | — |
| `system` | `correction` `retention_redacted` `export_requested` `deletion_requested` | — |

`is_customer_action` is load-bearing: the follow-up engine cancels
pending sends when any such event lands. See
`PHASE2_FOLLOWUP_POLICY_ENGINE.md` §4.

---

## 5. Visibility tiers

| Tier | Contains | Who sees it |
|---|---|---|
| `team` | Messages, visits, orders, notes | Any account member |
| `restricted` | Full phone/email, address, identity evidence detail | Admin/owner, or the assigned owner |
| `sensitive` | Call recordings, transcripts, payment detail, health/dietary notes | Explicit per-role grant; every access logged |
| `system` | Re-resolution, retention jobs, corrections | Admin/owner; hidden from the default feed |

Default per type comes from `timeline_event_types.default_visibility`;
an event may be escalated but never silently downgraded.

**Call recordings and transcripts default to `sensitive`.** Under DPDP,
recording generally requires notice and, depending on purpose, consent —
so the recording's *existence* is a `team` event
(`call.recording_ready`) while the artefact itself sits behind
`sensitive` and a signed, expiring URL. Playback writes its own access
event.

---

## 6. Sources and how each channel writes

| Channel | Writer | Trigger | `dedupe_key` |
|---|---|---|---|
| WhatsApp | existing inbound webhook | after message insert | `wa:<wamid>` |
| Instagram / Messenger | new Meta webhook route | on delivery | `ig:<mid>` / `fb:<mid>` |
| Website | web SDK → ingest endpoint | visit, page view, chat | `web:<session>:<seq>` |
| Web chat | brain writes `chat_turns` | outbox or trigger | `turn:<chat_turn_id>` |
| Voice | voice agent | call start/end/transcript | `call:<call_id>:<stage>` |
| Cart / order / fulfilment | Comez Edge Function | commerce webhook | `order:<comez_order_id>:<status>` |
| Email | ESP webhook | send/open/click | `email:<message_id>:<event>` |
| Notes / tasks / calendar | CRM app | user action | `note:<id>` |
| AI | summariser, policy engine | on generation | `ai:<kind>:<hash>` |

`UNIQUE (account_id, dedupe_key)` makes every writer safely retryable —
the same guarantee the Comez order upsert already relies on
(6× duplicate upsert → 1 row, verified in Phase 1).

### 6.1 Brain-side events without cross-repo triggers

Web chat, voice and orders are written by the brain into `public`. The
CRM must not put triggers on `public` tables — that is the coupling
Phase 1 explicitly avoided.

**Use the brain's existing `public.events_outbox`.** It already has
`event_type`, `payload`, `delivery_status`, `retries`, `tenant_id`,
`brand_id` — an outbox pattern, already built. A CRM-side poller drains
it into `timeline_events`.

Reuse, not duplication. It does need the brain repo to emit the relevant
event types, which is a coordination item, not a schema change.

---

## 7. Reading the timeline

```sql
CREATE OR REPLACE VIEW customer_timeline AS
SELECT e.*,
       c.name AS contact_name,
       h.handle_type, h.channel AS handle_channel
FROM timeline_events e
LEFT JOIN contacts c         ON c.id = e.contact_id
LEFT JOIN identity_handles h ON h.id = e.handle_id
WHERE is_account_member(e.account_id);
```

Two required read paths:

1. **Person timeline** — `WHERE contact_id = ? ORDER BY occurred_at DESC`.
   Backed by `idx_timeline_contact_time`.
2. **Global priority feed** — `WHERE action_state IN ('open','snoozed')`,
   ordered by priority then time. Backed by the partial index.

Snooze is `action_state='snoozed'` + `snoozed_until`; a scheduled job
flips it back to `open`. No separate table — the state already lives on
the row.

---

## 8. Retention and DPDP

The event row and its payload have **different lifecycles**. That
separation is the whole reason `payload_ref` is a pointer.

| Class | Default retention | On expiry |
|---|---|---|
| Event row (type, time, channel, summary) | 7 years | kept — needed for financial/audit obligation |
| Message bodies | 24 months | `payload_ref` redacted, event kept |
| Call recordings | 90 days | blob deleted, `call.recording_ready` kept |
| Call transcripts | 12 months | redacted to intent summary |
| Raw webhook payloads | 30 days | deleted; `payload_hash` kept for integrity |
| Web page-view detail | 12 months | aggregated, rows dropped |

```sql
CREATE TABLE IF NOT EXISTS retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload_class TEXT NOT NULL,
  retain_days   INTEGER NOT NULL CHECK (retain_days > 0),
  action        TEXT NOT NULL CHECK (action IN ('redact','delete','aggregate')),
  updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, payload_class)
);
```

Redaction writes a `system.retention_redacted` event. The timeline never
develops silent holes.

### DPDP erasure and export

- **Export** — every event for a resolved `contact_id`/`customer_id`,
  plus handles, consent history and merge log, as JSON.
- **Erasure** — payloads deleted, handle values replaced by hashes,
  `contact.name` pseudonymised. Event skeletons (type, time, channel,
  amount) are **retained** where a legal basis requires it, e.g. tax
  records for orders.

> **Open legal question, not an engineering one:** which event classes
> have a retention obligation that overrides an erasure request. Flagged
> in §11 and in the roadmap. It must be answered by a person before the
> erasure path is built.

---

## 9. Worked example — Meera's timeline

Fourteen rows, one person, six channels, one thread.

| `occurred_at` | `event_type` | `channel` | `contact_id` | `confidence` | summary |
|---|---|---|---|---|---|
| 10:02 | `campaign.click` | instagram | NULL | verified | Clicked ad `AD-4471` |
| 10:03 | `message.inbound` | instagram | C1 | verified | "Do you ship to Coimbatore?" |
| 10:05 | `message.outbound` | instagram | C1 | verified | Shipping info + product link |
| 10:06 | `campaign.token_issued` | system | C1 | verified | `ig_to_web`, 7d |
| 10:11 | `campaign.token_redeemed` | web | C1 | **probable** | First use — attribution strong, identity probable |
| 10:11 | `web.visit` | web | C1 | probable | `/products/millet-laddoo` |
| 10:19 | `web.chat_started` | web | C1 | probable | Asked about sugar content |
| 10:24 | `campaign.token_issued` | system | C1 | verified | `web_to_wa`, 1h, single use |
| 10:25 | `message.inbound` | whatsapp | **C1** | **verified** | Prefilled ref matched → phone verified |
| 10:25 | `identity.merged` | system | C1 | verified | Web cluster → WhatsApp contact |
| 10:41 | `cart.abandoned` | web | C1 | verified | ₹840, 2 items |
| 14:02 | `call.inbound` | voice | C1 | verified | ANI unique → RETURNING tier |
| 14:09 | `order.placed` | web | C1 | verified | `#LD-2291`, ₹840 |
| 14:09 | `identity.linked` | system | C1 | verified | Linked to `public.customers` |

Note row 5: `probable` is recorded **as the confidence of that event**,
not hidden. The Hub can show "likely the same person" honestly, and row 9
is where it becomes certain.

---

## 10. Acceptance criteria

1. An anonymous visit is recorded with `contact_id NULL` and no contact
   is created.
2. When that visitor is later identified, the earlier event appears on
   their timeline **without any event row's facts changing**. Proven by
   comparing `event_type`/`occurred_at`/`summary` before and after.
3. `UPDATE timeline_events SET summary = …` raises. Negative control.
4. `DELETE FROM timeline_events` is refused for `authenticated`.
5. Replaying the same webhook 6× produces exactly 1 row (the Phase 1
   Comez idempotency standard).
6. A split moves events back off the wrong contact, again with no fact
   changed.
7. A `sensitive` event is invisible to a member without the grant.
   Positive **and** negative control — the Phase 1 false-pass lesson.
8. Retention redaction clears `payload_ref` and leaves the event.
9. Cross-account read is refused by RLS.
10. Person-timeline query stays index-backed at 1M rows (`EXPLAIN`
    asserted, not assumed).

---

## 11. Unresolved decisions

1. **Partitioning.** ~~Recommendation: defer, add the index set now,
   revisit past ~5M rows.~~ **Decided in `PHASE2_CANONICAL_PLAN.md` §3:**
   unpartitioned at creation for Laddoos-only scope, with the primary key
   and the `dedupe_key` unique constraint made composite (`occurred_at`
   included) so a future conversion needs no constraint changes. Same
   ~5M-row trigger as below, plus "a second brand/tenant is onboarded,"
   whichever comes first — see the canonical plan for the full reasoning
   and reversal cost.
2. **Does the brain write directly, or only via `events_outbox`?**
   Outbox is proposed — no cross-repo triggers. Needs the brain repo to
   agree to emit.
3. **Which event classes survive a DPDP erasure request** (§8). Legal.
4. **Recording consent capture** — IVR announcement, explicit consent, or
   both. Affects whether `call.recording_ready` may exist at all.
5. **Do timeline events belong to `crm` or a new shared schema?**
   Proposed `crm`. A third schema would need a third ownership rule.
6. **Web SDK event volume.** Every page view, or only meaningful ones?
   Recommendation: meaningful only at first — page-view firehose is the
   fastest way to make this table unmanageable.
