# YALI Architecture Review — Phase 1 in Five-Year Context

**For:** founder / product decision-maker, not a database engineer
**Date:** 2026-07-31
**Scope:** architecture, extensibility, roadmap. **Not** code quality.
**Basis:** the Phase 1 working tree (`phase1/fresh-migration-validation`,
uncommitted) plus the generated `public` types read from production.

> Nothing in this document was changed, committed, or applied. It is a
> read-only assessment.

---

## The headline finding

**You already own a multi-channel customer platform. It isn't the CRM —
it's the brain repo.**

`public.sessions` has a **`channel` column**. `public.customers` has
**`last_contact_channel`**, `phone_hash`, `email_hash` and `whatsapp`.
The YALI brain was designed multi-channel from day one. It has voice
(`realtime_turns`), web chat (`sessions`/`chat_turns`), knowledge and
memory (`kb_chunks`, `knowledge_objects`, `skills`), commerce (`orders`,
`commerce_connections`), an event bus (`events_outbox`), and a real
multi-tenant identity spine (`tenants` → `brands` → `customers`).

The CRM has **zero occurrences of the word "channel" across all 42
migrations.** It is a WhatsApp console, top to bottom.

That is not a criticism of Phase 1. wacrm was a WhatsApp CRM, and Phase
1's job was to stop it colliding with the brain — not to rewrite it. But
it reframes the roadmap question completely:

> **The CRM should never become your unified platform. The brain already
> is one. The CRM should become the human operations console on top of
> it.**

Everything below follows from that.

---

## 1. Is the CRM flexible enough to become the unified platform?

**No — and it shouldn't be asked to.**

| Fact | Where | Why it blocks |
|---|---|---|
| `contacts.phone TEXT NOT NULL` | `001_initial_schema.sql:43` | A person is *defined* by having a phone number. An Instagram DM, a website visitor, or an email-only lead cannot exist as a contact. |
| `UNIQUE (account_id, phone_normalized)` | `022_contact_phone_dedup.sql:121` | Phone is the dedupe key. Cross-channel identity needs many handles per person, not one number. |
| No channel column on `messages` or `conversations` | all 42 migrations | Nowhere to record *how* a message arrived. |

**What saves it:** Phase 1 built the right bridge. `crm.contacts.customer_id`
→ `public.customers`, resolved through `workspace_brand_map`, read-only,
never writing to `public`. The CRM already knows how to defer to the
brain for identity. Extend that pattern and you get the platform without
rebuilding the console.

---

## 2. Can it support the eleven capabilities?

"Naturally" meaning: without re-architecting.

| Capability | Verdict | Reality |
|---|---|---|
| **WhatsApp** | Native | Fully built — inbox, templates, media, broadcasts, delivery status, reactions. |
| **Instagram DM** | Half | Same Meta Graph API, so transport is close. But IG users have no phone — `phone NOT NULL` rejects them. |
| **Facebook Messenger** | Half | Identical to Instagram. Same blocker. |
| **Website chat** | Exists — **in the brain** | `sessions.channel` + `chat_turns`. Don't rebuild. Surface it. |
| **Email** | No | No threading, no message-ID chains, no MIME. `content_type` is WhatsApp's media list. Genuinely new work. |
| **Telephone / Voice AI** | Exists — **in the brain** | `realtime_turns` is live. The CRM has no concept of a call. |
| **Unified inbox (Hub-style)** | Right shape, wrong data | `UNIQUE (account_id, contact_id)` means **one thread per person** — exactly the Hub model. But messages carry no channel tag. |
| **Founder Dashboard** | Decided, not built | `/hub` and `/morning` are locked decisions in `CLAUDE.md`; no such pages exist. |
| **Customer Timeline** | Link exists, view doesn't | `contacts.customer_id` connects the worlds. A timeline is a union over `crm.messages` + `public.chat_turns` + `public.realtime_turns` + `public.orders`. Buildable now. |
| **Unified Memory** | Actively conflicting | **Two vector stores.** `crm.ai_knowledge_chunks` (pgvector HNSW, 1536-dim) and `public.kb_chunks` (`match_kb_chunks`). They don't know about each other. |
| **AI Recommendations** | Two half-brains | CRM has `ai_configs` + automations/flows. Brain has `skills`, `knowledge_objects`, `insight_review_queue`. Neither sees the other's context. |

**Pattern:** everything "already in the brain" is duplicated effort if
built in the CRM. Everything marked *No* is a genuine gap.

---

## 3. Reusable as-is

The CRM's real value — hard, boring, done, and channel-agnostic:

- **Team and permissions** — accounts, roles, invitations with anonymous
  peek/redeem, ownership transfer, presence.
- **The inbox UI** — threads, reactions, unread counts, live updates,
  assignment, quick replies.
- **Broadcast infrastructure** — recipient fan-out, incremental counters,
  delivery tracking, Meta template submission and sync.
- **Pipelines and deals.**
- **Automations and flows** — visual builder, run history, event logs.
  This is your recommendation *execution* layer.
