# Phase 2 Architecture Decision Register

**Purpose:** one place to find every architectural decision Phase 2
depends on. Every entry below is **extracted** from an existing document
— none is invented here. Where a document only poses the question without
a recommendation, that is stated as "no recommendation yet," not filled
in with a new one.

**Fields per decision:** Decision · Current recommendation · Alternatives
considered · Trade-offs · Reason · Status · Owner · Source.

**Status values used:** `Blocked` (external dependency) · `Recommended,
unconfirmed` (a document proposes an answer; no one has signed off) ·
`Open` (question posed, no recommendation exists yet) · `Decided`
(already settled and acted on).

---

## A. Blocking and process decisions

### A1 — Shared migration ledger method

- **Recommendation:** one ledger, owned by the brain repo; `crm`
  migrations ship through it via Supabase MCP `apply_migration` with a
  `crm_` filename prefix.
- **Alternatives considered:** separate Supabase projects (kills the
  shared-identity premise); advisory-lock coordination (permanent
  operational tax); CRM owns the ledger (inverts Thesis A).
- **Trade-offs:** brain-repo review becomes a bottleneck for CRM schema
  changes — considered the correct price, not a cost to avoid.
- **Reason:** one database has one migration history; that is a property
  of Postgres, not a policy choice.
- **Status:** **Blocked** — needs the shared-ledger owner's decision, not
  an engineering call.
- **Owner:** shared-ledger owner (outside this repo).
- **Source:** `PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`;
  `PHASE2_ARCHITECTURE_REVIEW.md` §11 D1.

### A2 — Unify migration numbering

- **Recommendation:** one FK-topological order:
  `identity_handles → identity_evidence(+policy) → identity_merge_log →
  contacts alter → continuation_tokens → timeline_events(+types)`.
- **Alternatives considered:** create `timeline_events` first without the
  FK, add the constraint later (more migrations, a weaker guarantee in
  the interim).
- **Trade-offs:** loses the property of shipping the timeline before the
  riskiest migration, unless handles and timeline ship together and the
  event log is read before the contacts alter runs.
- **Reason:** `timeline_events.handle_id` FKs to `identity_handles`
  (`PHASE2_UNIFIED_TIMELINE_SPEC.md:36` references
  `identity_handles(id)`); the existing roadmap order is not executable.
- **Status:** **Decided.** Resolved for Phase 2A's reduced scope
  specifically: four migrations (`043`–`046`:
  `identity_handles → identity_evidence(+policy) → timeline_events(+types)
  → continuation_tokens`), with `identity_merge_log` and the `contacts`
  alteration moved to Phase 2B, removing the FK-order defect rather than
  just reordering around it. Full detail and reserved numbering for 2B
  in `PHASE2_CANONICAL_PLAN.md` §2.
- **Owner:** engineering.
- **Source:** `PHASE2_DOCUMENT_AUDIT.md` §1; `PHASE2_ARCHITECTURE_REVIEW.md` §11 D2;
  resolved in `PHASE2_CANONICAL_PLAN.md` §2.

### A3 — Scheduler provisioning

- **Recommendation:** provision and document an actual external
  scheduler (Vercel Cron or equivalent) before any `events_outbox`
  draining or follow-up sending ships.
- **Alternatives considered:** none proposed in any document — this is a
  verified gap, not a design choice with options.
- **Trade-offs:** none — this is infrastructure that must exist, not a
  trade.
- **Reason:** verified this session — no `vercel.json`, no `crons` key
  anywhere in the repo; `docs/docker.md:59` states plainly "nothing
  inside the container is scheduled."
