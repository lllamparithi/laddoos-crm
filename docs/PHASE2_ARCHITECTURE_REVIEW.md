# Phase 2 Architecture Review — Independent Principal Engineer Assessment

**Reviewer:** independent principal architect · **Date:** 2026-08-01
**Repo:** `laddoos-crm` @ `phase1/fresh-migration-validation`
**Scope:** architecture only. No code, SQL, migration, commit, or deploy was produced.
**Method:** every load-bearing claim re-derived against the repository and the live
Supabase project (`ugjishankutgfegplrgq`). Documentation was treated as a hypothesis.

---

## 1. Executive Summary

**You are building a Customer Lifecycle Operating System, not another CRM.** The
three-layer identity model — handles as immutable *observations*, contacts as revisable
*hypotheses*, customers as verified *conclusions* — is not how CRMs think. CRMs collapse
all three into one editable row and call it a contact. That distinction, plus an
append-only timeline with late binding, is a genuine architectural asset.

But the design has a foundation problem that no amount of downstream rigor fixes.

**The whole edifice rests on `public.customers` being a working identity spine. It is
not, and nobody measured it.** Verified live:

| Metric | Value |
|---|---|
| `customers` rows | **16** |
| rows with `total_sessions > 1` (a returning customer ever recognised) | **0** |
| rows with `full_name` | **0** |
| rows with `email_hash` | **0** |
| `sessions` rows (the table cited as proof of multi-channel design) | **0** |
| `orders`, `knowledge_objects`, `skills`, `insight_review_queue` | **0 each** |

The brain has multi-channel **schema**. It does not yet have multi-channel **data**, and
its identity resolution has a **0% demonstrated success rate at its only job**. Phase 2
proposes an elaborate identity superstructure — handles, evidence, confidence policy,
continuation tokens, merge/split audit — on top of a spine that has never once merged two
sessions into one person.

Three further defects, each verified rather than inferred:

1. **Four conflicting migration-numbering schemes**, not the two the brief admits.
2. **The roadmap's own ordering produces SQL that cannot execute** — `043` creates
   `timeline_events` with an FK to `identity_handles`, which the roadmap creates at `044`.
3. **The governing rule is structurally violated one layer up.**
   `customers_brand_phone_hash_unique` forces one customer per `(brand_id, phone_hash)`.
   A shared family phone is force-merged in `public` no matter how carefully `crm`
   declines to merge it.

The design is good. The ground under it is unmeasured. Fix that first and this becomes a
genuinely strong five-year architecture.

---

## 2. Overall Architecture Score

### **7 / 10**

| Dimension | Score | Note |
|---|---|---|
| Identity model | 9 | Best work in the set. Correct, subtle, honest about its own limits |
| Timeline model | 8 | Right primitive; write-amplification at scale unaddressed |
| Product vision coherence | 8 | Genuinely lifecycle-shaped, not CRM-shaped |
| Evidence discipline / honesty rules | 9 | `evidence_query`, citations, `measurable:false` are excellent |
| Foundation verification | **3** | Core premise never measured; it fails when measured |
| Execution readiness | **4** | Numbering conflicts, a non-executable FK order, ledger unresolved |
| Scope control | 5 | Phase 2A is too large and starts in the wrong place |
| Simplicity | 5 | Roughly 35% of the surface is defensible but not yet earned |

Seven is a good score. It means *proceed, after correcting the foundation* — not *start
over*.

---

## 3. Product Vision Assessment

Judged against the five stated goals:

| Goal | Verdict | Reasoning |
|---|---|---|
| **One Customer** | ⚠️ Designed, contradicted | The three-layer model is right. But `customers_brand_phone_hash_unique` forces merges the CRM layer explicitly refuses, and the spine has 0 returning customers |
| **One Memory** | ❌ Not achieved | Two vector stores (`crm.ai_knowledge_chunks`, `public.kb_chunks`) persist through all of Phase 2. Consolidation is listed as "parallel," which means "not scheduled" |
| **One Timeline** | ✅ Achieved | `timeline_events` with `handle_id` + late binding is the correct primitive, and correctly stores pointers not payloads |
| **One Founder Dashboard** | ⚠️ Partially | The Hub surface list is right. Deferred to 2H, behind six increments |
| **One Intelligence Layer** | ❌ Not achieved | Phase 2 adds `customer_summaries` + `insights` in `crm` while `insight_review_queue`, `content_outputs`, `product_demand_signals` sit in `public`. That is a **third** half-brain, not a unification |

