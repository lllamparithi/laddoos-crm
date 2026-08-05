# Phase 2 Glossary — Canonical Terminology

**Purpose:** one name per concept. Every term below is the name to use in
all future documents, code comments, and migrations. Where a synonym
exists in an already-written document, it is named so it can be retired
without confusion about what it meant.

This glossary resolves the terminology findings in
`PHASE2_DOCUMENT_AUDIT.md` §2 and §6. It does not resolve open
architectural questions — those are in `PHASE2_ARCHITECTURE_DECISIONS.md`.

---

## Core identity concepts

### `identity_handle`
A single observed fact that a channel-scoped identifier exists — an
Instagram-scoped ID, a WhatsApp `wa_id`, a web visitor ID, a verified
phone. **Immutable once recorded**; a handle is never edited or merged,
only re-clustered under a different contact.

- **Table:** `crm.identity_handles`
- **Retire:** `contact_handles` (used only in `PHASE2_PLAN.md`, now superseded)

### `identity_evidence`
A single piece of evidence that a specific `identity_handle` belongs to a
specific `contact` — with a type, a confidence, and a source event.
Evidence accumulates; it is what a merge or split decision is based on.

- **Tables:** `crm.identity_evidence`, `crm.identity_evidence_policy`
- **No synonym conflict found.**

### `contact`
A **provisional, workspace-scoped hypothesis** that a cluster of
`identity_handles` belongs to one person. May be wrong. May be split.
Lives entirely in `crm`.

- **Table:** `crm.contacts` (pre-existing, Phase 1)
- **Do not confuse with `customer`** (below) — this is the single most
  important distinction in the whole system and the one every document
  gets right already. Keep it that way.

### `customer`
The **canonical, verified person**, owned by the brain, identified across
every brand and channel. A `contact` links to a `customer` only once
evidence clears the bar; a `contact` may never link to one at all.

- **Table:** `public.customers` (brain-owned, read-only from `crm`)

### Confidence — three distinct scopes, not one field

| Term | Scope | Field |
|---|---|---|
| **event confidence** | How sure we are this recorded fact is what it claims to be | `timeline_events.confidence` |
| **identity confidence** | How sure we are this contact's handle cluster is one person | `contacts.identity_confidence` |
| **link confidence** | How sure we are this contact is this specific customer | `contacts.customer_link_confidence` |

All three use the same five-value scale (`verified` / `strong` /
`probable` / `unknown` / `rejected`) but answer three different
questions. When writing about "confidence" in any future document, name
which of the three is meant.

### `identity_merge_log`
The append-only audit record of every merge, split, link, unlink, and
rejection decision — who made it, on what evidence, and whether it
reverses an earlier one.

- **Table:** `crm.identity_merge_log`
- **Open question, not resolved by this glossary:** whether this should
  remain a separate table from `timeline_events`' own
  `identity.merged`/`identity.split`/`identity.rejected` event rows, given
  both currently record the same operation. See
  `PHASE2_ARCHITECTURE_DECISIONS.md`.

### `continuation_token`
A signed, opaque, expiring reference that carries attribution (and,
narrowly, identity) across a channel boundary — Instagram→website,
website→WhatsApp.

- **Table:** `crm.continuation_tokens`
- **Never** call this a "tracking link," a "referral code," or a
  "handoff token" in a future document — pick this one name.

---

## Core timeline concepts

### `timeline_event`
A single append-only record of something that happened to a contact or
customer, on some channel, at some time, with a confidence and a
visibility. Stores a pointer to its source content, never the content
itself.

- **Table:** `crm.timeline_events`
- **Do not** call this "activity log," "event log," or "history record"
  in future prose — one name.

### `customer_summary`
The generated, regenerable, cited interpretation of a contact's current
state (intent, objections, buying stage, etc.) — separate from and never
overwriting the factual timeline.

- **Table:** `crm.customer_summaries` (plural table, singular concept —
  this is a normal SQL naming convention, not an inconsistency)
- **Retire:** "living customer summary" as a full phrase once this
  glossary exists; "customer summary" alone is enough.

