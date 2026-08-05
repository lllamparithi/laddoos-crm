# Phase 2 Document Audit

**Purpose:** catalog every inconsistency across the nine Phase 2 documents
before Phase 2 implementation begins. **Nothing is fixed here** — this is
the audit only. Fixes land in `PHASE2_GLOSSARY.md`,
`PHASE2_ARCHITECTURE_DECISIONS.md`, and `PHASE2_SCOPE_REDUCTION.md`.

**Documents audited:**

| # | Document | Role |
|---|---|---|
| 1 | `PHASE2_PLAN.md` | First-pass roadmap, written before full scope was specified |
| 2 | `PHASE2_IMPLEMENTATION_ROADMAP.md` | Fuller roadmap, written after full scope specified |
| 3 | `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` | Identity model detail |
| 4 | `PHASE2_UNIFIED_TIMELINE_SPEC.md` | Timeline model detail |
| 5 | `PHASE2_FOLLOWUP_POLICY_ENGINE.md` | Follow-up engine detail |
| 6 | `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` | Summary/insight layer detail |
| 7 | `YALI_ARCHITECTURE_REVIEW.md` | Phase 1 judged against the five-year vision |
| 8 | `PHASE2_ARCHITECTURE_REVIEW.md` | Independent review of documents 1–7, with live-data verification |
| 9 | `CODEX_REVIEW_BRIEF.md` | Handoff brief for an external reviewer |

Every finding below was re-verified against the actual file content or the
live repository, not copied from a prior summary.

---

## 1. Migration numbering — three schemes, not the same conflict twice

There are exactly **three distinct assignments** for migrations `043`–`047`,
verified by grep across every document:

| # | `PHASE2_PLAN.md` | `PHASE2_IMPLEMENTATION_ROADMAP.md` | Detailed specs (IDENTITY→TIMELINE→FOLLOWUP→INTELLIGENCE) |
|---|---|---|---|
| `043` | channel column on `crm.messages`/`conversations` | `timeline_events` + `timeline_event_types` | `identity_handles` |
| `044` | `crm.contact_handles` | `identity_handles` | `identity_evidence` (+`identity_evidence_policy`) |
| `045` | identity bridge → `email_hash` | `identity_evidence` (+policy) | `identity_merge_log` |
| `046` | — | `identity_merge_log` | `contacts_multichannel` (phone nullable) |
| `047` | — | `contacts` alterations | `continuation_tokens` |
| `048` | — | `continuation_tokens` | `timeline_events` (owned by `TIMELINE` doc) |
| `049`–`051` | — | — | consent, `channel_policies`, `followup_rules` (`FOLLOWUP` doc) |
| `052`–`053` | — | — | `customer_summaries`, `insights` (`INTELLIGENCE` doc) |

**What this table actually shows, precisely:** the four detailed-spec
documents (IDENTITY, TIMELINE, FOLLOWUP, INTELLIGENCE) agree with each
other and form one continuous, internally consistent sequence from `043`
through `053`. The conflict is between that sequence and **two other,
independent numbering schemes** — `PHASE2_PLAN.md`'s (which never gets
past `045` and assigns something different at every number) and
`PHASE2_IMPLEMENTATION_ROADMAP.md`'s (which reaches `048` but disagrees
with the detailed specs at every number from `043` to `047`).

**A second, more serious defect inside the Roadmap's own scheme:**
`PHASE2_IMPLEMENTATION_ROADMAP.md` sequences `043 timeline_events` before
`044 identity_handles`. But `048_timeline_events.sql`
(`PHASE2_UNIFIED_TIMELINE_SPEC.md:36`) contains
`handle_id UUID REFERENCES identity_handles(id)`. **A table cannot be
created with a foreign key to a table that does not yet exist.** This was
identified and confirmed in `PHASE2_ARCHITECTURE_REVIEW.md` §6 row 5 — the
roadmap's own ordering, taken literally, does not execute.

**Resolution status:** none of the three schemes has been corrected in
place. `PHASE2_ARCHITECTURE_REVIEW.md` §11 D2 proposes a fourth, corrected,
FK-topological order (`identity_handles → identity_evidence →
identity_merge_log → contacts alter → continuation_tokens →
timeline_events`) but this has not been written back into any of the
source documents. See `PHASE2_ARCHITECTURE_DECISIONS.md` for the
consolidated decision.

---

## 2. Table and column naming conflicts

| Concept | Name used | Where |
|---|---|---|
| Channel-scoped identity table | `crm.contact_handles` | `PHASE2_PLAN.md:78` |
| Same concept | `identity_handles` | Every other document |
| Migration file for the contacts alteration | `047_contacts.sql` (implied) | `PHASE2_IMPLEMENTATION_ROADMAP.md:62` |
| Same migration | `046_contacts_multichannel.sql` | `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md:262` |