**Are we accidentally building another CRM?** No — but you are at risk of accidentally
building a *second brain*. The intelligence layer is where the CRM/platform boundary is
weakest, and §3.1 of the intelligence spec knows it (it lists the brain tables to reuse)
without the roadmap enforcing it.

---

## 4. Strengths

1. **The three-layer identity separation.** Handles never merge, only re-cluster. This is
   what makes a wrong merge *reversible* rather than *catastrophic*, and it is the single
   best decision in the document set.
2. **Attribution and identity deliberately decoupled** (Thesis B). Rare and correct.
3. **The evidence→confidence table as data, not code.** Auditable, changeable without
   deploy, and the six `Never` rows are enforced *structurally* by omission from the
   policy table rather than by developer discipline.
4. **`evidence_query` recomputed live.** The difference between an auditable insight and
   an assertable one. Keep this even if you cut everything else in the intelligence spec.
5. **Migration `040` is genuinely excellent — confirmed, not taken on trust.** Eligibility
   separated from normalization, fails closed on ambiguity, manual links protected, and
   **no `ORDER BY … LIMIT 1` fallback anywhere**, with a comment explaining why the
   unreachable branch is retained. The brief's reading of it is **correct**.
6. **Honesty rules that survive contact with a demo:** `conversion_impact.measurable =
   false`, staleness counts, uncited fields refusing to render.
7. **Phase 1 lessons actually carried forward** — negative controls watched to fail first,
   per-function grants, from-zero resets. Most teams write that down once and never apply it.

---

## 5. Weaknesses

1. **The foundation was never measured.** No document in the set contains a row count.
   The entire argument for Thesis A is schema-shaped, and the schema is empty.
2. **Write amplification on merge is unbounded.** `resolve_timeline_identities()` issues
   `UPDATE timeline_events … WHERE handle_id = ?`, and every updated row fires a
   `BEFORE UPDATE … FOR EACH ROW` plpgsql trigger. At 100M events a merge of a
   high-volume handle is a large, trigger-amplified write under lock. Unaddressed.
3. **Phase 2A starts in the wrong place** (§14).
4. **Founder Intelligence is the weakest document** — eleven insight types, none
   validated against a real founder question. This is where "analytics dressed as AI" is a
   fair charge.
5. **Consent is designed but scheduled after the timeline.** 2B follows 2A. The moment
   2A holds real customer events you have DPDP obligations with no consent model.
6. **Four numbering schemes and a non-executable FK order** (§6).
7. **`crm.contacts` remains workspace-scoped while `public.customers` is tenant/brand
   scoped.** Two different tenancy models joined through `workspace_brand_map`. It works
   for one brand. It is the seam that tears at 100 brands.

---

## 6. Incorrect Assumptions

Each verified against the repo or the live database.

| # | Claim | Where | Verdict |
|---|---|---|---|
| 1 | "`public.sessions` has a `channel` column" as proof the brain is a working multi-channel platform | `YALI_ARCHITECTURE_REVIEW` headline | **Misleading.** Column exists; table has **0 rows**. The live channel data is in `chat_turns` (1650) and `realtime_turns` (1117) |
| 2 | "`public.customers` … the canonical person" — the identity spine | `IDENTITY §1`, `§2` | **Unsupported.** 16 rows, 0 with `full_name`, 0 with `email_hash`, **0 returning** |
| 3 | "exactly four non-test `findExistingContact` call sites" | `BRIEF §5` | **Wrong count.** 8 call sites across 4 files. The roadmap §2.3 lists all 8 correctly and then labels them "four" — including `contact-form.tsx`, a **client component** resolving identity from the browser |
| 4 | "Two documents assign different meanings to the same migration numbers" | `BRIEF §3.1` | **Understated. Four schemes exist** (§6.1) |
| 5 | `043` ships first with "`handle_id` NULL for now" | `ROADMAP §2.2` | **Not executable.** A nullable column does not defer an FK; `identity_handles` must exist at `CREATE TABLE` time |
| 6 | `contacts.phone TEXT NOT NULL` at `001_initial_schema.sql:43` | `ARCH REVIEW §1` | Substance correct, **line is 44** |
| 7 | Zero `channel` / consent / campaign hits across 42 migrations | `BRIEF §5` | **Confirmed.** 42 migrations, 0 and 0 |
| 8 | Migration `040` implements "never assume without evidence" | `BRIEF §5` | **Confirmed** |
| 9 | "`public.customers` stores only `phone_hash`, never a raw phone" | website `CLAUDE.md` | **Confirmed in practice** — `phone`/`email`/`whatsapp` columns exist but are 0/16 populated |

### 6.1 The four numbering schemes

