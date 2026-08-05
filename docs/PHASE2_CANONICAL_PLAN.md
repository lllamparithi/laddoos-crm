# Phase 2A — Canonical Implementation Plan

**This is the document a fresh engineer reads to start writing
`043_identity_handles.sql`.** It resolves the two local decisions
(`A2` migration order, `C4` partitioning) that were blocking migration
writing, and restates — without re-deriving — the scope and naming
decisions already settled elsewhere.

**Status: A2 resolved. C4 resolved. Phase 2A migration writing can
begin** once someone other than this pass actually writes the files —
see the acceptance rules below.

**No migration file exists yet.** This document describes what
`043`–`046` will contain; it does not create them. Full column-level SQL
for each table remains in the detailed spec documents cited in §2 —
this plan does not duplicate it, only the order and the one open design
choice (partitioning) it depends on.

---

## 1. Scope — restated, not redecided

Unchanged from `PHASE2_SCOPE_REDUCTION.md`, which remains the source of
the *why*. This plan only fixes the *how* for Phase 2A specifically.

> **Phase 2A = Instagram → Website → Timeline, only.** No WhatsApp merge,
> no `contacts.phone` change, no `identity_merge_log`. Those are Phase
> 2B. Phone is Phase 2C. Both are out of scope for the migrations below.

---

## 2. A2 — canonical migration order for Phase 2A

**Resolved.** Four migrations, in this order, each depending only on
what precedes it or on Phase 1's existing tables (`accounts`, `contacts`,
`conversations` — all pre-existing, unaffected).

| # | File | Creates | Depends on |
|---|---|---|---|
| `043` | `043_identity_handles.sql` | `identity_handles` | `accounts`, `contacts` (Phase 1, pre-existing) |
| `044` | `044_identity_evidence.sql` | `identity_evidence_policy` (seeded), `identity_evidence` | `identity_handles` (`043`), `contacts` (pre-existing) |
| `045` | `045_timeline_events.sql` | `timeline_event_types` (seeded), `timeline_events` | `identity_handles` (`043`), `accounts`, `contacts`, `conversations` (pre-existing) |
| `046` | `046_continuation_tokens.sql` | `continuation_tokens` (`ig_to_web` purpose only) | `identity_handles` (`043`), `accounts`, `contacts`, `conversations` (pre-existing) |