### `founder_insight`
A generated, evidenced, aggregate finding across many contacts — a
pattern, a demand signal, an objection cluster — always citing the events
and the contact count behind it.

- **Table:** `crm.insights` — **note the table name is plural and
  generic; "founder insight" is the concept name, `insights` is the SQL
  identifier.** Both are correct at their own level; don't expect a table
  called `founder_insights`.
- **The capability, as a whole,** is called **Founder Intelligence** (the
  title of `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md`) — a third, broader term
  for the same area. Use "Founder Intelligence" for the capability,
  "founder insight" for one row, `insights` for the table.

---

## System and repo terms

### `crm`
This repository (`laddoos-crm`) and its Postgres schema of the same
name. Owns channel identity, the operational surface (inbox, team,
pipelines), and — per this glossary — `identity_handles`,
`timeline_events`, `customer_summaries`, and `insights`.

### `brain`
The YALI brain application (`D:\SAAS Project\Yali 2.0\Yali Build 2.0`)
and its Postgres schema, `public`. Owns the canonical `customer`, memory
(`kb_chunks`), persona, skills, and voice/chat session data.

- **Retire:** "the Yali brain app," "Yali Build 2.0" as a stand-in for
  the schema — use "brain" for the system, `public` for the schema, and
  name the repo path only when the distinction matters (e.g., pointing
  someone to the actual code).

### `account`
The existing Phase 1 tenancy boundary in `crm` — one signed-up workspace.

- **Table:** `crm.accounts`
- **Known pre-existing inconsistency, not to be fixed by renaming (out of
  scope for Phase 2):** the foreign key column in
  `workspace_brand_map.crm_workspace_id` references `accounts(id)` but is
  not named `account_id`. Every future migration should use `account_id`
  for new foreign keys to `accounts`, even though this one legacy column
  does not. Do not go back and rename the Phase 1 column — that's a
  separate, unrelated migration with its own risk, not part of Phase 2.
- **In prose,** "workspace" and "account" are used interchangeably
  throughout every Phase 2 document. Both are acceptable in prose; there
  is no table called `workspaces`.

### `Hub`
The unified, cross-channel inbox — one chronological stream, one place
to act, channel as metadata. The planned `/hub` page.

- Synonym: **"BlackBerry Hub"** is the *interaction-model reference*, not
  a second name for the same feature — use it only when explaining the
  inspiration, not when referring to the feature itself.
- **Do not confuse with Founder Dashboard** (below) — different page,
  different purpose.

### Founder Dashboard
The KPI/metrics digest view. The planned `/morning` page.

- Synonym in some prose: "morning digest." Both refer to the same planned
  page; prefer "Founder Dashboard" as the capability name and "`/morning`"
  when naming the actual route.

### `tags` (not "labels")
The existing Phase 1 tagging system.

- **Tables:** `crm.tags`, `crm.contact_tags`
- If a future document says "labels," it means this. There is no
  separate "labels" concept or table — "labels" was the generic term
  used in this session's own task prompt; the codebase's actual name is
  `tags`.

### `automations` and `flows` — two distinct existing systems, both real

- **`automations`** (`crm.automations`, `automation_steps`,
  `automation_logs`, `automation_pending_executions`): trigger→action
  rules with branching steps and a durable `run_at`-based scheduler.
- **`flows`** (`crm.flows`, `flow_nodes`, `flow_runs`, `flow_run_events`):
  customer-facing conversational flows (buttons, lists, collected input).

Both exist today, are unrelated to each other, and are both relevant to
Phase 2's Follow-up Policy Engine (which reuses the `automations`
scheduler pattern, not `flows`'). Do not conflate the two in a future
document.

---

## Terms to retire entirely

| Retire | Use instead |
|---|---|
| `contact_handles` | `identity_handles` |
| "the Yali brain app" (as a schema stand-in) | `brain` (system) / `public` (schema) |
| "living customer summary" | `customer_summary` |
| "activity log" / "event log" (for the new table) | `timeline_event` |
| "tracking link" / "referral code" / "handoff token" | `continuation_token` |
| "labels" (as a table reference) | `tags` |
| "workspaces" (as a table reference — no such table exists) | `accounts`, described in prose as "workspace" if needed |
