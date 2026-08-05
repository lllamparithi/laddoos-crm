# Phase 2 — Living Customer Summary & Founder Intelligence

**Status:** PROPOSAL. Nothing implemented, nothing applied.
**Companions:** `PHASE2_UNIFIED_TIMELINE_SPEC.md`,
`PHASE2_FOLLOWUP_POLICY_ENGINE.md`

Two derived layers, one governing rule. §2 covers the per-customer
summary; §3–4 the per-business intelligence; §5 the Hub interface that
displays both.

---

## 1. The governing rule

> **Generated content never overwrites factual history, and never stands
> without citation.**

`timeline_events` is fact. Everything in this document is derived,
regenerable, and disposable. If a summary and the timeline disagree, the
timeline is right and the summary is stale.

Enforced structurally, not by convention:

- Summaries live in their own tables. Nothing here writes to
  `timeline_events` except a single `ai.summary_updated` marker event.
- The summariser role holds **no `UPDATE` on `timeline_events`** — and
  the immutability trigger (`TIMELINE_SPEC §2.1`) would reject it anyway.
- Every generated field carries `source_event_ids UUID[]`. A field with
  no citation is invalid and must not render.

Per the Phase 1 `041` lesson, each new function declares its own explicit
`REVOKE`/`GRANT`. No blanket grants.

---

## 2. Living customer summary

### 2.1 Audit

Nothing in `crm` generates or stores a per-customer summary. The brain
has adjacent state — `chat_session_state` (`last_intent`,
`last_sub_intent`, `preferred_language`) and `customers`
(`sentiment`, `lead_score`, `last_intent`, `dormant_flag`) — but both are
**session-scoped or single-channel**, computed from the brain's own
conversations. Neither sees Instagram, WhatsApp, voice or orders
together.

**Reuse where possible:** seed `preferred_channel` and `sentiment` from
the brain's values when present rather than recomputing, and cite them.
**New where necessary:** the cross-channel synthesis itself.

### 2.2 Table

```sql
-- 052_customer_summaries.sql

CREATE TABLE IF NOT EXISTS customer_summaries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id     UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  customer_id    UUID,                       -- public.customers.id, no FK

  current_intent            TEXT,
  intent_level              TEXT CHECK (intent_level IN ('high','medium','low','none')),
  products_of_interest      JSONB NOT NULL DEFAULT '[]'::jsonb,
  objections                JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_concerns         JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment                 TEXT CHECK (sentiment IN ('positive','neutral','negative','mixed')),
  preferred_channel         TEXT,
  buying_stage              TEXT CHECK (buying_stage IN
                              ('awareness','consideration','intent','purchase','retention','churned')),
  last_meaningful_event_id  UUID REFERENCES timeline_events(id) ON DELETE SET NULL,
  unresolved_promise        TEXT,
  unresolved_promise_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL,
  recommended_next_action   TEXT,

  -- Citations. One array per generated field; an uncited field is invalid.
  citations      JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- {"current_intent":["<event_id>",…],"objections":["<event_id>",…]}

  -- Provenance
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  model             TEXT NOT NULL,
  input_event_count INTEGER NOT NULL,
  input_through_event_id UUID,      -- last event considered: makes staleness computable
  confidence        TEXT NOT NULL DEFAULT 'probable'
                      CHECK (confidence IN ('verified','strong','probable','unknown')),
  is_current        BOOLEAN NOT NULL DEFAULT true,
  superseded_by     UUID REFERENCES customer_summaries(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_summaries_current
  ON customer_summaries (contact_id) WHERE is_current;

-- Summaries are versioned, not edited: regeneration inserts and flips
-- the previous row's is_current. Keeps "what did we believe on the 3rd?"
-- answerable, and makes a bad generation diffable.
```

`unresolved_promise` is the highest-value field and the one most likely
to be wrong, so it is the one that most needs its citation: *"Promised
Tuesday dispatch"* is only actionable if the founder can click straight
to the message where someone promised it.

### 2.3 Staleness, not truth

A summary is valid only relative to the events it saw.

```sql
CREATE OR REPLACE VIEW customer_summaries_freshness AS
SELECT s.*,
       (SELECT count(*) FROM timeline_events e
         WHERE e.contact_id = s.contact_id
           AND e.occurred_at > s.generated_at) AS events_since,
       (SELECT max(e.occurred_at) FROM timeline_events e
         WHERE e.contact_id = s.contact_id) AS last_event_at
FROM customer_summaries s
WHERE s.is_current;
```

The Hub shows a summary with `events_since > 0` as **stale**, with the
count. It never silently displays a summary as current when the timeline
has moved on. Regeneration is triggered by meaningful events, not on a
timer.

### 2.4 Rules

