# Phase 2 — Identity Spine and the Channel Dimension

> **SUPERSEDED.** This entire document is superseded by
> `PHASE2_SCOPE_REDUCTION.md` (scope) and `PHASE2_CANONICAL_PLAN.md`
> (migration order and naming). In particular: the migration numbers
> below (`043`–`045`) do not match the canonical order; `contact_handles`
> is not the canonical table name (`identity_handles` is — see
> `PHASE2_GLOSSARY.md`); and Stage 1's proposal to add a `channel` column
> to `crm.messages`/`conversations` was explicitly rejected (see
> `PHASE2_ARCHITECTURE_DECISIONS.md` C2). Retained for history only. Do
> not use this document to write a migration.

**Status:** DRAFT — not started, nothing applied, no migration written
**Depends on:** Phase 1 committed + production blocker 3 resolved
**Basis:** `YALI_ARCHITECTURE_REVIEW.md`

---

## Goal, in one sentence

> Make `public.customers` the identity the CRM reads from, and give
> messages a channel — so every future channel is an addition, not a
> rewrite.

Phase 2 does **not** add Instagram, email or voice as features. It
removes the reasons they are currently impossible, then proves it with
one second channel.

---

## The insight that makes this small

The CRM has **one choke point for identity**. `findExistingContact()`
in `src/lib/contacts/dedupe.ts` has exactly four non-test call sites:

| Call site | Path |
|---|---|
| `src/app/api/whatsapp/webhook/route.ts:996,1034` | inbound message |
| `src/lib/whatsapp/resolve-conversation.ts:92,117` | API send |
| `src/lib/api/v1/contacts.ts:125,145` | public API create |
| `src/components/contacts/contact-form.tsx:96,207` | manual / CSV |

Every path that can create a person routes through that one function.
Change the resolution primitive there and all four follow. This is the
difference between Phase 2 being a quarter and being a fortnight of
schema work plus careful testing.

**Corollary — do not fix these paths individually.** A guard added to
the webhook alone leaves three siblings broken.

---

## What the brain already gives us

Verified against the generated `public` types (read from production):

- `public.customers.phone_hash` **and `email_hash`** — the bridge can
  already match on email; migration `039` just doesn't use it.
- `public.customers.last_contact_channel` — the brain already thinks in
  channels.
- `public.sessions.channel` — the brain's conversation model is already
  channel-aware.

**Gap:** `public.customers` has no Instagram/Messenger handle column.
An IG-only person therefore cannot link to a customer yet. That is
**fine and non-blocking** — they stay `customer_id NULL`, the exact
existing zero-match path. Closing it is a brain-repo coordination item,
not a Phase 2 blocker.

---

## Critical path

Four stages, smallest blast radius first. Each is independently
shippable and independently revertable.

### Stage 1 — Channel dimension `043`

Add `channel` to `crm.messages` and `crm.conversations`. `NOT NULL
DEFAULT 'whatsapp'`, so the backfill is the default and every existing
row is correct by construction.

- **Code changes:** none required. Purely additive.
- **Blast radius:** near zero.
- **Why first:** adding a column to `messages` gets more expensive every
  day the table grows. This is the cheapest it will ever be.

### Stage 2 — Contact handles `044`

The load-bearing stage.

```text
crm.contact_handles
  contact_id, channel, handle, handle_normalized
  UNIQUE (account_id, channel, handle_normalized)
```

1. Create the table; backfill one `whatsapp` row per existing contact
   from `contacts.phone`.
2. Make `contacts.phone` **nullable**.
3. Replace `idx_contacts_account_phone_normalized` with the handle-table
   uniqueness guarantee.
4. Replace `findExistingContact()` with
   `resolveContactByHandle(db, accountId, channel, handle)`. Four call
   sites follow.

**Ownership note.** Handles live in `crm`, not `public` — the CRM is the
channel-facing system, so it owns channel identity; the brain owns the
person. This keeps Phase 2 inside the schema this repo owns and needs no
cross-repo migration.

**Risk:** highest of the four. `phone NOT NULL` and its unique index are
load-bearing for dedupe today. Needs the full from-zero reset, and a
negative control proving two contacts with the same WhatsApp number in
one account are still rejected.

### Stage 3 — Extend the identity bridge `045`

Teach `resolve_customer_candidates()` to match `email_hash` as well as
`phone_hash`. Same workspace → tenant/brand scoping, same fail-closed
many-match behaviour, no new concepts.

Improves link rate on existing contacts immediately and is a
prerequisite for any email channel later.