- **Status:** **Open** — a real gap, no owner assigned yet.
- **Owner:** engineering/ops.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` addendum A3;
  `PHASE2_FOLLOWUP_POLICY_ENGINE.md` §9.5.

### A4 — Phase 1.1 generated-types sequencing

- **Recommendation:** do only steps 3 (Contacts) and 6 (Inbox) before
  Phase 2A's identity-model change; defer steps 1, 2, 4, 5, 7.
- **Alternatives considered:** run all seven steps of Phase 1.1 to
  completion before starting Phase 2.
- **Trade-offs:** steps 3 and 6 are exactly the files Phase 2A rewrites,
  so doing them first means fixing real nullable-column bugs once, on
  smaller diffs. The other five domains are untouched by Phase 2 and can
  wait.
- **Reason:** avoids doing the same rewrite twice.
- **Status:** **Decided** — recorded consistently in both `PHASE2_PLAN.md`
  and `PHASE2_IMPLEMENTATION_ROADMAP.md` §4.
- **Owner:** engineering.
- **Source:** `PHASE2_PLAN.md` "Sequencing against Phase 1.1";
  `PHASE2_IMPLEMENTATION_ROADMAP.md` §4.

---

## B. Identity decisions

### B1 — One phone may back multiple people *(the most critical open decision in the register)*

- **Recommendation:** none yet — this is the open question itself, not
  a settled answer. Two directions are named without either being
  chosen: (a) `public.customers` gains a discriminator so one
  `phone_hash` can back more than one customer row, or (b) `crm` must
  never auto-link on `phone_hash` alone at the customer layer, no matter
  how strong the evidence looks from the CRM's side.
- **Alternatives considered:** leave the constraint as-is and accept that
  shared-phone households are structurally forced into one customer
  record regardless of what `crm` decides.
- **Trade-offs:** (a) is a brain-repo schema change with its own
  migration risk; (b) means the CRM's own careful `AMBIGUOUS` handling
  (§7 of the identity doc) is cosmetic — the merge already happened one
  layer down, invisibly to the CRM.
- **Reason:** verified live —
  `customers_brand_phone_hash_unique` is an **unconditional** unique
  index on `(brand_id, phone_hash)` in production. Two people sharing a
  phone cannot exist as two customer rows today, no matter what the CRM's
  identity model decides.
- **Status:** **Open, critical** — the governing rule ("never assume two
  identities are the same without sufficient evidence") is unenforceable
  above `crm` until this is answered.
- **Owner:** brain repo owner + founder (product decision with a schema
  consequence).
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §12 T13, §11 D-implicit,
  §16; confirmed live this session (`pg_indexes` query against
  `ugjishankutgfegplrgq`).

### B2 — Identity handle schema ownership: `crm` or `public`

- **Recommendation:** `crm`, with `public.customers` as the arbiter of
  cross-brand identity.
- **Alternatives considered:** `public` — canonically purer (the brain
  owns identity generally) but forces every channel integration through
  brain-repo review, worsening the A1 bottleneck.
- **Trade-offs:** handles are workspace-scoped, so a person known to two
  brands has two separate handle sets. Acceptable at one brand; revisit
  if multi-brand arrives before Phase 3.
- **Reason:** handles are channel-facing; the CRM owns channels.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering, with brain-repo sign-off.
- **Source:** `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §13.2;
  `PHASE2_ARCHITECTURE_REVIEW.md` §11 D4.

### B3 — Confidence levels: three or five

- **Recommendation:** collapse five (`verified`/`strong`/`probable`/
  `unknown`/`rejected`) to three (`verified`/`probable`/`unknown`) for
  the UI and human-facing decisions; `rejected` becomes a boolean state,
  not a confidence level. The five-level schema may remain underneath if
  it costs nothing extra.
- **Alternatives considered:** keep all five levels end to end, as
  originally specified.
- **Trade-offs:** `strong` vs. `verified` is a distinction invisible to
  every human who will read it at current team size, and it doubles
  policy-decision branch logic for no near-term behavioral difference.
- **Reason:** Apple-style simplicity review — no user should ever see
  "probable" as a label; every contact is either confirmed or needs
  confirmation.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** product/founder (a UX call, not purely technical).
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §13, §15 ADR-007.

### B4 — Does `probable` ever auto-promote by accumulation?

- **Recommendation:** no.
- **Alternatives considered:** promote after N independent `probable`
  signals.
- **Trade-offs:** more manual-review queue volume — treated as the cost
  of correctness, not overhead to eliminate.
- **Reason:** two forgeable signals are still forgeable; accumulation is
  inference wearing a threshold, exactly what the governing rule exists
  to prevent.