**Resolution:** `PHASE2_GLOSSARY.md` fixes `identity_handles` as canonical;
`contact_handles` should not appear in any future document.

### 2.1 Pre-existing naming inconsistency, inherited rather than introduced

Migration `037_workspace_brand_map.sql:29` names its foreign-key column
`crm_workspace_id`, referencing `accounts(id)`. Every Phase 2 document uses
"workspace" in prose to mean the same thing "account" means in the schema.
**This predates Phase 2** — it is a Phase 1 naming choice — but Phase 2
documents inherit and continue the ambiguity rather than resolving it.
`PHASE2_GLOSSARY.md` records the mapping explicitly so a future reader
does not go looking for a `workspaces` table that does not exist.

### 2.2 Overlapping confidence fields, not yet disambiguated

Three distinct "confidence" values exist across the design, and no document
states plainly that they are different things:

| Field | Table | Meaning |
|---|---|---|
| `timeline_events.confidence` | `048_timeline_events.sql` | Confidence in one recorded fact |
| `contacts.identity_confidence` | `046_contacts_multichannel.sql` | Confidence in the contact's overall identity cluster |
| `contacts.customer_link_confidence` | Phase 1 (`039`/`040`), widened in `046` | Confidence specifically in the contact→customer link |

None of these is wrong, and none conflicts with another — but no document
says "these are three different scopes of confidence," which risks a
reader assuming they're redundant or conflating them. Recorded in the
glossary (§ "confidence").

---

## 3. Conflicting or superseded architectural positions

### 3.1 `crm.messages.channel` — proposed, then explicitly rejected, without the source document being updated

- `PHASE2_PLAN.md` Stage 1 (§"Stage 1 — Channel dimension `043`") proposes
  adding a `channel` column to `crm.messages` and `crm.conversations`.
- `CODEX_REVIEW_BRIEF.md` §3.2 names this as an open question against the
  detailed specs' silence on `crm.messages`.
- `PHASE2_ARCHITECTURE_REVIEW.md` §11 D3 answers it explicitly: **"Neither
  now — and never add `channel` to `crm.messages`."**

`PHASE2_PLAN.md` still describes the rejected approach. It has not been
corrected or marked superseded.

### 3.2 Three different definitions of "Phase 2A"

| Source | What "Phase 2A" contains |
|---|---|
| `PHASE2_IMPLEMENTATION_ROADMAP.md` §2 | Six migrations, five increments (2A.1–2A.5), bundling the WhatsApp identity merge with Instagram→website in one slice |
| `PHASE2_ARCHITECTURE_REVIEW.md` §14 | Five stages (2A-0 through 2A-4): **prove the identity spine works first**, then handles+timeline (WhatsApp only), then the contacts alter, then Instagram→website (native attribution only, no tokens), then consent |
| This session's Task 4 (current instruction) | Instagram→Website→Timeline **only**; WhatsApp and phone deferred to 2B/2C respectively |

These are not typos — they are three different engineering judgments about
what the smallest safe first slice is, made at three different points in
this project's history as more was learned (the numbering bug, the
unmeasured identity spine, and now a direct instruction to cut scope
further). `PHASE2_SCOPE_REDUCTION.md` resolves this by producing one
current sequencing and explicitly stating how it relates to the two prior
ones — it does not silently pick one and ignore the others.

### 3.3 The brain's "multi-channel" claim, oversold by its earliest source and corrected by its latest

- `YALI_ARCHITECTURE_REVIEW.md` (the earliest document in this set) cites
  `public.sessions.channel` and `public.customers.last_contact_channel` as
  evidence the brain "is already a multi-channel platform."
- `PHASE2_ARCHITECTURE_REVIEW.md` §6 row 1 corrects this with a live query:
  the column exists; the table has **zero rows**. Live channel data
  actually lives in `chat_turns` (1,650 rows) and `realtime_turns` (1,117
  rows), not `sessions`.

This is not a contradiction so much as an earlier document's claim being
checked and found overstated by a later, more rigorous one. `PHASE2_PLAN.md`
and the four detailed spec documents were all written after
`YALI_ARCHITECTURE_REVIEW.md` and before `PHASE2_ARCHITECTURE_REVIEW.md`,
so they inherit the overstated framing without benefit of the correction.

### 3.4 Partitioning timing — a stale recommendation

`PHASE2_IMPLEMENTATION_ROADMAP.md` §11 item 1 recommends deferring
`timeline_events` partitioning until "past ~5M rows." Given this review's
own stated target scale (100 brands, 100M events), `PHASE2_ARCHITECTURE_REVIEW.md`
§8 (L8) and its addendum treat this as a risk requiring resolution before
`043`/`048` is written, not deferred. The roadmap's recommendation has not
been updated to reflect this.

