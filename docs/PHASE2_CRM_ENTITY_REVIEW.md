# Phase 2 — Existing CRM Entity Review

**Purpose:** for each existing CRM entity, decide what stays unchanged,
what gets extended, and what must never be duplicated by
`timeline_events` or any other new Phase 2 table. No implementation —
architectural recommendation only.

**Note on naming:** this review uses the task's own terms ("workspaces,"
"labels") alongside the codebase's actual names, per
`PHASE2_GLOSSARY.md`. Where they differ, both are given once, then the
codebase name is used.

---

## `contacts`

- **Table:** `crm.contacts` (Phase 1, `001_initial_schema.sql`)
- **Recommendation: extend, do not replace.**
- **What stays:** the table itself, its RLS, its account-scoping, its
  role as the workspace-scoped provisional-identity record.
- **What extends:** `phone` becomes nullable; `identity_confidence` and
  the widened `customer_link_confidence` scale are added (see
  `PHASE2_ARCHITECTURE_DECISIONS.md` B3). The dedupe mechanism
  (`findExistingContact`) is replaced by handle-based resolution, but the
  table it resolves *into* is unchanged.
- **Never duplicate:** do not create a second "person" table in `crm`.
  `identity_handles` records observations *about* a contact; it is not a
  parallel contact table. A contact remains the one workspace-scoped
  hypothesis a cluster of handles belongs to.
- **Relationship to `timeline_events`:** `timeline_events.contact_id`
  points here. The timeline does not replace `contacts` — it is the
  history *of* a contact, not a substitute for having one.

---

## `messages`

- **Table:** `crm.messages` (Phase 1, `001_initial_schema.sql`)
- **Recommendation: extend for its own channel; do not extend its
  *concept* to other channels.**
- **What stays:** the table, its WhatsApp-specific columns
  (`content_type`, `media_url`, `template_name`, delivery `status`),
  its role as the system of record for how a WhatsApp message was
  actually sent and delivered.
- **What must never happen:** adding a `channel` column here to make it
  generic (`PHASE2_ARCHITECTURE_DECISIONS.md` C2 — decided against,
  though `PHASE2_PLAN.md` still describes doing this and has not been
  corrected). `messages` should stay exactly what it is: the WhatsApp
  delivery record.
- **Relationship to `timeline_events`:** **`timeline_events` is the
  source of truth for *that a message happened*; `crm.messages` remains
  the source of truth for *what was sent and its delivery status*.**
  This is a CQRS split (`PHASE2_ARCHITECTURE_DECISIONS.md` C1), not a
  replacement in either direction. A timeline event for an inbound
  WhatsApp message stores a pointer to the `messages` row
  (`payload_ref: {"table":"crm.messages","id":"…"}`), never a copy of
  its content.
- **Future channels (Instagram DM, email) get their own storage** if
  they need channel-specific mechanics (media handling, delivery
  receipts) — they do not get bolted onto `crm.messages`, and they do
  not need to, because `timeline_events` is where cross-channel reads
  happen.

---

## `conversations`

- **Table:** `crm.conversations` (Phase 1, `001_initial_schema.sql`,
  uniqueness added in `036_conversation_contact_dedup.sql`)
- **Recommendation: extend, with one required addition.**
- **What stays:** the `UNIQUE (account_id, contact_id)` constraint — this
  is, verified across this review, the correct foundation for the Hub's
  "one thread per person" principle. Do not relax or remove it.
- **What must extend, and does not today:** `unread_count` and
  `last_message_at` currently update only from `crm.messages` inserts
  (`PHASE2_ARCHITECTURE_DECISIONS.md` C3). This is the single most
  concrete gap between the Hub as designed and the Hub as it would
  actually behave if every other document shipped unchanged. A trigger
  or scheduled projection from `timeline_events` into these two columns
  is required before any non-WhatsApp channel is expected to show up
  correctly in the existing inbox.
- **Never duplicate:** do not create a second "thread" concept
  per-channel (an "Instagram conversation" table, a "call conversation"
  table). One `conversations` row per `(account, contact)` already
  generalizes across channels by design; it just isn't fed by them yet.
- **Relationship to `timeline_events`:** `conversations` is a
  **read-optimized summary row** (what's the latest activity, how many
  unread) that should be derived from `timeline_events`, not an
  independent source of activity state.

---

## Accounts ("workspaces")

- **Table:** `crm.accounts`
- **Recommendation: unchanged.**
- **What stays:** the entire tenancy model — one signed-up account, its
  members, roles, invitations, presence.
- **Never duplicate:** do not introduce a second tenancy concept for
  Phase 2 (e.g., a "brand" boundary inside `crm` mirroring the brain's
  tenant/brand model). The existing `workspace_brand_map` already bridges
  one `crm` account to one brain `(tenant_id, brand_id)` pair — that
  bridge is the right mechanism, and the tenancy-mismatch it papers over
  (`PHASE2_ARCHITECTURE_DECISIONS.md` F2) is a Phase 3 question, not a
  reason to build a second boundary now.
