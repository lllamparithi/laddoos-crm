# Phase 2 — Follow-up Policy Engine

**Status:** PROPOSAL. Nothing implemented, nothing applied.
**Companions:** `PHASE2_UNIFIED_TIMELINE_SPEC.md`,
`PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md`

---

## 1. The governing rule

> **No universal 2/5/12-hour sequence.** Every delay, window and limit is
> configuration, evaluated against the customer's actual state at the
> moment of sending — never at the moment of scheduling.

A follow-up scheduled two hours ago must re-check *now* whether the
customer has replied, ordered, opted out, or been assigned to a human.
Scheduling is a *proposal*; sending is a *decision*.

---

## 2. Audit — what exists

| Existing | Reuse |
|---|---|
| `automation_pending_executions` (`run_at`, `status`, `context`) | **The durable scheduler pattern.** Already does delayed execution with pending/running/done/failed |
| `automations` + `automation_steps` + `trigger_config JSONB` | Trigger→action model, and the precedent for JSONB config over hardcoding |
| `flows.fallback_policy JSONB` (`on_timeout_hours`, `max_reprompts`) | The precedent for **policy as data**. Extend the idea; don't invent a new one |
| `flow_runs.status = 'paused_by_agent'` | The precedent for "a human took over, stop automating" |
| `automation_logs` | Audit shape for every send decision |
| `crm.webhook_endpoints`, `broadcast_recipients` | Delivery + per-recipient status |

**Gaps — zero occurrences in `crm`:**