| Migration | `PHASE2_PLAN` | `ROADMAP` | `IDENTITY` | `TIMELINE` | `FOLLOWUP` | `INTELLIGENCE` |
|---|---|---|---|---|---|---|
| `043` | channel dimension | `timeline_events` | `identity_handles` | — | — | — |
| `044` | `contact_handles` | `identity_handles` | `identity_evidence` | — | — | — |
| `045` | identity bridge | `identity_evidence` | `identity_merge_log` | — | — | — |
| `046` | — | `identity_merge_log` | `contacts_multichannel` | — | — | — |
| `047` | — | `contacts` alter | `continuation_tokens` | — | — | — |
| `048` | — | `continuation_tokens` | — | `timeline_events` | — | — |
| `049`–`051` | — | — | — | — | consent, policies, rules | — |
| `052`–`053` | — | — | — | — | — | summaries, insights |

`043`–`048` are **triple-assigned**. This must be unified before a single migration is
written, and the unification must be FK-topologically ordered, not merely renumbered.

---

## 7. Missing Components

1. **A measurement step.** Nothing in Phase 2 verifies the identity spine works before
   building on it. This is the top gap.
2. **Brain-side identity ingestion.** The voice agent never extracts the caller's phone
   from the LiveKit room name (`phone_<number>_<random>`), which is why 16 customers show
   0 returning. Phase 2 assumes this works. It does not.
3. **A backfill/repair path for existing duplicate customers.** 16 rows, 15 distinct
   `phone_hash`. Small now; unrecoverable once real volume lands.
4. **Timeline reconciliation.** The roadmap names a "`dedupe_key` + reconciliation count
   check" as a *mitigation* but no component owns it.
5. **Merge-storm protection.** Nothing rate-limits or batches re-resolution.
6. **An explicit tenancy-unification plan.** Workspace-scoped `crm` vs tenant/brand-scoped
   `public` is deferred indefinitely.
7. **Cost model for summaries/insights.** Per-customer LLM generation at 100 brands is a
   real operating expense with no ceiling proposed.

---

## 8. Long-term Risks

| # | Risk | Horizon | Severity |
|---|---|---|---|
| L1 | Identity spine never actually works; handles accumulate against a broken canonical layer | Phase 2 | **Critical** |
| L2 | `customers_brand_phone_hash_unique` force-merges shared phones (§12, T13) | Phase 2 | **Critical** |
| L3 | Two vector stores diverge further; every day adds content to the wrong one | Now, compounding | High |
| L4 | Re-resolution write amplification makes merges operationally dangerous | ~5M events | High |
| L5 | Workspace vs tenant/brand tenancy mismatch blocks multi-brand | Phase 3 | High |
| L6 | Shared migration ledger across two repos — unresolved since Phase 1 | Now | **Critical (gating)** |
| L7 | Intelligence layer becomes a third half-brain | Phase 2G | Medium |
| L8 | `timeline_events` never partitioned; index bloat at 100M | Year 2–3 | Medium |
| L9 | DPDP exposure — consent scheduled after event capture | 2A→2B window | High |

---

## 9. Review of Thesis A — *the platform is the brain, not the CRM*

### Verdict: **AGREE WITH MAJOR CAVEATS**