1. A field with no citation does not render.
2. A citation must reference an event the reader is permitted to see —
   `sensitive` events cited into a `team`-visible summary must be
   redacted from the summary, not silently exposed. **The summary
   inherits the strictest visibility of its cited sources.**
3. A summary never writes a timeline event except `ai.summary_updated`.
4. Regeneration is idempotent given the same inputs.
5. A human may pin or correct a summary field; a pinned field is never
   regenerated, following the `customer_link_source = 'manual'`
   precedent from `039`.

---

## 3. Founder intelligence

### 3.1 Audit

The brain already has three related tables. Reuse, do not duplicate:

| Brain table | Covers | Phase 2 relationship |
|---|---|---|
| `product_demand_signals` | asked-for products not in catalogue, with `notify_consent` | **Forward to it.** Do not create a second demand table |
| `insight_review_queue` | review workflow for generated insights | Reuse the workflow if its shape fits |
| `market_intelligence_raw` | external market data | Untouched — different input class |
| `content_outputs` | generated content | Consumer of `content_opportunity` insights |

What is genuinely new: **aggregation across CRM channel events.** The
brain aggregates its own conversations; nothing aggregates Instagram +
WhatsApp + voice + cart + order together, because until Phase 2 nothing
recorded them together.

### 3.2 Table

```sql
-- 053_insights.sql

CREATE TABLE IF NOT EXISTS insights (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  brand_id       UUID NOT NULL,

  insight_type   TEXT NOT NULL,     -- see §3.3
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,

  -- Evidence. Every one of these is REQUIRED — an insight without
  -- evidence is an opinion and must not be stored.
  supporting_event_count INTEGER NOT NULL CHECK (supporting_event_count > 0),
  affected_contact_count INTEGER NOT NULL CHECK (affected_contact_count > 0),
  sample_event_ids  UUID[] NOT NULL DEFAULT '{}',   -- capped sample for drill-down
  evidence_query    JSONB NOT NULL,                 -- reproducible: params + filter
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  channels          TEXT[] NOT NULL DEFAULT '{}',

  conversion_impact JSONB,          -- {"metric":"cart_recovery_rate","delta":-0.14,
                                    --  "baseline":0.31,"measurable":true}
  confidence        TEXT NOT NULL
                      CHECK (confidence IN ('high','medium','low')),
  suggested_action  TEXT NOT NULL,
  action_type       TEXT,           -- 'content','product','ops','campaign','policy'

  status            TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','reviewed','actioned','dismissed','expired')),
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  dismissal_reason  TEXT,

  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  model             TEXT,
  forwarded_to_brain_at TIMESTAMPTZ,   -- product_demand_signals handoff
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_insights_status
  ON insights (account_id, status, generated_at DESC);
```

`evidence_query` is the key column. It stores the filter that produced
the insight so the founder can click "show me the 23 conversations" and
get **the actual rows**, recomputed live rather than a frozen claim. An
insight whose query returns nothing is self-evidently expired.

### 3.3 Insight types and their sources

| Type | Derived from | Measurable impact |
|---|---|---|
| `repeated_question` | clustered `message.inbound` + `web.chat_turn` | deflection rate |
| `emerging_product_demand` | product mentions with no matching SKU → **forward to `public.product_demand_signals`** | lost-order estimate |
| `common_objection` | objections across `customer_summaries`, cited back to events | stage conversion |
| `delivery_concern` | `message.inbound` near `fulfilment.*` | repeat-order rate |
| `campaign_quality` | `campaign.click` → `order.placed` by `campaign_id` | CAC / conversion |
| `channel_conversion` | first-touch channel → order | per-channel conversion |
| `abandoned_cart_reason` | `cart.abandoned` + subsequent messages | recovery rate |
| `call_reason` | `call.transcript_ready` clustering | call volume, AHT |
| `content_opportunity` | repeated questions with no KB coverage → `content_outputs` | deflection |
| `product_opportunity` | demand + objection cross-reference | revenue estimate |
| `operational_problem` | `message.failed`, `followup.suppressed`, `fulfilment.failed` spikes | error rate |

Campaign quality and channel conversion are only possible because
`campaign_id`/`ad_id` are on `timeline_events` from day one — the reason
those columns are in the Phase 2A table rather than added later.

### 3.4 Honesty rules

1. **No insight without evidence.** Enforced by the `CHECK` constraints
   above, not by prompt instruction.
2. **`conversion_impact.measurable` may be `false`.** "We cannot measure
   this yet" is a valid, useful answer and must be representable.
3. **Minimum support.** Below a configurable threshold (default 5 events
   across 3 contacts) an observation is not an insight. Three complaints
   is not a trend.
4. **Confidence reflects sample and period**, and is displayed.
5. **Dismissal is remembered.** A dismissed insight does not regenerate
   next week unless its evidence materially changes.

---

## 4. Hub interface

### 4.1 Principle

