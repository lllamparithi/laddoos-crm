# Phase 2A/2B/2C — Scope Reduction

**Purpose:** determine whether the current roadmap's Phase 2A is still
too large, and if so, produce a smaller sequence. This supersedes the
"Recommended Phase 2A" sections in both `PHASE2_IMPLEMENTATION_ROADMAP.md`
and `PHASE2_ARCHITECTURE_REVIEW.md` — see §5 for exactly how, so a future
reader is never confused about which "Phase 2A" is meant.

**Scope note:** this task explicitly asks for Phone → Timeline as its own
phase (2C). This supersedes the earlier guidance ("keep telephone… for
later increments") from before the full identity/timeline design existed
— that guidance was written before the identity spine's real state was
measured. Phone is now explicitly in scope, sequenced last for reasons
given in §4.

---

## 1. Is Phase 2A still too large? Yes.

Two independent reasons, not one:

1. **It bundles two unrelated risk profiles into one slice.**
   `PHASE2_IMPLEMENTATION_ROADMAP.md`'s 2A ships Instagram→website
   attribution *and* the WhatsApp identity merge (`contacts.phone`
   nullable, the confidence-column rewrite, the 8-call-site
   `findExistingContact`→`resolveContactByHandle` change) as one
   six-migration unit. The first is purely additive and touches nothing
   live. The second changes the live contact model everywhere it's used
   today. Shipping them together means a problem in either blocks both.
2. **It builds on an unverified foundation.** `PHASE2_ARCHITECTURE_DECISIONS.md`
   B1 and A1 (in the decisions register) are not resolved: the identity
   spine (`public.customers`) has never once recognized a returning
   customer (verified live: `total_sessions > 1` returns 0 rows out of
   16), and `customers_brand_phone_hash_unique` currently force-merges
   any two people who share a phone number. Building identity-linking
   machinery — in either the original 2A or the WhatsApp portion of it —
   on top of an unmeasured, and now known-broken, foundation is exactly
   what this preparation pass exists to stop.

**Verdict:** yes, reduce further than either prior redesign attempted.

---

## 2. What must be true before any Phase 2 migration is written

Restated from `PHASE2_ARCHITECTURE_DECISIONS.md` (Summary section), since
these gate every phase below, not just one:

| Gate | What it blocks | Resolved by |
|---|---|---|
| **A1** — migration ledger method | Applying anything to production | shared-ledger owner |
| **A2** — migration numbering unified, FK-topological | Writing any Phase 2 migration file at all | engineering, before `043` exists |
| **C4** — `timeline_events` partitioning decided | The first migration that creates `timeline_events` | engineering, in that same migration |

**B1** (shared-phone force-merge) does **not** block Phase 2A below — 2A
never touches `phone_hash` or `public.customers` linking at all. It
becomes load-bearing starting at 2B. **A3** (scheduler) does not block
2A/2B/2C either — none of the three, as scoped below, depends on
scheduled automation; that dependency starts with the Follow-up engine,
which is out of scope for all three phases in this document.

---

## 3. Phase 2A — Instagram → Website → Timeline (only)

**What ships:**

- `identity_handles`, scoped to `instagram_scoped_id`, `web_visitor_id`,
  `web_session_id` only.
- `identity_evidence` + `identity_evidence_policy`.
- `timeline_events` + `timeline_event_types`, **with partitioning
  decided in this migration** (C4).
- `continuation_tokens`, `ig_to_web` purpose only.
- A read-only timeline page.
- Native Meta attribution ingestion (`referral` object on Instagram DMs)
  — see `PHASE2_ARCHITECTURE_DECISIONS.md` E7.

**What explicitly does not ship:**

- No change to `crm.contacts`, `phone`, or any existing WhatsApp code
  path.
- No `identity_merge_log` (nothing merges yet — every handle here is new
  and un-clustered against an existing contact).
- No consent, follow-up, summaries, or insights.
- No Hub UI beyond a basic timeline view.

**Why this is safe to build now, unlike the original 2A:** every table
above is new, and nothing reads from or writes to a table that exists in
production today. A person who arrives via Instagram and browses the
website is recorded, attributed, and shown on one timeline — entirely as
a new, isolated capability. If something is wrong with it, it can be
reverted without touching anything live.

**Proves, in one sentence:** an anonymous or Instagram-only visitor's
journey shows up as one timeline, correctly, with no risk to the
existing WhatsApp contact model.

---

## 4. Phase 2B — Website → WhatsApp → Timeline

**This is where the highest-risk work from the original 2A lives,** now
isolated and gated on its own.

**Prerequisite, must be true before this phase ships:**

- **B1 resolved** — a decision on whether one phone may back multiple
  people. This phase is the first place `crm` auto-links a `contact` to
  a `public.customers` row via the new handle/evidence model, so the
  question stops being theoretical here.

**What ships:**

- `identity_merge_log`.
- `contacts` altered: `phone` nullable, five-level (or reduced, per B3)
  confidence columns.
- The `web_to_wa` continuation-token purpose, chained from the `ig_to_web`
  token where one exists.
- The shared `findExistingContact` → `resolveContactByHandle` rewrite,
  across all 8 call invocations in the 4 files identified in the
  document audit — **including closing the client-side path** (B9 in
  the decisions register: `contact-form.tsx` must no longer resolve
  identity directly from the browser).
- Extension of `resolve_customer_candidates()` to match `email_hash`
  (identity bridge Stage 3), if B7 (phone/email recycling) has also been
  addressed by this point — otherwise defer the email-matching extension
  specifically, ship phone-only linking first.

**What explicitly does not ship:**

- Full consent ledger (a minimal two-column version, per the
  simplification review, is enough to gate real linking decisions;
  the full append-only audit ledger can follow).
- Follow-up automation, summaries, insights.

**Why this order, not bundled with 2A:** 2A proves the timeline and
attribution machinery work with zero risk to anything live. 2B is where
risk is actually taken — the live contact model changes — and it should
be reasoned about, tested, and reverted independently of 2A's already-
proven pieces.

**Proves, in one sentence:** a person who arrives via Instagram, browses
the website, and moves to WhatsApp is recognized as one person across
all three touchpoints — and two different people who happen to share a
phone number are **not** silently merged, because B1 was resolved before
this shipped.

---

## 5. Phase 2C — Phone → Timeline

**What ships:**

- Voice/call events ingested into `timeline_events` — call start, end,
  transcript-ready, recording-ready — via `events_outbox` (C6), since
  `public.realtime_turns` already exists and is live (1,117 rows,
  verified).
- The tiered voice-context gate (`ANONYMOUS` / `AMBIGUOUS` / `RETURNING`
  / `VERIFIED`), including the shared-family-number `AMBIGUOUS` handling
  that must never guess.
- Caller-ID matching against existing `identity_handles`, extended with
  `voice_caller_number`.

**Why this is where Gate 0 gets tested for real:** the "identity spine
has never recognized a returning customer" finding is fundamentally a
**voice-path problem** — the brain's voice agent does not currently
extract the caller's phone from the LiveKit room name and pass it through
as customer-linking evidence, which is the direct cause of the
0-returning-customers measurement. Phase 2C is the first phase whose
entire value proposition depends on that being fixed. It should not ship
until a repaired voice agent (a brain-repo change, coordinated but not
built in this repo) demonstrates at least one real returning-customer
recognition.

**What explicitly does not ship:** anything for Messenger or email —
both remain out of scope for all of 2A/2B/2C, per the original
instruction to defer channels beyond what this three-phase sequence
requires.

**Proves, in one sentence:** a customer who has messaged on Instagram,
browsed the website, ordered over WhatsApp, and now calls in is
recognized on the phone as the same person — and a shared family member
calling from the same number is correctly treated as **ambiguous**, not
silently merged into someone else's history.

---

## 6. How this relates to the two prior "Phase 2A" definitions

So a future reader is never confused about which one is current:

| Source | What it called "Phase 2A" | Status |
|---|---|---|
| `PHASE2_IMPLEMENTATION_ROADMAP.md` | Six migrations bundling IG→website with the WhatsApp merge | **Superseded** — the bundling is exactly what this document splits apart |
| `PHASE2_ARCHITECTURE_REVIEW.md` §14 | Five stages (2A-0 prove the spine, 2A-1 handles+timeline WhatsApp-only, 2A-2 contacts alter, 2A-3 IG→website native-attribution, 2A-4 consent) | **Superseded in sequencing, not in substance** — its "prove the spine first" finding is preserved here as the Gate-0 prerequisite in §2 and the explicit precondition on Phase 2C in §5, rather than as its own numbered stage |
| **This document** | Phase 2A = Instagram→website→timeline only; Phase 2B = website→WhatsApp; Phase 2C = phone | **Current** |

The substantive finding from the architecture review — that the identity
spine must be proven before identity-linking machinery is built on top of
it — is **not dropped**. It is carried forward as the prerequisite on B1
before Phase 2B ships, and as the explicit reason Phase 2C exists last
rather than first.

---

## 7. Deferred beyond 2C

Named explicitly so scope does not creep back in:

- Messenger, email as channels.
- The full Follow-up Policy Engine (consent basics ship in 2B; the
  nine-gate scheduling engine does not).
- Customer summaries, founder insights, the full Hub UI (saved views,
  snooze, search).
- Vector store consolidation, tenancy unification — both real, both
  independent of this sequence, both trackable in
  `PHASE2_ARCHITECTURE_DECISIONS.md` F1/F2 without blocking 2A/2B/2C.