### Stage 4 — Prove it with one second channel

Instagram DM (recommended — same Meta Graph API, so `meta-api.ts` and
the webhook shape largely carry over; Messenger is an equally valid
choice on identical grounds).

This stage is the **acceptance test** for stages 1–3. If adding
Instagram requires touching the schema again, Phase 2 did not succeed.

---

## Parallel tracks

Independent of the critical path — can run alongside or slip without
blocking anything.

### Track A — Customer Timeline

A read-only union over `crm.messages`, `public.chat_turns`,
`public.realtime_turns` and `public.orders`, keyed on
`contacts.customer_id`.

**Zero schema risk, entirely additive, and the most visible proof that
the two systems are actually one.** It also surfaces voice and web-chat
history in the CRM without building either channel. Good early win.

### Track B — Memory consolidation

Retire `crm.ai_knowledge_chunks` in favour of `public.kb_chunks`, read
through a narrow `SECURITY DEFINER` function mirroring the
`resolve_customer_candidates` pattern.

**Start this early even if it finishes late** — it is the
fastest-compounding debt in the review. Every day both stores run, more
content lands in the wrong one and the migration gets bigger.

---

## Explicitly not in Phase 2

Named so they don't creep in:

- **Email as a channel.** Needs a threading model (message-ID chains,
  MIME). Stage 3 makes it *possible*; building it is Phase 3.
- **Voice in the CRM.** Already in the brain. Track A surfaces it; do
  not rebuild it.
- **Multi-tenant CRM.** Phase 3, and only if YALI OS serves a second
  founder.
- **Inverting message ownership** (CRM conversations as a view over
  brain sessions). Phase 3.
- **Anything on the review's "never build" list** — team management,
  broadcasts, template sync, inbox UI, pipelines, API keys, webhooks,
  RLS.

---

## Sequencing against Phase 1.1

`PHASE1_1_GENERATED_TYPES_ADOPTION.md` is domain-sequenced. Two of its
domains are exactly the code Phase 2 rewrites:

| 1.1 step | Domain | Overlap with Phase 2 |
|---|---|---|
| 3 | Contacts (~4 errors) | Stage 2 rewrites these files |
| 6 | Inbox (~20 errors) | Stages 1–2 touch these files |

**Recommendation:** do 1.1 steps **3 and 6 only** before Phase 2 stage 2,
and defer steps 1, 2, 4, 5, 7. Rationale: those are real nullable-column
bugs sitting in the files Phase 2 is about to restructure — fixing them
first means doing the work once, on smaller diffs, with the type checker
helping rather than 58 errors deep. The other domains are untouched by
Phase 2 and can wait.

---

## Hard prerequisites

Phase 2 writes migrations `043`+. **None can be applied until production
blocker 3 (the shared migration ledger) has an approved method.** Local
`npm run db:test:reset` work can begin before that; applying cannot.

Carried forward unchanged from Phase 1:

- Never `supabase db push` against production from this repo.
- Every new function declares its own `REVOKE`/`GRANT`. No blanket
  grants.
- After changing any migration, reset and reapply the whole chain from
  zero.
- New Realtime subscriptions pass `schema: "crm"` explicitly; any
  subscription filtering on a non-PK column needs `REPLICA IDENTITY
  FULL`.
- `public` belongs to the brain repo. Propose, never apply.

---

## Definition of done

1. A contact can exist with **no phone number**.
2. A message records **which channel** it arrived on.
3. Adding channel number three requires **no schema change**.
4. One second channel is live end to end and indistinguishable from
   WhatsApp in the inbox.
5. Full chain reapplies from zero with 0 errors; test suite green.
6. Negative controls pass — in particular, duplicate-handle rejection
   within an account, and cross-workspace isolation on
   `contact_handles`.

Per the Phase 1 lesson: **a test that has never been observed failing is
not known to work.** Every negative control above gets watched to fail
before it is trusted.

---

## Open decisions for a human

1. **Migration ledger method** (blocker 3) — blocks every apply in this
   phase. Unchanged from Phase 1.
2. **Phase 1.1 sequencing** — accept the "steps 3 and 6 only" split
   above, or run 1.1 in full first?
3. **Long-term home for channel handles** — `crm.contact_handles` is
   proposed here on ownership grounds. If the brain should own handles
   canonically, that is a brain-repo migration and changes stage 2.
4. **Which second channel proves the model** — Instagram or Messenger.
5. **Does the brain add Instagram/Messenger handles to
   `public.customers`?** Not blocking; determines whether IG-only people
   can ever link to a customer record.