- **API keys + outbound webhooks** — scoped `/api/v1`, HMAC-signed.
- **Row-level security** — verified with real cross-workspace isolation.

None of this is channel-specific. All of it survives.

---

## 4. Replace with YALI architecture over time

In order of how much they hurt if left:

1. **Identity — first.** `crm.contacts` stops being the customer record
   and becomes a *channel handle* pointing at `public.customers`. Removes
   `phone NOT NULL` as a blocker for every future channel at once.
2. **Memory — collapse to one store.** Retire `crm.ai_knowledge_chunks`;
   let `public.kb_chunks` be the only knowledge base. Fastest-compounding
   debt on this list — every day it runs, more content lands in the wrong
   place.
3. **Conversations — invert ownership.** `crm.conversations`/`messages`
   become a view over brain session/turn data. The CRM keeps operational
   metadata it owns (assignment, status, unread) and stops owning content.
4. **AI configuration — one persona.** `crm.ai_configs` and the brain's
   `brand_persona`/`skills` answer the same question twice. The brain's
   is more developed.

---

## 5. Leave untouched — already well designed

- **The `crm` / `public` schema split.** One database, two ownership
  domains, shared identity, no cross-project sync. Expensive to get
  right; it is right.
- **`workspace_brand_map`.** Small table, big job: maps a CRM workspace
  to a brain tenant/brand explicitly, so identity matching is never a
  bare phone-hash guess across brands. This is the seam that makes
  multi-brand possible later.
- **Read-only cross-schema access.** The CRM reads `public.customers`
  through one narrow `SECURITY DEFINER` function and can never write.
  One system of record for customers.
- **`sender_type` (`customer` / `agent` / `bot`).** Already
  channel-neutral. Works unchanged for voice, email, Instagram.
- **`webhook_endpoints` + the brain's `events_outbox`.** Integration
  architecture is already correct on both sides.
- **One-conversation-per-contact.** Counter-intuitively this is the
  unified-inbox foundation, not a limitation.
- **The privilege model from migration `041`.** Explicit per-function
  grants, no blanket grants. Keep this discipline permanently.

---

## 6. Phase 1 decisions that limit Phase 2 / Phase 3

| # | Decision | Bites in | Cost to fix later |
|---|---|---|---|
| 1 | Phone as mandatory, unique contact identity | **Phase 2**, at the first non-phone channel | Medium — handles table + data migration |
| 2 | No channel dimension on messages | **Phase 2** | Low now; painful once the table is large |
| 3 | Identity bridge matches on **phone hash only** — `customers.email_hash` exists but is unused | **Phase 2** for email | Low — extend `resolve_customer_candidates` |
| 4 | Second vector store in `crm` | **Phase 2**, growing daily | Rises with content volume |
| 5 | One active brand per workspace + "no multi-tenant scaffolding" | **Phase 3**, if YALI OS serves other founders | High — but `workspace_brand_map` makes it recoverable, not fatal |
| 6 | Two repos sharing one database and one migration ledger | **Already biting** — production blocker 3 | Grows with every migration either repo adds |

**On #6:** blocker 3 is not a paperwork problem, it's an early warning.
Two codebases with independent migration histories against one database
is a structural tension that worsens. Whatever unblocks production should
be chosen as a *five-year* answer, not a workaround.

**On #5:** "no multi-tenant scaffolding" was correct for shipping
Laddoos — the alternative was over-engineering. Just note the asymmetry:
the brain is multi-tenant, the CRM is not. If YALI OS ever serves a
second founder, the CRM is the side that needs work.

---

## 7. YALI OS as a five-year product

### Keep permanently

The **console**: inbox UI, team/roles/invitations, pipelines, broadcasts,
automations, flows, API keys, webhooks, RLS. Channel-agnostic. Still here
in year five.

The **schema split** and the **`workspace_brand_map` seam**. Load-bearing.

### Gradually replace

1. **Identity** (Phase 2 start) — contacts become handles;
   `public.customers` becomes the person.
2. **Memory** (Phase 2) — one vector store.
3. **Message storage** (Phase 3) — CRM conversations become a view.
4. **AI persona** (Phase 3) — one brain, one persona, one skill set.

### Never build — the CRM already does it well

No matter how tempting the greenfield looks:

- Team management, roles, invitations, ownership transfer
- Broadcast fan-out and delivery tracking
- WhatsApp template submission, sync, Meta approval flow
- Inbox thread UI, reactions, presence, unread counts
- Pipelines and deals
- API key management and outbound webhook delivery
- Row-level security architecture

That is the majority of the CRM's value. Every hour rebuilding it is an
hour not spent on the channels and intelligence that differentiate YALI.

---

## The one-sentence roadmap

> **The brain is YALI. The CRM is the cockpit. Keep the cockpit, wire it
> to the brain, and add channels to the brain — never to the CRM.**

Phase 2's first task is therefore **not** "add Instagram to the CRM." It
is **make `public.customers` the identity spine the CRM reads from** —
one change that unblocks Instagram, Messenger, email, voice, timeline and
unified memory simultaneously.

See `PHASE2_PLAN.md`.