**Directionally correct.** The CRM is a WhatsApp console — 0 `channel` occurrences across
42 migrations, `contacts.phone NOT NULL`, phone as the dedupe key. Asking it to become a
multi-channel identity platform means rewriting its core. The brain's `tenants → brands →
customers` spine is the right *shape*.

**But the evidence offered is wrong.** The thesis argues from schema and never checks
data. `sessions` — the headline exhibit — has 0 rows. `orders` 0. `knowledge_objects` 0.
`skills` 0. The brain is not "already a multi-channel platform"; it is a **web-chat and
voice logger with multi-channel ambitions**, holding 1650 chat turns, 1117 voice turns,
309 KB chunks, and 16 customers who have never been recognised twice.

**The sharper framing offered in `BRIEF §4` is better and should replace the flat one.**
Split by function: CRM owns the operational surface; brain owns intelligence;
`timeline_events` owns history; handles/contacts own relationships; summaries/insights own
decisions. This survives the counter-argument the flat version does not — it explains
*why* the CRM keeps the inbox rather than treating the CRM as merely subordinate.

**On the coupling counter-argument:** making the brain the identity spine *does* worsen
two-repos-one-database coupling. But the alternative — a second identity spine in `crm` —
is worse, because then a wrong merge can happen in two places with different rules. Accept
the coupling; fix it with the ledger decision (§11 D1), not by duplicating identity.

**Required amendment:** Thesis A is conditional, and the condition is unmet. Restate as:

> The brain *should* be the platform, and is architecturally shaped for it, but its
> identity resolution does not currently function. Making it the spine requires first
> proving it can recognise one returning customer.

---

## 10. Review of Thesis B — *a continuation token proves attribution, not identity*

### Verdict: **STRONGLY AGREE — this is the best reasoning in the document set**

The `strong` attribution / `probable` identity split is exactly right. Forwarding does not
change a token's origin, so attribution survives forwarding; identity does not. Most
commercial systems get this wrong and merge the sister into Meera.

**Is it over-cautious to the point of uselessness?** No, and the worked example proves it:
step 8 (WhatsApp `wa_id`, Meta-attested) retroactively resolves the entire journey. The
`probable` state is a **waiting room with a known exit**, not a dead end. The design earns
its caution because the promotion path is concrete.

**Where it can still merge wrongly — three cases the doc misses:**

1. **Shared device, not shared link.** Mother and daughter use one household tablet. One
   `web_visitor_id`, two people. The daughter completes an OTP → the handle becomes
   `verified` → *all* of the mother's prior anonymous browsing binds to the daughter. No
   forwarding occurred, so §4.3's defence never engages. **This is a real wrong merge and
   the design does not catch it.**
2. **The `customers_brand_phone_hash_unique` bypass** (§12, T13).
3. **Token lineage inheritance.** `web_to_wa` has `parent = the ig_to_web token`. If the
   IG token was itself forwarded, the lineage carries a `probable` origin into a
   `verified` promotion. The doc does not state whether promotion re-validates ancestors.

**Recommendation:** keep Thesis B; add a rule that a `verified` promotion binds only
events **after** the handle's first identifying evidence, unless a second independent
signal covers the earlier window. Retroactive binding is the feature *and* the exposure.

---

## 11. Decision Matrix

### D1 — Migration ledger method (blocks everything)

- **Recommendation:** One ledger, owned by the brain repo. The CRM stops carrying its own
  numbered chain and ships `crm` migrations through the brain's ledger via Supabase MCP
  `apply_migration`, with a `crm_` filename prefix.
- **Reasoning:** One database has one migration history; that is a property of Postgres,
  not a policy choice. Two independent chains against one ledger is not a process gap —
  it is a correctness bug waiting for a concurrent apply.
- **Alternatives:** (a) separate Supabase projects — cleanest, kills the shared-identity
  premise, so no; (b) advisory-lock coordination — works, permanent operational tax;
  (c) CRM owns the ledger — inverts Thesis A.
- **Trade-offs:** brain-repo review becomes a bottleneck for CRM schema changes. Correct
  price: schema changes to a shared DB *should* be slow.
- **Confidence:** **High.**

### D2 — Unify migration numbering

- **Recommendation:** Renumber in FK-topological order, single scheme, before any SQL:
  `043` handles → `044` evidence(+policy) → `045` merge_log → `046` contacts alter →
  `047` continuation_tokens → `048` timeline_events(+types).
- **Reasoning:** `timeline_events` FKs `identity_handles`, so handles **must** precede it.
  The roadmap's order is not executable.
- **Alternatives:** create `timeline_events` first without the FK and add it later — more
  migrations, weaker guarantee in between.
- **Trade-offs:** loses the roadmap's "observability before the risky migration" property.
  Recover it by shipping handles + timeline together in 2A.1 and *reading* the event log
  before the contacts alter.
- **Confidence:** **High** (the FK ordering is not a matter of taste).

### D3 — `crm.messages.channel`, or inbox reads timeline?

- **Recommendation:** **Neither now — and never add `channel` to `crm.messages`.** Write
  `timeline_events` from day one; migrate the inbox to it in 2H.
- **Reasoning:** Adding `channel` to `crm.messages` is the cheap move that guarantees you
  make the expensive move later anyway, with more rows to migrate and two channel concepts
  to reconcile. Five years out, every new channel must not require a `crm.messages` change.
- **Alternatives:** (a) add the column — fast, permanent duplication; (b) migrate the
  inbox now — correct end state, large UI project inside an already-large 2A.
- **Trade-offs:** the inbox shows no channel badge until 2H. Acceptable: 2A only has to
  *prove* the chain, and the timeline page shows the badge.
- **Confidence:** **High** on never adding the column; **Medium** on 2H timing.

### D4 — Handles in `crm` or `public`?

- **Recommendation:** `crm`, as proposed — but with `public.customers` as the arbiter of
  cross-brand identity.
- **Reasoning:** Handles are channel-facing; the CRM owns channels. Putting them in
  `public` forces every channel integration through brain-repo review.
- **Alternatives:** `public` — canonically purer, worsens the two-repo bottleneck D1
  already taxes.
- **Trade-offs:** handles are workspace-scoped, so a person known to two brands has two
  handle sets. Acceptable today (one brand); revisit at multi-brand.
- **Confidence:** **Medium.** Revisit if multi-brand arrives before Phase 3.

### D5 — Token signing key: global or per-tenant?

- **Recommendation:** Global key **with a `key_id` prefix in the token format**, per-tenant
  deferred.
- **Reasoning:** `v1.<id>.<sig>` has no key identifier, so rotation requires accepting both
  keys blindly. Add `v1.<key_id>.<id>.<sig>` now — it costs nothing and makes rotation and
  a later per-tenant move non-breaking.
- **Alternatives:** per-tenant immediately — smaller blast radius, real key-management cost
  at one tenant.
- **Trade-offs:** a global key compromise invalidates all tokens. Mitigated by short TTLs
  (1h–7d) and existing revocation.
- **Confidence:** **High** on adding `key_id`; **Medium** on deferring per-tenant.

### D6 — Web visitor id storage

- **Recommendation:** First-party cookie, `SameSite=Lax`, `Secure`, ~180 days, **written
  only after consent** where a banner applies; `localStorage` as a same-origin fallback.
- **Reasoning:** Cookies survive navigation and are server-readable at first byte, which
  the token-resolution flow needs. `localStorage` is not sent with the request.
- **Alternatives:** `localStorage` only — needs a client round-trip before resolution;
  both unconditionally — duplicate identifiers that can disagree.
- **Trade-offs:** consent-gating loses some anonymous attribution. Correct trade under DPDP.
- **Confidence:** **Medium-High.**

### D7 — Does `probable` auto-promote by accumulation?

- **Recommendation:** **No.** Endorsed as written.
- **Reasoning:** Two forgeable signals are still forgeable. Accumulation is inference
  wearing a threshold, and it is precisely how CRMs create wrong merges.
- **Alternatives:** promote on N independent probables — reintroduces the failure the
  governing rule exists to prevent.
- **Trade-offs:** more manual review queue volume. That is the cost of correctness, and
  the queue is the product surface where a human adds real value.
- **Confidence:** **High.**

### D8 — `timeline_events`: source of truth or projection? *(the five-year question)*

- **Recommendation:** **Source of truth for events; never for content.** One direction:
  the timeline owns *what happened and when*; `crm.messages`, `public.chat_turns`,
  `realtime_turns`, `orders` own *what was said*.
- **Reasoning, five years out:** as a projection, the timeline must be rebuildable from
  sources, so every source must retain full fidelity forever and every new channel needs a
  backfill. As the event source of truth, a new channel is one writer. The projection model
  also cannot represent events with **no** source row — `campaign.click` on an anonymous
  visit, `identity.merged`, `consent.withdrawn` — and those are exactly the events a
  lifecycle OS exists to hold. A projection can never be append-only, so the immutability
  guarantee and the audit story both collapse.
- **Alternatives:** projection over `crm.messages` + brain events — cheaper now, and it
  re-poses this identical question at every future channel.
- **Trade-offs:** dual-write risk between `crm.messages` and `timeline_events`. Mitigated
  by `dedupe_key` + a reconciliation count check, which must become an owned component
  (§7.4), not a listed mitigation.
- **Confidence:** **High.**

### D9 — Two vector stores

- **Recommendation:** Consolidate on `public.kb_chunks`. Put it **on the critical path,
  before 2D**, not "in parallel."
- **Reasoning:** It is the fastest-compounding debt in the system, and `customer_summaries`
  (2D) will be the first component to need one knowledge surface. "Parallel" work with no
  slot is work that does not happen.
- **Alternatives:** keep both with a routing layer — a third concept to explain forever.
- **Trade-offs:** delays 2D. Correct: 2D built against two stores must be rewritten.
- **Confidence:** **High.**

### D10 — Legal (DPDP erasure scope, recording consent, CTWA basis)

- **Recommendation:** Not an engineering decision. **But move consent (2B) to ship
  *with* 2A, not after it.**
- **Reasoning:** 2A begins capturing real customer events. The obligation attaches at first
  capture, not at first automated send.
- **Trade-offs:** enlarges 2A. Offset by the §14 cuts.
- **Confidence:** **High** on sequencing; defer the legal content to counsel.

### D11 — Brain writes timeline directly or via `events_outbox`?

- **Recommendation:** `events_outbox`, as proposed. It exists and has 452 rows — a live,
  working outbox, not a hypothetical.
- **Reasoning:** No cross-repo triggers; preserves the Phase 1 ownership rule; already
  carries `tenant_id`/`brand_id`/`delivery_status`/`retries`.
- **Trade-offs:** poller latency and a new failure mode (poller lag). Both observable.
- **Confidence:** **High.**

---

## 12. Architectural Threats

The identity doc lists T1–T12. Four more, all verified.

### T13 — `customers_brand_phone_hash_unique` defeats the governing rule *(Critical)*

```
CREATE UNIQUE INDEX customers_brand_phone_hash_unique
  ON public.customers (brand_id, phone_hash) WHERE phone_hash IS NOT NULL;