- **Relationship to `timeline_events`:** `timeline_events.account_id`
  plus denormalized `tenant_id`/`brand_id` — no new tenancy concept
  needed, just the existing one carried onto the new table.

---

## Tags ("labels")

- **Tables:** `crm.tags`, `crm.contact_tags`
- **Recommendation: unchanged.**
- **What stays:** as-is. Tags are a contact-classification mechanism,
  orthogonal to identity and to the timeline.
- **Never duplicate:** do not invent a separate tagging mechanism for
  timeline events or insights. If tagging timeline events is ever
  needed, extend the existing `tags`/`contact_tags` pattern rather than
  building a parallel one.
- **Relationship to `timeline_events`:** none required for Phase 2A/B/C.
  A `tag.added`/`tag.removed` event type could be added to the taxonomy
  later if tag changes need to appear on the timeline — not required now.

---

## Pipelines

- **Tables:** `crm.pipelines`, `pipeline_stages`, `deals`
- **Recommendation: unchanged.**
- **What stays:** the entire sales-pipeline model as-is.
- **Never duplicate:** `customer_summaries.buying_stage` (Founder
  Intelligence) is a *generated, AI-inferred* stage assessment, distinct
  from a `deals` row's actual pipeline stage, which is a *human-set,
  authoritative* value. These must never be presented as the same field
  or allowed to silently override one another. Where both exist for the
  same contact, the pipeline's `deals.stage` is authoritative for
  operational purposes; the summary's `buying_stage` is advisory context
  only.
- **Relationship to `timeline_events`:** a `deal.stage_changed` event
  type is a reasonable future addition to the taxonomy (not currently
  specified in any Phase 2 document) so pipeline movement shows up on
  the unified timeline — worth adding when pipelines are brought into
  Hub scope, not required for 2A/2B/2C.

---

## Notes

- **Table:** `crm.contact_notes`
- **Recommendation: unchanged, extend into the timeline as pointers.**
- **What stays:** the table itself, as the place a note's actual text
  lives.
- **Never duplicate:** the Unified Timeline Spec's `note.added`/
  `note.edited` event types (already specified) must store a pointer to
  `contact_notes`, not a copy of the note text. This is already correctly
  specified (`payload_ref`), not a gap — recorded here to confirm it,
  not to flag a defect.
- **Relationship to `timeline_events`:** a projection, exactly as
  designed. No change recommended.

---

## Automations (and Flows)

- **Tables:** `crm.automations`, `automation_steps`, `automation_logs`,
  `automation_pending_executions`; separately, `crm.flows`, `flow_nodes`,
  `flow_runs`, `flow_run_events`.
- **Recommendation: unchanged; reused as infrastructure, not extended in
  shape.**
- **What stays:** both systems, entirely as-is. `automation_pending_executions`'s
  `run_at`/status pattern is the correct scheduler primitive to reuse for
  the Follow-up Policy Engine (out of scope for 2A/2B/2C, but relevant to
  name here since it's the mechanism, not a new one).
- **Never duplicate:** the Follow-up Policy Engine must **not** become a
  third scheduling system alongside `automations` and `flows`. It reuses
  the `automation_pending_executions` *pattern* (a `followup_schedule`
  table with the same `run_at`/status shape), which is a new table for a
  new purpose, not a new mechanism — this distinction matters: reusing a
  *pattern* is correct; inventing a *third scheduler* would not be.
- **Relationship to `timeline_events`:** `automation_logs` and
  `flow_run_events` are execution logs for their own systems and should
  **not** be replaced by `timeline_events`. A customer-facing consequence
  of an automation or flow run (a message sent, a tag applied) already
  shows up on the timeline through its own event type
  (`message.outbound`, `tag.added`); the automation/flow's internal
  execution trace (which step, which branch, why it failed) is a
  different audience (the operator debugging the automation) and belongs
  where it already lives.

---

## Summary table

| Entity | Unchanged | Extended | Never duplicate | Timeline relationship |
|---|---|---|---|---|
| `contacts` | RLS, tenancy, role as provisional identity | `phone` nullable, confidence columns, handle-based dedupe | A second "person" table | Pointed to (`contact_id`) |
| `messages` | WhatsApp-specific columns and delivery mechanics | Nothing — stays WhatsApp-only | A generic cross-channel message table | Pointed to (`payload_ref`) |
| `conversations` | Uniqueness constraint | **Must gain**: sync from timeline events | A per-channel thread concept | Should be derived from, not independent of |
| `accounts` | Entire tenancy model | Nothing | A second tenancy boundary | Denormalized onto every event |
| `tags` | Entirely | Nothing needed for 2A/2B/2C | A parallel tagging system | Optional future event type only |
| `pipelines`/`deals` | Entirely | Nothing needed for 2A/2B/2C | Confusing `buying_stage` with `deals.stage` | Optional future event type only |
| `contact_notes` | Entirely | Nothing — already correctly pointer-based | A copy of note text on the timeline | Correctly a projection already |
| `automations`/`flows` | Both systems entirely | Nothing in shape — pattern reused, not the tables themselves | A third scheduler | Consequences appear via their own event types; execution traces stay put |