- **Status:** **Decided** — stated as the design's own position and
  independently endorsed on review.
- **Owner:** engineering.
- **Source:** `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §13.7;
  `PHASE2_ARCHITECTURE_REVIEW.md` §11 D7.

### B5 — Retroactive late-binding window (shared-device wrong merge)

- **Recommendation:** a `verified` promotion binds only events *after*
  the handle's first identifying evidence, unless a second independent
  signal covers the earlier window.
- **Alternatives considered:** bind all prior anonymous history
  unconditionally on promotion, as currently specified.
- **Trade-offs:** loses some retroactive attribution value for the
  common case (same person, forwarded link) to close the rare-but-real
  case (shared household device, two different people).
- **Reason:** a shared device (e.g., a household tablet) produces a real
  wrong merge with no forwarding involved — the design's own
  token-forwarding defense never engages because nothing was forwarded.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §10, §12 T14, §15 ADR-009.

### B6 — Shared-device re-verification flag (OTP tier)

- **Recommendation:** a per-handle flag, settable by a founder or
  triggered by a repeated ambiguous-match signal, that demotes future
  OTP evidence on that handle from automatic to human-reviewed.
- **Alternatives considered:** none — this closes a gap (OTP proves
  possession, not personhood) that has no existing mitigation.
- **Trade-offs:** one more UI state and one more thing to reason about,
  for a genuinely rare case.
- **Reason:** the same shared-phone failure named for voice (caller ID)
  applies equally to OTP-verified phone at the `verified` tier, and the
  identity doc does not cross-reference the two.
- **Status:** **Open** — a genuine product/UX timing call (worth
  building before or after a real incident demonstrates the need).
- **Owner:** product/founder.
- **Source:** this session's independent review (`PHASE2_ARCHITECTURE_REVIEW.md`
  addendum context; identity doc §7 cross-referenced against §2.2).

### B7 — Phone and email recycling / dormancy gap

- **Recommendation:** none yet for phone; **not generalized to email at
  all.**
- **Alternatives considered:** none proposed.
- **Trade-offs:** unaddressed either way — a dormant number or address
  reassigned to a new person could wrongly re-link to the old customer.
- **Reason:** `email_hash` becomes an equally auto-linkable evidence type
  once Stage 3 of the identity bridge ships, but only phone's recycling
  risk is named as an open question.
- **Status:** **Open.**
- **Owner:** product/founder.
- **Source:** `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §13.5;
  `PHASE2_ARCHITECTURE_REVIEW.md` addendum A4.

### B8 — `identity_merge_log` vs. `timeline_events` duplication

- **Recommendation:** `identity_merge_log` remains the immutable,
  audit-grade detail table (merge-specific structured columns,
  `REVOKE UPDATE, DELETE`); the corresponding `identity.merged`/
  `identity.split`/`identity.rejected` `timeline_events` row points to it
  via `payload_ref` rather than duplicating its columns — the same
  pointer-not-payload rule already applied to every other event type.
- **Alternatives considered:** keep both as fully independent,
  non-pointing records (the original, unreconciled state).