- consent / opt-out / suppression (brain has `leads.consent_flags` only)
- channel policy windows (Meta's 24-hour rule is nowhere encoded)
- intent level as a first-class scheduling input
- re-evaluation at send time

`automation_pending_executions` schedules and fires. It does **not** ask
permission before firing. That gap is this engine.

### Why a separate table rather than extending automations

`automation_pending_executions` is FK'd to `automation_id NOT NULL` and
its semantics are "resume this automation at step N". A follow-up is not
a paused automation — it is a *policy-gated intent to contact a person*,
cancellable by things that have nothing to do with automations (an
order, an opt-out, a human taking over). Overloading it would make both
concepts harder to reason about. The **pattern** is reused; the table is
not.

---

## 3. Proposed SQL

```sql
-- 049_consent.sql   (append-only)

CREATE TABLE IF NOT EXISTS consent_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
  handle_id    UUID REFERENCES identity_handles(id) ON DELETE SET NULL,
  channel      TEXT NOT NULL,
  purpose      TEXT NOT NULL,      -- 'transactional','marketing','recovery','service'
  state        TEXT NOT NULL CHECK (state IN ('granted','withdrawn','never_asked')),
  basis        TEXT NOT NULL,      -- 'explicit_optin','ctwa_initiated','order_relationship','import'
  evidence_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ
);
REVOKE UPDATE, DELETE ON consent_records FROM authenticated, anon, service_role;

-- Current state = latest row per (contact, channel, purpose).
CREATE OR REPLACE VIEW consent_current AS
SELECT DISTINCT ON (contact_id, channel, purpose) *
FROM consent_records
WHERE contact_id IS NOT NULL
ORDER BY contact_id, channel, purpose, occurred_at DESC;

-- Hard stop, independent of consent history. Never auto-cleared.
CREATE TABLE IF NOT EXISTS suppression_list (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  handle_hash  TEXT NOT NULL,
  channel      TEXT NOT NULL,
  scope        TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','marketing','recovery')),
  reason       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, handle_hash, channel, scope)
);
```

Suppression is keyed on `handle_hash`, not `contact_id`, deliberately: an
opt-out must survive a merge, a split, and a contact deletion. A person
who said "stop" must stay stopped even if their contact record is later
restructured.

```sql
-- 050_channel_policies.sql

CREATE TABLE IF NOT EXISTS channel_policies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel               TEXT NOT NULL,
  version               INTEGER NOT NULL DEFAULT 1,
  is_active             BOOLEAN NOT NULL DEFAULT true,

  -- Meta's 24h customer-service window: 1440. Configuration, not a constant.
  session_window_minutes INTEGER,
  requires_template_outside_window BOOLEAN NOT NULL DEFAULT false,
  max_per_day           INTEGER,
  max_per_conversation  INTEGER,
  min_gap_minutes       INTEGER,
  quiet_hours_start     TIME,
  quiet_hours_end       TIME,
  quiet_hours_tz        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  policy_source         TEXT,   -- link to the Meta doc this encodes
  notes                 TEXT,
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, channel, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_policies_active
  ON channel_policies (account_id, channel) WHERE is_active;

CREATE TABLE IF NOT EXISTS channel_policy_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES channel_policies(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  before JSONB, after JSONB, reason TEXT
);
```

Versioned + audited because "why did we message this customer at 11pm"
must be answerable months later against the policy **as it was then**.

```sql
-- 051_followup_rules.sql

CREATE TABLE IF NOT EXISTS followup_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT false,
  priority       INTEGER NOT NULL DEFAULT 100,   -- lower wins
  trigger_event_type TEXT NOT NULL,              -- → timeline_event_types
  conditions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  delay_minutes  INTEGER NOT NULL,
  channel_preference TEXT[] NOT NULL DEFAULT '{}',
  purpose        TEXT NOT NULL,
  max_attempts   INTEGER NOT NULL DEFAULT 1,
  action         JSONB NOT NULL,                 -- template / flow / task / notify
  stop_on        TEXT[] NOT NULL DEFAULT
                   '{customer_replied,order_placed,opted_out,assigned_to_human}',
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS followup_schedule (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_id        UUID REFERENCES followup_rules(id) ON DELETE SET NULL,
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  trigger_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  run_at         TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','sent','suppressed','cancelled','failed')),
  suppression_reason TEXT,
  evaluated_at   TIMESTAMPTZ,
  decision_trace JSONB,                          -- every gate + its verdict
  context        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followup_schedule_due
  ON followup_schedule (run_at) WHERE status = 'pending';
```

`decision_trace` is the auditable answer to "why was this sent / not
sent" — every gate and its verdict, stored on the row.

---

## 4. The nine gates

Evaluated **at send time**, in this order, cheapest and most absolute
first. All must pass. The first failure short-circuits and is recorded.

```
                  followup_schedule row becomes due
                                │
   1. Suppression list?  ───────┼──► suppressed: opted_out          [absolute]
   2. Consent for (channel, purpose)? ─┼──► suppressed: no_consent
   3. Customer acted since scheduling? ┼──► cancelled: customer_replied
                                       │                 order_placed
   4. Assigned to a human?  ───────────┼──► suppressed: human_owned
   5. Channel policy window? ──────────┼──► either use approved template
                                       │    or suppressed: outside_window
   6. Rate limits (per day / conv / gap)? ──► rescheduled
   7. Quiet hours?         ────────────┼──► rescheduled to next permitted
   8. Attempt <= max_attempts? ────────┼──► suppressed: max_attempts
   9. Lifecycle state permits? ────────┼──► suppressed: lifecycle
                                │
                             SEND
                                │
                  timeline: followup.sent  (or followup.suppressed)
```

Gate 3 reads `timeline_events` for any `is_customer_action = true` event
for this contact with `occurred_at > followup_schedule.created_at`. That
is the single flag defined in the timeline taxonomy — one source of truth
for "the customer did something", so every rule agrees.

Gate 5 is where Meta's 24-hour window lives, entirely as data. Outside
the window the engine does not silently drop the message: it either
switches to an approved template (if the rule's action allows) or
suppresses with `outside_window`. Both outcomes are recorded.

---

## 5. Intent-driven rules, as configuration

The request's example rules, expressed as data rather than code:

```jsonc
// High intent → 2 hours
{
  "name": "Abandoned cart — high intent",
  "priority": 10,
  "trigger_event_type": "cart.abandoned",
  "conditions": { "intent_level": "high", "cart_value_min": 500 },
  "delay_minutes": 120,
  "channel_preference": ["whatsapp", "instagram"],
  "purpose": "recovery",
  "max_attempts": 2,
  "action": { "type": "template", "template_name": "cart_recovery_v2" },
  "stop_on": ["customer_replied","order_placed","opted_out","assigned_to_human"]
}
```

```jsonc
// Medium intent → next permitted period (not a fixed hour count)
{
  "name": "Browsed, no cart — medium intent",
  "priority": 50,
  "trigger_event_type": "web.visit",
  "conditions": { "intent_level": "medium", "min_page_views": 3 },
  "delay_minutes": 1440,
  "channel_preference": ["whatsapp"],
  "purpose": "marketing",
  "max_attempts": 1,
  "action": { "type": "template", "template_name": "gentle_nudge_v1" }
}
```

```jsonc
// Low intent → no automated follow-up. Surface to a human instead.
{
  "name": "Low intent — human review only",
  "priority": 90,
  "trigger_event_type": "web.visit",
  "conditions": { "intent_level": "low" },
  "delay_minutes": 0,
  "purpose": "service",
  "action": { "type": "hub_task", "assign_to": "unassigned" },
  "max_attempts": 0
}
```

`intent_level` is read from the living customer summary
(`PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §2) — which is AI-generated and
therefore **advisory**. It may select a rule; it may never override a
gate. An AI that decides someone is "high intent" cannot thereby bypass
consent, quiet hours or the policy window.

---

## 6. Lifecycle states

| State | Automated follow-up |
|---|---|
| `anonymous` | Never — no consent, no verified handle |
| `provisional` | Service/transactional only |
| `engaged` | Per rules |
| `customer` | Per rules, wider purposes |
| `at_risk` | Per rules, recovery purposes |
| `dormant` | Marketing only with explicit re-engagement consent |
| `opted_out` | **Never** |
| `human_owned` | Never, unless the rule sets `allow_when_human_owned` |

Derived from timeline facts, not from the AI summary.

---

## 7. API contracts

```http
POST /api/v1/followups/evaluate      # dry run — returns the gate trace, sends nothing
  Body: { contact_id, rule_id }
  200 → { would_send: bool, decision_trace: [...], next_permitted_at }
```

```http
GET    /api/v1/followups/scheduled?status=pending
POST   /api/v1/followups/:id/cancel   { reason }
POST   /api/v1/consent                { contact_id, channel, purpose, state, basis }
GET    /api/v1/consent/:contact_id
POST   /api/v1/suppression            { handle_hash, channel, scope, reason }
GET    /api/v1/channel-policies       # active set
PUT    /api/v1/channel-policies/:id   # creates a new version + audit row
```

The dry-run endpoint matters: it lets the founder ask "would this fire,
and why" without side effects — and it is how the acceptance tests
exercise the gates.

---

## 8. Acceptance criteria

1. No delay value appears in code. Every one comes from
   `followup_rules` or `channel_policies`. Proven by grepping for
   hardcoded hour constants in the engine.
2. A customer reply between scheduling and firing **cancels** the send.
   Negative control.
3. An opt-out suppresses across every rule, and **survives a contact
   merge and a split** (suppression is handle-keyed).
4. Outside the Meta window, a non-template send is suppressed with
   `outside_window` — never silently dropped.
5. Quiet hours reschedule rather than suppress.
6. Every send and every suppression writes a timeline event with a
   populated `decision_trace`.
7. Changing a channel policy writes `channel_policy_audit`, and
   historical decisions still resolve against the version in force at
   the time.
8. `max_attempts = 0` (low intent) never sends.
9. An AI-assigned `intent_level` cannot bypass gates 1, 2, 5 or 7.
   Explicit negative control.
10. A human taking over a conversation cancels pending automated
    follow-ups.

---

## 9. Unresolved decisions

1. **Consent basis for CTWA-initiated conversations.** Does an
   ad-initiated WhatsApp conversation constitute marketing consent, or
   only service consent? Legal/policy, and it changes gate 2's default.
2. **Does consent expire?** `expires_at` exists on the table; no default
   policy is proposed. Needs a business answer.
3. **Who may edit `channel_policies`?** Proposed: owner only, since a bad
   edit risks the WhatsApp number itself.
4. **Cross-channel fallback.** If WhatsApp is outside the window, may the
   engine fall back to Instagram? Convenient, and arguably an end-run
   around a platform policy. Recommendation: **no** by default,
   per-rule opt-in.
5. **Scheduler runtime.** Reuse the existing `automations/cron` route, or
   a Supabase scheduled function? The existing cron is proven; prefer it.
6. **Does an inbound call count as `customer_replied` for gate 3?**
   Recommendation: yes — `call.inbound` is already
   `is_customer_action = true` in the taxonomy.