---

## 4. Duplicate concepts

Per the task's own examples — things that exist twice where one should be
extended instead.

| Duplicate | First instance | Second instance | Status |
|---|---|---|---|
| Vector store | `crm.ai_knowledge_chunks` (Phase 1, `030_ai_knowledge.sql`) | `public.kb_chunks` (brain) | Named as debt in `YALI_ARCHITECTURE_REVIEW.md`, `PHASE2_IMPLEMENTATION_ROADMAP.md` §5, and `PHASE2_ARCHITECTURE_REVIEW.md` D9. All three agree it's debt; none has scheduled the fix on a critical path |
| Insight review workflow | `public.insight_review_queue` (brain, exists, 0 rows) | `insights.status` enum, newly proposed in `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §3.2 | The same document's §3.1 names the brain's queue as the thing to reuse, then §3.2 defines an independent workflow without reconciling. Self-contradiction inside one document, not just a cross-document duplicate |
| Identity-change audit trail | `identity_merge_log` (`PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §3, migration `045`) | `timeline_events` with `event_type IN ('identity.merged', 'identity.split', ...)` — the same document explicitly says a merge "emits an `identity.merged` event" | Two ledgers recording the same operation, with different columns. Not previously flagged in any document; recorded here for the first time |

---

## 5. Stale references and obsolete assumptions

1. **`PHASE2_PLAN.md` as a whole is superseded** by
   `PHASE2_IMPLEMENTATION_ROADMAP.md` and the four detailed specs, but
   carries no notice saying so. A reader opening it first (it sorts
   alphabetically before the roadmap) would build the wrong migration
   numbers and the rejected `crm.messages.channel` approach.
2. **`CODEX_REVIEW_BRIEF.md`'s open questions are partially answered
   elsewhere** — its §3.1 (numbering) and §3.2 (`crm.messages.channel`)
   are both now addressed by `PHASE2_ARCHITECTURE_REVIEW.md` D2/D3. The
   brief itself has not been updated to point to those answers; it still
   reads as an open handoff document.
3. **The roadmap's consolidated decision list (§5, 17 items) predates**
   `PHASE2_ARCHITECTURE_REVIEW.md`'s additional findings (its own D1–D11,
   T13–T16, L1–L9). The roadmap's list is not wrong, but it is now
   incomplete relative to what has since been found.
4. **`PHASE2_FOLLOWUP_POLICY_ENGINE.md`'s plan to reuse
   `automations/cron`** assumes a working, scheduled trigger. Verified
   this session (see `PHASE2_ARCHITECTURE_REVIEW.md` addendum A3): no
   scheduler is configured anywhere in this deployment. `docs/docker.md:59`
   states this outright. The follow-up doc's assumption is not corrected.

---

## 6. Terminology used inconsistently in prose (not schema conflicts, but worth fixing in the glossary)

| Term | Variants seen |
|---|---|
| The channel-facing system | "the CRM", "crm", "this repo" |
| The intelligence/memory system | "the brain", "the Yali brain", "public", "Yali Build 2.0" |
| The unified inbox | "the Hub", "BlackBerry Hub", "unified inbox", "/hub" |
| The KPI view | "Founder Dashboard", "morning digest", "/morning" |
| A generated per-customer summary | "customer summary", "living customer summary" |
| A generated aggregate finding | "insight", "founder insight" |

None of these cause a build error. All of them cost a reader time
figuring out whether two phrases mean the same thing. Resolved in
`PHASE2_GLOSSARY.md`.

---

## 7. What is verified, not just consistent — worth stating plainly

Several things repeated across multiple documents were independently
re-checked against the live repository or database this session and
confirmed accurate, not merely internally consistent:

- 42 migrations, zero "channel" occurrences across all of them.
- `contacts.phone TEXT NOT NULL` at `001_initial_schema.sql:44`.
- `findExistingContact` has exactly 8 call invocations across 4 files
  (not "four call sites" as `CODEX_REVIEW_BRIEF.md` originally stated —
  corrected in `PHASE2_ARCHITECTURE_REVIEW.md` §6 row 3).
- `customers_brand_phone_hash_unique` is a live, unconditional unique
  index on `(brand_id, phone_hash)` in production.
- 16 `customers` rows, 0 with `total_sessions > 1`, 0 with `full_name`,
  0 with `email_hash`, 15 distinct phone hashes; `sessions` 0 rows;
  `events_outbox` 452 rows; `chat_turns` 1,650; `realtime_turns` 1,117;
  `kb_chunks` 309.

These are cited here so the audit itself does not need to be re-verified
by the next reader — they were checked, not assumed, and match exactly
across every document that cites them.