- **Trade-offs:** none identified — this doesn't remove either table's
  distinct value (the audit table's lockdown and structured fields; the
  timeline's role as one chronological index), it only removes the
  duplication between them.
- **Reason:** the identity doc itself states a merge "emits an
  `identity.merged` event," while also defining a full separate
  `identity_merge_log` table for the same operation.
- **Status:** **Decided.** Not built in Phase 2A (`identity_merge_log`
  is Phase 2B scope) — resolved now so 2B's design doesn't inherit the
  same unreconciled duplication.
- **Owner:** engineering.
- **Source:** `PHASE2_DOCUMENT_AUDIT.md` §4; `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §8, §3;
  resolved in `PHASE2_CANONICAL_PLAN.md` §5.

### B9 — Client-side identity resolution

- **Recommendation:** post-2A.2, the contact-creation path must not be
  reachable from a browser-scoped client; route it through a server-side
  endpoint instead.
- **Alternatives considered:** leave `contact-form.tsx`'s direct
  `findExistingContact` call from the browser as-is.
- **Trade-offs:** requires an extra network hop for the manual
  contact-form path; closes a real policy-enforcement gap.
- **Reason:** verified — `contact-form.tsx` is a `'use client'` component
  calling `findExistingContact` with a user-scoped Supabase client.
  Identity policy is otherwise enforced server-side everywhere else;
  this is the one path where it isn't.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §12 T16.

---

## C. Timeline and Hub decisions

### C1 — Is `timeline_events` the source of truth, or a projection? *(the five-year question)*

- **Recommendation:** source of truth **for events**, never **for
  content**. `timeline_events` owns *what happened and when*;
  `crm.messages`, `public.chat_turns`, `realtime_turns`, `orders` own
  *what was said*.
- **Alternatives considered:** a projection over `crm.messages` + brain
  events, rebuilt from sources on demand.
- **Trade-offs:** dual-write risk between `crm.messages` and
  `timeline_events`, mitigated by `dedupe_key` plus a reconciliation
  check that must become an owned component, not a listed mitigation.
- **Reason:** a projection must be rebuildable from sources forever, and
  cannot represent events with no source row at all —
  `campaign.click` on an anonymous visit, `identity.merged`,
  `consent.withdrawn`. A projection also cannot be genuinely append-only,
  which collapses the immutability and audit guarantees the whole design
  depends on.
- **Status:** **Recommended, unconfirmed** — but held with high
  confidence in the source document.
- **Owner:** engineering.
- **Source:** `CODEX_REVIEW_BRIEF.md` Decision 11; `PHASE2_ARCHITECTURE_REVIEW.md` §11 D8.

### C2 — Does `crm.messages` gain a `channel` column?

- **Recommendation:** no, never. Write `timeline_events` from day one;
  migrate the inbox to read it in a later increment (2H in the original
  roadmap's numbering).
- **Alternatives considered:** add the column now (cheap, fast) — rejected
  because it guarantees the expensive move (migrating the inbox) happens
  later anyway, with more rows and two channel concepts to reconcile by
  then.
- **Trade-offs:** the inbox shows no channel badge until the migration
  happens; the timeline page shows it in the meantime.
- **Reason:** every future channel must mean "write to `timeline_events`,"
  never "teach the inbox about another table."
- **Status:** **Recommended, unconfirmed** on the "never" — this directly
  contradicts `PHASE2_PLAN.md` Stage 1, which is stale and has not been
  corrected (see `PHASE2_DOCUMENT_AUDIT.md` §3.1).
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §11 D3.

### C3 — Does `crm.conversations` get updated by non-message timeline events?

- **Recommendation:** none yet — named as a gap, not yet resolved. A
  trigger or scheduled projection from `timeline_events` into
  `conversations.last_message_at`/`unread_count` is the shape proposed,
  not yet decided as final.
- **Alternatives considered:** retire `conversations` entirely and derive
  thread state from `timeline_events` directly at read time.
- **Trade-offs:** the trigger/projection approach keeps the existing
  inbox queries working unchanged; the retire-and-derive approach is the
  cleaner long-term shape but a larger rewrite.
- **Reason:** verified — today, `conversations.unread_count` and
  `last_message_at` update only from `crm.messages` inserts. Ship every
  other channel exactly as specified and the inbox thread list still
  reflects WhatsApp only.
- **Status:** **Open** — the single highest-leverage unresolved item for
  making the Hub principle literally true rather than just designed.
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` addendum A1.

### C4 — `timeline_events` partitioning strategy

- **Recommendation:** decide and implement monthly `RANGE` partitioning
  on `occurred_at` in the table's creation migration, not deferred.
- **Alternatives considered:** the roadmap's own recommendation — defer
  the decision until "past ~5M rows."
- **Trade-offs:** adds operational complexity to the first migration of
  Phase 2A, before 2A's own volume needs it.
- **Reason:** the stated target scale (100 brands, 100M events) is two
  orders of magnitude past the deferred-decision threshold this document
  originally proposed, and retrofitting partitioning onto a live, FK'd,
  RLS-protected table later is a strictly harder migration than
  establishing it up front.
- **Status:** **Decided — and revised from the recommendation above.**
  `PHASE2_CANONICAL_PLAN.md` §3 resolves this for Laddoos-only scope
  (Phase 1's own locked decision: single account, no multi-tenant
  scaffolding) as **unpartitioned at creation**, not partitioned. The
  100-brand target this recommendation was sized against belongs to a
  hypothetical multi-tenant future with no architecture decided for it
  yet (F2, still open). The canonical plan closes the practical gap
  instead: a composite primary key and a composite `dedupe_key` unique
  constraint (`occurred_at` included in both) so a future conversion to
  partitioning requires no constraint changes, plus an explicit revisit
  trigger (5M rows, or a second tenant onboarded — whichever first).
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §8 L8, §11 D8, §15 ADR-003;
  `PHASE2_DOCUMENT_AUDIT.md` §3.4; original deferred-threshold
  recommendation in `PHASE2_UNIFIED_TIMELINE_SPEC.md` §11 item 1;
  resolved in `PHASE2_CANONICAL_PLAN.md` §3.

### C5 — Re-resolution write amplification on merge

- **Recommendation:** none yet — named as unaddressed. Batching, a
  statement-level guard, or read-time resolution for high-cardinality
  handles are named as directions, not chosen.
- **Alternatives considered:** the current design — a per-row `UPDATE`
  with a `BEFORE UPDATE` trigger on every affected event.
- **Trade-offs:** unresolved either way; at 100M events, merging a
  high-volume handle is currently a large, trigger-amplified write under
  lock.
- **Reason:** `resolve_timeline_identities()` issues one `UPDATE …
  WHERE handle_id = ?` that fires a per-row PL/pgSQL trigger for every
  matched event.
- **Status:** **Open.**
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §5, §12 T15.

### C6 — Brain writes the timeline directly, or via `events_outbox`?

- **Recommendation:** `events_outbox`, as originally proposed.
- **Alternatives considered:** direct cross-repo triggers from `public`
  into `crm.timeline_events`.
- **Trade-offs:** poller latency and poller-lag as a new, observable
  failure mode, versus a hard cross-repo coupling that violates the
  Phase 1 ownership rule.
- **Reason:** `events_outbox` already exists and is live — 452 rows,
  verified this session — not a hypothetical component to build.
- **Status:** **Recommended, unconfirmed**, but the underlying mechanism
  is already proven to exist and work.
- **Owner:** engineering, brain-repo coordination required.
- **Source:** `PHASE2_UNIFIED_TIMELINE_SPEC.md` §11.2;
  `PHASE2_ARCHITECTURE_REVIEW.md` §11 D11.

### C7 — Web SDK event volume: every page view, or meaningful only?

- **Recommendation:** meaningful events only.
- **Alternatives considered:** log every page view.
- **Trade-offs:** a full page-view firehose is the fastest way to make
  `timeline_events` unmanageable at scale; meaningful-only loses some
  granularity for on-site behavior analysis.
- **Reason:** stated directly in the source document as the recommended
  default.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_UNIFIED_TIMELINE_SPEC.md` §11.6.

---

## D. Follow-up and consent decisions

### D1 — Consent sequencing relative to event capture

- **Recommendation:** ship consent (originally "2B") *with* the first
  slice that captures real events, not after it.
- **Alternatives considered:** the original roadmap sequencing — consent
  follows the first event-capturing increment.
- **Trade-offs:** enlarges whatever slice first captures real events.
- **Reason:** the DPDP obligation attaches at first capture, not at first
  automated send — sequencing consent later leaves a real compliance gap
  for however long the interval is.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering, legal input needed on scope.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §11 D10, §15 ADR-014.

### D2 — Consent basis for CTWA-initiated conversations

- **Recommendation:** none — open legal question.
- **Alternatives considered:** treat ad-initiated WhatsApp conversations
  as implying marketing consent; treat them as service-consent only.
- **Trade-offs:** determines gate 2's default behavior in the follow-up
  engine for a common conversation-origin case.
- **Reason:** genuinely ambiguous under current framing; not an
  engineering question.
- **Status:** **Open, legal.**
- **Owner:** legal/founder.
- **Source:** `PHASE2_FOLLOWUP_POLICY_ENGINE.md` §9.1.

### D3 — Cross-channel fallback when outside a policy window

- **Recommendation:** no, not by default; per-rule opt-in only.
- **Alternatives considered:** automatically fall back to a different
  channel (e.g., WhatsApp outside its window → try Instagram).
- **Trade-offs:** loses some delivery reach; avoids what could read as an
  end-run around a platform's own policy window.
- **Reason:** stated directly as the recommended default.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** product/founder.
- **Source:** `PHASE2_FOLLOWUP_POLICY_ENGINE.md` §9.4.

### D4 — Who may edit channel policies

- **Recommendation:** owner only.
- **Alternatives considered:** any admin; any account member.
- **Trade-offs:** narrower editing access versus the risk that a bad edit
  jeopardizes the WhatsApp number itself.
- **Reason:** stated directly as the recommended default, given the risk
  a bad policy edit poses to the underlying channel account.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** product/founder.
- **Source:** `PHASE2_FOLLOWUP_POLICY_ENGINE.md` §9.3.

### D5 — Does an inbound call count as "customer replied" for the cancellation gate?

- **Recommendation:** yes.
- **Alternatives considered:** treat calls separately from message-based
  replies.
- **Trade-offs:** none identified — a straightforward extension of the
  existing taxonomy.
- **Reason:** `call.inbound` is already tagged `is_customer_action = true`
  in the event taxonomy.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_FOLLOWUP_POLICY_ENGINE.md` §9.6.

---

## E. Founder Intelligence decisions

### E1 — Adopt `public.insight_review_queue`, or justify a parallel workflow

- **Recommendation:** none yet — flagged as unreconciled, not resolved.
  The source document names the brain's queue as the thing to reuse,
  then defines an independent `status` enum without reconciling the two.
- **Alternatives considered:** keep the new, independent `insights.status`
  workflow as specified.
- **Trade-offs:** adopting the brain's queue avoids a third parallel
  intelligence workflow but requires its shape to actually fit;
  documenting a deliberate reason not to reuse it is the other honest
  outcome.
- **Reason:** self-contradiction within one document (§3.1 vs. §3.2).
- **Status:** **Open.**
- **Owner:** engineering.
- **Source:** `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §3.1, §3.2, §7.1
  (implicitly); `PHASE2_ARCHITECTURE_REVIEW.md` addendum A5.

### E2 — Summary regeneration trigger

- **Recommendation:** on-open, with a staleness check — regenerate when a
  summary is viewed and events have accumulated since, not on a fixed
  schedule.
- **Alternatives considered:** regenerate per meaningful event (real-time
  but expensive); regenerate on a fixed hourly batch.
- **Trade-offs:** on-open avoids paying generation cost for customers
  nobody is currently looking at.
- **Reason:** stated directly as the recommended default.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §7.2.

### E3 — One AI configuration, or two

- **Recommendation:** none yet — named as a real convergence point, not
  resolved. `crm.ai_configs` (per-account, BYO key) and the brain's own
  persona/skill configuration currently coexist.
- **Alternatives considered:** keep both, indefinitely.
- **Trade-offs:** converging on one avoids configuring the same thing
  twice but requires deciding which system is authoritative for
  founder-facing AI behavior.
- **Reason:** the architecture review's broader recommendation (converge
  on one AI layer) first becomes concrete here.
- **Status:** **Open.**
- **Owner:** engineering/founder.
- **Source:** `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §7.3;
  `YALI_ARCHITECTURE_REVIEW.md` §4.

### E4 — Insight support threshold

- **Recommendation:** 5 events across 3 distinct contacts, as a default
  minimum before an observation becomes a stored insight.
- **Alternatives considered:** any other numeric threshold; no threshold
  at all.
- **Trade-offs:** too low a threshold risks "three complaints called a
  trend"; too high delays genuinely useful early signals.
- **Reason:** stated directly as the proposed default, a business call
  rather than a technical one.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** product/founder.
- **Source:** `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §7.4.

### E5 — Do aggregate insights leak `sensitive`-visibility content?

- **Recommendation:** no — insights cite only `team`-visible events
  unless the viewer holds the specific grant.
- **Alternatives considered:** allow aggregation across all visibility
  tiers, since aggregation somewhat obscures individual records.
- **Trade-offs:** a stricter default may exclude some real signal that
  only lives in `sensitive` events (e.g., call transcripts); considered
  the safer default regardless.
- **Reason:** aggregation can leak what per-record visibility rules are
  specifically meant to protect.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §7.5.

### E6 — Insight generation confidence floor

- **Recommendation:** none yet — named as missing, not designed. A
  computed floor tied to sample size and period width, rather than a
  purely model-asserted confidence value.
- **Alternatives considered:** the current design — confidence is
  whatever the generation step states, constrained only by the
  evidence-count `CHECK` constraint existing at all.
- **Trade-offs:** a computed floor adds implementation complexity but
  prevents "5 events, 3 contacts" from being labeled "high confidence"
  by the generation step alone.
- **Reason:** the schema requires evidence to exist; it does not require
  confidence to be proportionate to how much of it there is.
- **Status:** **Open.**
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §7 (Missing Components,
  item 4), verified against `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §3.2.

### E7 — Meta Ads attribution as a first-class ingestion source

- **Recommendation:** wire Instagram/Messenger's per-message `referral`
  object (and WhatsApp's `ctwa_clid`, already scoped) into the timeline
  as its own event source, independent of continuation tokens —
  alternatively, per a sharper simplification review, defer continuation
  tokens entirely and ship native Meta attribution first, adding tokens
  only if measurement later proves a real coverage gap for forwarded
  links.
- **Alternatives considered:** rely on continuation tokens as the
  primary attribution mechanism, with native Meta attribution as a
  secondary signal (the identity doc's original framing).
- **Trade-offs:** native-attribution-first is simpler and covers the
  common ad-driven-DM path immediately; deferring tokens loses coverage
  for the specific forwarded-link scenario the identity doc was built
  around.
- **Reason:** verified — today's webhook has zero handling of
  `referral`/`ctwa_clid`; an ad-driven DM that never touches a tracked
  link currently has no attribution path at all.
- **Status:** **Recommended, unconfirmed** — two documents disagree on
  sequencing (identity doc treats tokens as primary; the review
  recommends the reverse).
- **Owner:** engineering/product.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §7, §11 D11 (labeled
  differently in that document than in `CODEX_REVIEW_BRIEF.md`), §13.

### E8 — Persist `customer_summaries`, or generate on read

- **Recommendation:** consider not persisting at all for v1 — generate
  on read, cache briefly, persist only once latency or cost data proves
  the need.
- **Alternatives considered:** the current design — a persisted, versioned
  table with `is_current`/`superseded_by` lineage.
- **Trade-offs:** the versioned-lineage approach answers "what did we
  believe on the 3rd" for free; generate-on-read is simpler and cheaper
  at current volume but loses that historical query for free.
- **Reason:** HubSpot-style simplicity review — this is real engineering
  for a cost problem that does not yet exist at current volume.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §13.

---

## F. Long-term / scale decisions

### F1 — Two vector stores — consolidation timing

- **Recommendation:** consolidate on `public.kb_chunks` now, on the
  critical path before the customer-summary work begins — not "in
  parallel," which in practice means "not scheduled."
- **Alternatives considered:** keep both with a routing layer in front.
- **Trade-offs:** a routing layer avoids the migration cost but adds a
  third concept to explain forever; consolidating now delays the
  summary work that depends on one clean knowledge surface.
- **Reason:** named as the fastest-compounding debt across three
  separate documents; every day both stores run, more content lands in
  the wrong one.
- **Status:** **Recommended, unconfirmed** — named repeatedly, still not
  scheduled anywhere.
- **Owner:** engineering.
- **Source:** `YALI_ARCHITECTURE_REVIEW.md` §4; `PHASE2_IMPLEMENTATION_ROADMAP.md`
  §5; `PHASE2_ARCHITECTURE_REVIEW.md` §11 D9.

### F2 — Tenancy unification: workspace-scoped `crm` vs. tenant/brand-scoped `public`

- **Recommendation:** none yet — explicitly deferred, not resolved.
- **Alternatives considered:** none proposed; the mismatch is named, not
  designed around.
- **Trade-offs:** works today at one brand; identified as the seam most
  likely to tear if the CRM ever serves more than one founder rather
  than one founder with more brands.
- **Reason:** `crm.contacts` is workspace-scoped
  (`crm_workspace_id`/`account_id`); `public.customers` is tenant/brand
  scoped, joined only through `workspace_brand_map`'s one-active-mapping
  constraint.
- **Status:** **Open**, explicitly deferred to Phase 3.
- **Owner:** founder/product (depends on whether YALI OS becomes
  multi-founder).
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §5, §15 ADR-016.

### F3 — Portfolio / multi-account aggregation

- **Recommendation:** none — explicit decision needed on whether this is
  in scope for YALI OS long-term, not a silent gap.
- **Alternatives considered:** none proposed.
- **Trade-offs:** irrelevant at one brand/one founder; blocking if YALI
  OS becomes a platform for many independent founders.
- **Reason:** every Founder Intelligence object (`insights`,
  `customer_summaries`) is scoped to one `account_id`, with no
  cross-account view designed.
- **Status:** **Open.**
- **Owner:** founder/product.
- **Source:** `PHASE2_ARCHITECTURE_REVIEW.md` §7 (item 6).

### F4 — Token signing key: global or per-tenant

- **Recommendation:** a global key with a `key_id` prefix embedded in the
  token format now (`v1.<key_id>.<id>.<sig>`); defer the move to
  per-tenant keys.
- **Alternatives considered:** per-tenant keys immediately.
- **Trade-offs:** a global key compromise invalidates all tokens across
  every tenant, mitigated by short TTLs and existing revocation; adding
  the `key_id` slot now costs nothing and makes a later per-tenant move
  non-breaking.
- **Reason:** the original token format has no key identifier at all,
  which would make rotation require accepting both old and new keys
  blindly.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §13.4;
  `PHASE2_ARCHITECTURE_REVIEW.md` §11 D5.

### F5 — Web visitor ID storage

- **Recommendation:** first-party cookie (`SameSite=Lax`, `Secure`,
  ~180 days), written only after consent where a banner applies;
  `localStorage` as a same-origin fallback.
- **Alternatives considered:** `localStorage` only (needs a client
  round-trip before resolution); both unconditionally (creates two
  identifiers that can disagree).
- **Trade-offs:** consent-gating loses some anonymous attribution before
  consent is granted — considered the correct trade under DPDP.
- **Reason:** cookies survive navigation and are server-readable at
  first byte, which the token-resolution flow needs.
- **Status:** **Recommended, unconfirmed.**
- **Owner:** engineering.
- **Source:** `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §13.6;
  `PHASE2_ARCHITECTURE_REVIEW.md` §11 D6.

---

## Summary — decisions blocking Phase 2A specifically

**Updated — A2 and C4 are now resolved**, per `PHASE2_CANONICAL_PLAN.md`.

| Decision | Status | Still blocks 2A? |
|---|---|---|
| **A2** — numbering unification | **Decided** | No — resolved: `043`–`046`, FK-safe, `identity_merge_log`/`contacts` alter moved to 2B |
| **C4** — partitioning strategy | **Decided** | No — resolved: unpartitioned at creation, composite-key shape, explicit revisit trigger |
| **A1** — migration ledger | Blocked (external) | Blocks **production apply only** — not writing or locally testing `043`–`046` |
| **B1** — one phone may back multiple people | Open | Does **not** block 2A (no `public.customers` linking in this phase) — blocks **Phase 2B** |
| **A3** — scheduler provisioning | Open | Does not block 2A, 2B, or 2C — only the later Follow-up engine |

**With A2 and C4 resolved, nothing on this register blocks writing the
four Phase 2A migration files.** Applying them to production still needs
A1. See `PHASE2_CANONICAL_PLAN.md` for the resolved specifics and
`PHASE2_READINESS_CHECKLIST.md` for the full current verdict.