> The channel icon is metadata, not a filing system.

One feed. A WhatsApp message and an Instagram DM from the same person sit
adjacent, in time order. Channel is a badge and a filter, never a
separate inbox. This is already supported by `conversations` UNIQUE
`(account_id, contact_id)` — the Phase 1 constraint that turned out to be
the Hub's foundation.

### 4.2 Surfaces

| Surface | Query | Backed by |
|---|---|---|
| Customer timeline | `contact_id = ? ORDER BY occurred_at DESC` | `idx_timeline_contact_time` |
| Global priority feed | `action_state IN ('open','snoozed')` | `idx_timeline_open_actions` |
| Saved views | stored filter JSON | `saved_views` (below) |
| Context panel | current summary + open promises + last order | `customer_summaries` |
| Inline actions | reply, snooze, assign, task, link identity | writes governance columns only |
| Snooze/resurface | `action_state='snoozed'` + `snoozed_until`; job flips to `open` | same row |
| Search | full-text over `summary` | `tsvector` on `summary`, mirroring the `ai_knowledge_chunks` FTS pattern from `030` |
| Channel filter | `channel = ANY(?)` | `idx_timeline_type_time` |
| Calendar / tasks | `calendar.*`, `task.*` events | same table |
| AI summary | current row, staleness badge | `customer_summaries_freshness` |
| Source evidence | click a summary field → cited events | `citations` |

```sql
CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- NULL = shared
  name       TEXT NOT NULL,
  filter     JSONB NOT NULL,
  sort       TEXT NOT NULL DEFAULT 'occurred_at_desc',
  is_pinned  BOOLEAN NOT NULL DEFAULT false,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Reuse `crm.notifications` for per-agent alerting rather than building a
second notification system; the Hub feed is the *shared* queue, and
notifications remain the *personal* one.

---

## 5. API contracts

```http
GET  /api/v1/customers/:contact_id/timeline?before=&channels=&types=&limit=
GET  /api/v1/customers/:contact_id/summary        # + freshness
POST /api/v1/customers/:contact_id/summary/regenerate
POST /api/v1/customers/:contact_id/summary/pin    { field, value, reason }

GET  /api/v1/hub/feed?view=&status=open
POST /api/v1/hub/events/:id/snooze                { until }
POST /api/v1/hub/events/:id/assign                { user_id }
POST /api/v1/hub/events/:id/dismiss               { reason }

GET  /api/v1/insights?status=new&type=
GET  /api/v1/insights/:id/evidence                # runs evidence_query live
POST /api/v1/insights/:id/review                  { status, reason }

GET  /api/v1/saved-views
POST /api/v1/saved-views                          { name, filter, sort }
```

`GET /insights/:id/evidence` executing the stored query live — rather
than returning a cached list — is what makes an insight auditable instead
of assertable.

---

## 6. Acceptance criteria

1. Every rendered summary field has ≥1 citation; an uncited field fails
   to render. Negative control.
2. No summary write can modify a `timeline_events` fact column. Proven by
   attempting it and asserting the trigger raises.
3. A summary citing a `sensitive` event is redacted for a member without
   that grant. Positive **and** negative control.
4. `events_since > 0` renders as stale, with the count.
5. A pinned field survives regeneration.
6. An insight below the support threshold is not created.
7. `GET /insights/:id/evidence` returns exactly
   `supporting_event_count` rows at generation time.
8. `conversion_impact.measurable = false` renders honestly rather than
   showing a fabricated number.
9. A dismissed insight does not regenerate on unchanged evidence.
10. `emerging_product_demand` forwards to `public.product_demand_signals`
    and sets `forwarded_to_brain_at` — no duplicate demand store.
11. The Hub feed shows two channels for one person in a single
    chronological thread.

---

## 7. Unresolved decisions

1. **Who writes `product_demand_signals`?** It is brain-owned; the CRM
   must not write to `public`. Proposed: emit via `webhook_endpoints` /
   `events_outbox` and let the brain insert. Needs brain-repo agreement.
2. **Summary regeneration cost.** Per meaningful event, batched hourly,
   or on-open? Recommendation: **on-open with a staleness check**, which
   avoids paying for customers nobody looks at.
3. **Which model, and whose key?** `crm.ai_configs` holds a per-account
   BYO key; the brain has its own. The architecture review recommends
   converging on one — this is where it first bites.
4. **Insight support threshold** default (proposed 5 events / 3
   contacts). Business call.
5. **Does the founder see cross-contact `sensitive` content in
   aggregate insights?** Aggregation can leak what per-record visibility
   protects. Recommendation: insights cite only `team`-visible events
   unless the viewer holds the grant.
6. **Sentiment source of truth** — the brain already computes
   `customers.sentiment` from its own channels. Reconcile or keep both
   with provenance? Recommendation: keep both, always labelled.