```

`crm` correctly refuses to merge two family members sharing a phone (`AMBIGUOUS` tier,
§7.2). But `public` **cannot represent them as two customers**. The moment either links by
`phone_hash`, both resolve to one customer row. The rule is enforced in the layer that
defers, and violated in the layer that decides.

*Mitigation:* either `public.customers` gains a discriminator so one phone can back
multiple people, or the CRM must never auto-link on `phone_hash` alone at the customer
layer. **This must be decided before 2A.2.** It is also why `040`'s many-match branch is
unreachable — the constraint makes ambiguity structurally impossible to observe there.

### T14 — Shared-device retroactive binding *(High)*

Late binding resolves *all* prior anonymous events for a handle. One household device, two
people, one OTP → the other person's history silently binds to the verified identity. No
forwarding, so §4.3 never engages. See §10 for the proposed window rule.

### T15 — Re-resolution write amplification *(High, latent)*

`resolve_timeline_identities()` updates every event for a handle, each firing a per-row
`BEFORE UPDATE` plpgsql trigger. At 100M events, merging a high-volume handle is a large
locked write. Needs batching, a statement-level guard, or read-time resolution for
high-cardinality handles.

### T16 — Client-side identity resolution *(Medium)*

`contact-form.tsx:96,207` calls `findExistingContact` from the **browser** with a user-
scoped client. Post-2A.2 this path must not be able to create or resolve handles directly;
otherwise identity policy is enforced in four places, one of which is untrusted.

---

## 13. Simplification Opportunities

What to **remove**, not add.

**If Apple rebuilt this:**
- Collapse five confidence levels to **three** — `verified`, `probable`, `unknown`.
  `strong` vs `verified` is invisible to every human who will ever read it, and it doubles
  the branch logic in every policy decision. `rejected` is a *state*, not a confidence;
  move it to its own boolean.
- Collapse four `visibility` tiers to **two** (`team`, `sensitive`).
- **Never build** the tiered voice-context gate as four tiers. Two: *we know who this is*,
  or *we don't*.

**If Linear rebuilt this:**
- **Delete `saved_views` entirely.** It is a feature for a product with users who have
  learned what they want to filter. You have one founder.
- **Delete `action_state`'s five values** → `open` / `done`. Snooze is a product decision
  masquerading as a schema column.
- **Remove the `task`, `calendar`, and `note` event domains from v1.** The timeline is a
  feed of what happened to a customer, not a work-management system. Adding tasks makes it
  a worse feed and a bad task manager.
- Cut the event taxonomy from 16 domains to the **6 that have a writer in 2A**.

**If HubSpot rebuilt this with today's constraints:**
- **Never build the continuation-token system.** It is roughly 40% of the identity doc's
  complexity, and it exists to serve the forwarded-link edge case. Meta already provides
  platform-attested attribution via `referral` / `ctwa_clid`, which the doc correctly
  identifies and then treats as secondary. Ship native attribution first; add tokens only
  if measurement proves a real coverage gap.
- Never build a second vector store (already the mistake — D9).
- Never build `insights` with 11 types before one founder has answered one question.

**My own cut list, in priority order:**

| Cut | Saves | Risk of cutting |
|---|---|---|
| `saved_views` | a table + UI | None at one user |
| `task`/`calendar`/`note` domains | taxonomy + UI | None in 2A |
| `strong` confidence level | branch logic everywhere | Low — collapses into `verified` with an evidence label |
| Continuation tokens in 2A | ~40% of identity complexity | **Medium** — lose forwarded-link coverage; `ctwa_clid` covers the main path |
| 11 insight types → 3 | most of the intelligence spec | Low — the three with a measurable metric are the only defensible ones |
| 4 visibility tiers → 2 | policy surface | Low |

---

## 14. Recommended Phase 2A

**Is the proposed Phase 2A the smallest valuable implementation? No.** It is too large, and
more importantly **it starts in the wrong place.** It builds an identity superstructure
before proving the identity spine works.

The brief asks specifically whether the WhatsApp merge should be split from
Instagram→website→timeline. **Yes — but that is not the important cut.**

### Redesigned sequence

**Phase 2A-0 — Prove the spine (days, not weeks). NEW, and it must come first.**

- Fix brain-side identity ingestion: extract the caller's phone from the LiveKit room name
  (`phone_<number>_<random>`) and pass it as `customer_id: "voice:<phone>"`. The pattern
  already exists for `"wa:<phone>"`.
- Repair/merge the existing duplicate customer rows (16 rows, 15 distinct hashes).
- **Exit criterion, executed not asserted: `SELECT count(*) FROM customers WHERE
  total_sessions > 1` returns > 0.** One returning customer, recognised across two calls.

*Why first:* it is the cheapest possible test of Thesis A, it is a prerequisite for every
later increment, and if it fails, the entire Phase 2 identity design needs rethinking
**before** six tables are built on it. Today that query returns 0.

**Phase 2A-1 — Handles + timeline, WhatsApp only.**
Migrations `043` handles → `044` evidence → `048` timeline (FK-correct order, D2). Write
events from the existing WhatsApp path. No contact-model change. Read-only timeline page.
*Ships value alone: a real cross-time view, and an event log to observe 2A-2 with.*

**Phase 2A-2 — The contacts alter.** `045` merge_log + `046` contacts alter. Backfill
handles before dropping the `022` index, same migration. Replace the shared dedupe function
— **all 8 call sites**, and remove the client-side path (T16).

**Phase 2A-3 — Instagram → website, native attribution only.** Meta `referral` /
`ctwa_clid`. **No continuation tokens.** Anonymous visits recorded, no contact created.

**Phase 2A-4 — Consent.** Moved up from 2B (D10).

**Deferred out of 2A:** continuation tokens, the web→WhatsApp token handoff, summaries,
insights, the full Hub.

**What 2A proves, in one founder-verifiable sentence:**

> A returning customer is recognised as the same person across two calls and a WhatsApp
> thread, shown as one timeline — and two family members sharing a phone are still shown
> as two people.

The second clause is the one that matters, and T13 says you cannot currently deliver it.

---

## 15. ADR Recommendations

Every one of these should exist **before** implementation.

| ADR | Title | Blocks |
|---|---|---|
| ADR-001 | Shared migration ledger ownership (D1) | everything |
| ADR-002 | Migration numbering + FK-topological order (D2) | any migration |
| ADR-003 | `timeline_events` is the event source of truth; content stays at source (D8) | 2A-1 |
| ADR-004 | `crm.messages` never gains a `channel` column (D3) | 2A-1 |
| ADR-005 | **One phone may back multiple people — resolving T13** | 2A-2 |
| ADR-006 | Handle ownership: `crm`, with `public.customers` as arbiter (D4) | 2A-2 |
| ADR-007 | Confidence levels: three or five | 2A-2 |
| ADR-008 | `probable` never auto-promotes by accumulation (D7) | 2A-2 |
| ADR-009 | Retroactive late-binding window (T14) | 2A-2 |
| ADR-010 | Vector store consolidation on `public.kb_chunks` (D9) | 2D |
| ADR-011 | Brain→CRM event transport via `events_outbox` (D11) | 2A-1 |
| ADR-012 | Token format + `key_id` — even if tokens are deferred (D5) | 2A-3 |
| ADR-013 | Web visitor id storage + consent interaction (D6) | 2A-3 |
| ADR-014 | Consent ships with first event capture (D10) | 2A-4 |
| ADR-015 | DPDP erasure scope — legal input required | 2I |
| ADR-016 | Tenancy unification: workspace vs tenant/brand | Phase 3 |

---

## 16. Final Verdict

# APPROVE WITH CHANGES

**Why not "approve for Phase 2 design":** three defects would cause real failures if built
as written — the non-executable FK ordering (§6.1), the T13 constraint that structurally
defeats the governing rule, and a Phase 2A that builds six tables on an identity spine with
0 demonstrated successes. None is discovered cheaply once code exists.

**Why not "major redesign":** the core model is right, and rightness here is rare. The
three-layer identity separation, the attribution/identity split, evidence-as-data, and
`evidence_query` recomputed live are all decisions I would keep unchanged in a five-year
architecture. The problems are in *sequencing, verification, and scope* — not in the model.

**Required before Phase 2 implementation begins:**

1. **Phase 2A-0.** Prove one returning customer is recognised. Today that count is 0.
2. **Resolve T13.** Decide whether one phone may back multiple people. This is a product
   decision with a schema consequence, and the governing rule is void until it is answered.
3. **Unify the numbering in FK-topological order** (D2).
4. **Decide the ledger** (D1). It has blocked since Phase 1 and now gates a phase.
5. **Write ADR-001 through ADR-005.**

**Recommended, not required:** the §13 cuts — particularly deferring continuation tokens
and reducing the insight types. Both are defensible; neither is yet earned.

---

### On the first objective

> *If we build everything described here, do we end up with a world-class Customer
> Lifecycle Operating System, or accidentally another CRM?*

**Neither, as currently sequenced — you end up with an excellent identity architecture
sitting on an identity spine that has never worked, and a third half-brain beside the two
you already have.**

Fix the foundation first and the answer becomes a genuine Customer Lifecycle OS. The
distinguishing asset is not the timeline or the Hub — both are table stakes that any
well-funded CRM will ship within two years. It is the **evidentiary discipline**: a system
that records *why* it believes two identities are one person, refuses to guess, and can
reverse itself completely. No CRM on the market does that, because it is a liability under
quarterly feature pressure and an asset only over five years.

That is the moat. Protect it by measuring the ground before building on it.

---

## Addendum — independent re-verification pass

Everything above this line existed before this pass began. Every checkable
claim in it was independently re-run against the live project
(`ugjishankutgfegplrgq`) and the repository — the `customers`/`sessions`/
`orders`/`events_outbox` counts, the `customers_brand_phone_hash_unique`
index definition, the `contacts.phone NOT NULL` line number, and the
`findExistingContact` call-site recount — and all matched exactly. This
addendum adds a small number of findings the document above does not cover,
found while doing that re-verification. Nothing above was altered.

### A1 — `crm.conversations` does not hear about non-message events

The specific mechanism by which the Hub stays channel-siloed even once
`timeline_events` is populated correctly: today, `conversations.unread_count`
and `last_message_at` — the fields that drive thread sort order and what
looks "active" — update only from `crm.messages` inserts. Nothing in the
timeline design writes to `conversations`. Ship Instagram, voice, and email
exactly as specified in the five `PHASE2_*` docs and the inbox thread list
still reflects WhatsApp only. §11 D3 above (never add `channel` to
`crm.messages`; migrate the inbox to the timeline in 2H) is the right
direction, but until 2H ships, this table is the concrete reason the Hub
principle is not yet true in the running app, and it should be named as its
own line item, not left implicit in the migration-timing discussion.

### A2 — Outbound delivery is explicitly at-most-once; Phase 2 assumes otherwise

`src/lib/webhooks/deliver.ts:1-18` states as designed behavior: *"At-most-once
per event, single attempt with a short timeout... Durable retry-with-backoff
would need a queue/worker (a follow-up)."* Both the plan to drain
`events_outbox` into `timeline_events` and the Follow-up Policy Engine need
at-least-once semantics. `dedupe_key` (already in the timeline schema)
handles duplicate delivery; it does not help with delivery *loss*, which is
a different, currently unaddressed failure mode.

### A3 — No scheduler is actually configured anywhere in this deployment

Verified: no `vercel.json`, no `crons` key in any config file in the repo.
`docs/docker.md:59` states outright: *"Nothing inside the container is
scheduled... point an external scheduler at `GET /api/automations/cron`."*
The Follow-up engine's plan to reuse this cron, and any plan to poll
`events_outbox` on a schedule, both depend on an external scheduler that is
documented as required but not, as of this session, provisioned. This is
inherited infrastructure debt, not something Phase 2 introduces — but Phase
2 is the first work that will actually depend on it firing reliably.

### A4 — Email recycling has no policy, unlike phone

`PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §13.5 names a phone-dormancy
gap as an open decision. `email_hash` becomes an equally auto-linkable
evidence type in the same document's Stage 3 (§3) with no equivalent
dormancy-gap decision. The two should be decided together, not one now and
one implicitly later.

### A5 — A stated reuse plan is not followed through

`PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §3.1 names `public.insight_review_queue`
as the workflow to reuse, then §3.2 defines an independent `status` enum
(`new/reviewed/actioned/dismissed/expired`) on the new `insights` table
without reconciling the two. This document's own §3 correctly identifies the
strategic risk ("a third half-brain"); this is the specific, narrower
inconsistency inside one document that produces it — worth fixing as a
one-paragraph decision (adopt `insight_review_queue`'s shape, or state why
not) rather than left as an implicit gap.

**Provenance note, for the user:** this file existed at this path before
this addendum was written, already containing the live-database
verification above. I did not produce the original document in this
conversation and do not know what did. I'm flagging that plainly rather
than silently taking credit for it or silently treating it as mine.