**Why this order and not the roadmap's original `043`–`048`:** the
original roadmap sequenced `043 timeline_events` before
`044 identity_handles`, but `timeline_events.handle_id` references
`identity_handles(id)` — a table cannot carry a foreign key to a table
that does not yet exist. That defect, along with `identity_merge_log`
and the `contacts` alteration, is now moot for Phase 2A specifically:
neither belongs in this phase at all (they're Phase 2B). The reduced
scope doesn't just avoid the FK bug, it removes the two migrations that
caused it.

**Full column definitions** for each table are unchanged from where they
were originally specified and are not repeated here:

- `identity_handles`, `identity_evidence`, `identity_evidence_policy` —
  `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §3 (ignore that
  document's own `045`–`047` numbers for `identity_merge_log`,
  `contacts_multichannel`, and `continuation_tokens` — those numbers are
  superseded by this plan; the column definitions for `identity_handles`
  and `identity_evidence` are not).
- `timeline_events`, `timeline_event_types` — `PHASE2_UNIFIED_TIMELINE_SPEC.md`
  §2, §4 — **except** the primary key and unique-constraint shape, which
  §3 below revises.
- `continuation_tokens` — `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md`
  §4.2 — build only the `ig_to_web` purpose path for Phase 2A;
  `web_to_wa` is Phase 2B.

**Reserved, not designed here:** `048`+ is reserved for Phase 2B
(`identity_merge_log`, the `contacts` alteration, the `web_to_wa` token
purpose). Designing 2B's exact migration set is out of scope for this
pass — this plan only reserves the number range so 2A's numbering
doesn't collide with it later.

> **Corrected 2026-08-05.** This section originally reserved `047`+.
> `047` was taken on 2026-08-04 by the security hotfix
> (`REVOKE crm.claim_ai_reply_slot FROM PUBLIC`), applied to production.
> Phase 2B starts at `048`.

---

## 3. C4 — `timeline_events` partitioning: decided

**Decision: unpartitioned at creation, for Laddoos-only scope.** This
revises `PHASE2_ARCHITECTURE_REVIEW.md`'s earlier recommendation
(partition now, at creation), and the revision is deliberate — explained
below, not a quiet reversal.

### Why the earlier recommendation doesn't apply as-is

That recommendation was sized against a hypothetical target of "100
brands, 100 million events" evaluated for the *YALI OS* five-year vision.
This task explicitly asks for a decision scoped to **Laddoos-only**. Two
things are true right now, verified against Phase 1's own locked
decisions in `CLAUDE.md`:

- *"No multi-tenant scaffolding. No `tenant_id`, no `tenants` table.
  Laddoos is the only account."*
- Tenancy unification (`PHASE2_ARCHITECTURE_DECISIONS.md` F2 — how a
  workspace-scoped `crm` would ever serve multiple brands or founders)
  is explicitly **open and deferred to Phase 3**, with no design behind
  it yet.

Building physical partitioning infrastructure now, sized for a
multi-tenant future that has no architecture decided for it yet, is
optimizing for a scale this repo isn't built to reach. That's the actual
reason this decision changes under the "Laddoos-only" framing — not a
preference for less work.

### The decision, precisely

`timeline_events` is created as a normal (non-partitioned) table for
Phase 2A. To keep a future conversion cheap **without paying partitioning's
operational cost now**, two shape decisions are made at creation:

1. **Primary key becomes composite:** `PRIMARY KEY (id, occurred_at)`,
   not a bare `PRIMARY KEY (id)`.
2. **The `dedupe_key` uniqueness constraint includes `occurred_at`:**
   `UNIQUE (account_id, dedupe_key, occurred_at)`, not
   `UNIQUE (account_id, dedupe_key)`.

Postgres requires every unique constraint (including the primary key) on
a `PARTITION BY RANGE` table to include the partition key. Making both
constraints composite now costs nothing functionally — `id` alone is
already globally unique, so the composite key enforces the identical
guarantee — and it means a future conversion to partitioning never has to
touch either constraint.

### Explicit revisit trigger

Revisit this decision — convert to monthly `RANGE` partitioning on
`occurred_at` — at **whichever comes first**:

- `timeline_events` exceeds **5 million rows**, or
- a second brand, tenant, or account is onboarded (i.e., the moment F2
  stops being deferred).

Both are concrete, checkable conditions, not vague future scale.

### Reversal cost, stated honestly

At low-to-moderate row counts (below the 5M trigger above), converting is
a well-understood, moderate-effort migration, not a research project:
create a new partitioned parent table with the same composite-key shape,
create initial monthly partitions, copy rows across, rename-swap inside
a transaction (a brief lock, proportional to row count at conversion
time, not to eventual scale).

**The one real cost this decision defers, stated plainly:** if other
tables acquire hard foreign keys to `timeline_events(id)` before a
conversion happens (Phase 2's own `followup_schedule.trigger_event_id`
is specified as exactly such an FK, though it is out of scope through
Phase 2C), those FKs must be dropped and recreated across the rename
swap. This is why the trigger above says "revisit before more
dependents accumulate," not "revisit whenever convenient" — the
composite-key decision made now keeps the *table itself* cheap to
convert indefinitely; it does not make dependent FKs free forever.

---

## 4. Naming — confirmed, unchanged

- **`identity_handles`** is canonical. `contact_handles`
  (`PHASE2_PLAN.md`) does not appear in any migration.
- **`crm.messages` never gains a `channel` column** — confirmed final,
  not merely recommended. `timeline_events` is the only place channel is
  recorded going forward.

---

## 5. `identity_merge_log` vs. `timeline_events` identity events — resolved

**Not open, and not a product decision — this is a data-shape question
this plan can settle directly.**

**Resolution:** `identity_merge_log` remains the audit-grade detail table
— immutable (`REVOKE UPDATE, DELETE`), holding the merge-specific
structured columns (`source_contact_id`, `target_contact_id`,
`handle_ids`, `evidence_ids`, `reverses_id`). A merge, split, link,
unlink, or rejection **also** produces a `timeline_events` row
(`identity.merged` / `identity.split` / `identity.rejected`, etc.), but
that row's `payload_ref` **points to** the `identity_merge_log` row
(`{"table":"crm.identity_merge_log","id":"…"}`) rather than duplicating
its columns.

This is not a new pattern — it is the same pointer-not-payload rule
already applied correctly to every other event type
(`message.*` points at `crm.messages`, `note.*` points at
`contact_notes`, `order.*` points at `public.orders`). `identity_merge_log`
was the one place the original design broke its own rule by giving the
merge operation two independent, full-detail records instead of one
detail table plus one index entry.

**Not built in Phase 2A** — `identity_merge_log` and the `identity.*`
event types are Phase 2B scope (no merges happen until the WhatsApp
identity-linking work). Recorded here so Phase 2B's design doesn't
inherit the same unresolved duplication.

---

## 6. Superseded documents

Marked at their own location, not just here — see the banners added to:

- `PHASE2_PLAN.md` — superseded in full by this plan plus
  `PHASE2_SCOPE_REDUCTION.md`.
- `PHASE2_IMPLEMENTATION_ROADMAP.md` — its Phase 2A migration table
  (§2.2, "Six tables... Migrations `043`–`048`") is superseded by §2 of
  this plan. The rest of that document (2B–2I discussion, risks,
  consolidated decisions) is not superseded and remains useful context.

---

## 7. What this plan does not resolve

Named so nobody mistakes silence for readiness:

- **A1 (migration ledger)** — still blocks applying `043`–`046` to
  production. Does not block writing or locally testing them.
- **B1 (shared-phone identity rule)** — does not affect Phase 2A (no
  `public.customers` linking happens in this phase); it blocks Phase 2B.
- **Legal consent decisions** — out of scope for Phase 2A, which creates
  no consent-relevant capture beyond what Phase 1 already has.
- **Brain-repo voice identity fix** — irrelevant to Phase 2A; relevant
  starting at Phase 2C.

See `PHASE2_READINESS_CHECKLIST.md` for the current status of all of
these together.
