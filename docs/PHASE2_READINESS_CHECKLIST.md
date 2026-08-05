# Phase 2 Readiness Checklist

> **Update 2026-08-05 — read this before anything below.** Migrations
> `001`–`047` are **applied to production** (`ugjishankutgfegplrgq`,
> 2026-08-04) and `crm` is exposed in PostgREST. Every "not applied to
> production", "still not written", and "production apply not approved"
> statement below predates that and is historical.
>
> **Migration numbering, current:** `043`–`046` are Phase 2A. `047` is
> `047_revoke_claim_ai_reply_slot_public`, a security hotfix applied to
> production and now present locally at
> `supabase/migrations/047_revoke_claim_ai_reply_slot_public.sql` so a
> from-zero local run reproduces production and does not drift.
> **Phase 2B therefore starts at `048`+**, unless a new canonical plan
> supersedes `PHASE2_CANONICAL_PLAN.md` §2. The `043`–`047` range named
> in §2's table below refers to the *old conflicting numbering schemes*
> that were reconciled, not to a reservation.

> **Update 2026-08-01 — A1 is RESOLVED.** The migration-ledger
> application method is approved: Supabase MCP `apply_migration` only,
> `supabase db push` forbidden. Every "A1 blocked / still open" statement
> below predates that and should be read as resolved. The **backup /
> restore gate is now the next blocker**, and production apply is still
> **not approved** — see `PHASE1_DEPLOYMENT_RUNBOOK.md`.

**Purpose:** the single document a fresh engineer reads to know whether
Phase 2 implementation can begin, and exactly what stands in the way if
not. Everything referenced here already exists in one of the five
companion documents produced in this pass — this checklist does not
introduce new analysis, it consolidates.

**State as of this pass:** 78 modified files, 42 migrations, branch
`phase1/fresh-migration-validation`, unchanged by this pass or the
canonicalization pass that followed it. Nothing has been committed,
pushed, or applied to production by either pass. This document,
`PHASE2_CANONICAL_PLAN.md`, and their companions are documentation-only
additions to the untracked file set — see the canonicalization pass's own
final answer for the exact file list and count.

> **Updated by the canonicalization pass.** A2 (migration numbering) and
> C4 (partitioning strategy) — the two decisions this document originally
> listed as blocking Phase 2A migration writing — are now **resolved**.
> See `PHASE2_CANONICAL_PLAN.md`. §8 below has the updated verdict.

---

## 1. Repository consistency

| Check | State |
|---|---|
| Working tree matches the last confirmed handoff | ✅ 78 modified, 42 migrations — unchanged by this pass |
| No stray `000_` test fixture in `supabase/migrations/` | ✅ confirmed absent |
| Branch is `phase1/fresh-migration-validation` | ✅ |
| No migration applied to production | ✅ — production used read-only this pass (live `SELECT`/`pg_indexes` queries only, verified in `PHASE2_ARCHITECTURE_REVIEW.md`) |

**Verdict: consistent.** Nothing about the repository's physical state
blocks Phase 2.

---

## 2. Document consistency

Full detail in `PHASE2_DOCUMENT_AUDIT.md`. **Updated by the
canonicalization pass** — most rows below moved from "flagged" to
"fixed":

| Category | Finding | Resolved by |
|---|---|---|
| Migration numbering | Three conflicting schemes for `043`–`047` | ✅ **Fixed.** `PHASE2_CANONICAL_PLAN.md` §2 is canonical; superseded banners added to `PHASE2_PLAN.md` and `PHASE2_IMPLEMENTATION_ROADMAP.md` §2.1 pointing to it |
| Table naming | `contact_handles` vs. `identity_handles` | ✅ `PHASE2_GLOSSARY.md` — `identity_handles` is canonical, confirmed unchanged by the canonicalization pass |
| Stale document | `PHASE2_PLAN.md` superseded in full, carried no notice | ✅ **Fixed.** Banner added at the top of the file itself |
| Stale claim | Brain "already multi-channel" oversold in `YALI_ARCHITECTURE_REVIEW.md`, corrected by live data in `PHASE2_ARCHITECTURE_REVIEW.md` | Not amended in the earlier document — out of scope for the canonicalization pass, which touched only the two documents named in its own instructions plus the partitioning line it directly resolved |
| Duplicate concepts | Two vector stores; `insight_review_queue` vs. `insights.status` | Still open (`PHASE2_ARCHITECTURE_DECISIONS.md` F1, E1) — out of scope for this pass |
| Duplicate concept | `identity_merge_log` vs. `timeline_events` merge events | ✅ **Resolved.** `PHASE2_CANONICAL_PLAN.md` §5 — pointer pattern, not two independent ledgers |

**Verdict: the two documents this pass was scoped to fix (`PHASE2_PLAN.md`,
`PHASE2_IMPLEMENTATION_ROADMAP.md`) now carry clear supersession notices,
and the canonical plan they point to is internally consistent.** Two
findings from the audit remain open by design — they weren't part of
this pass's task list and don't block Phase 2A.

---

## 3. Migration consistency

| Check | State |
|---|---|
| Migrations `001`–`042` | ✅ unchanged, verified 0 "channel" occurrences across all of them |
| Phase 2 migrations (`043`+) | **Still not written** — this and the canonicalization pass are documentation-only, per their own rules. The canonical order and content are now fully specified, ready to write from |
| A2 — migration numbering | ✅ **Decided.** `043`–`046`: `identity_handles → identity_evidence(+policy) → timeline_events(+types) → continuation_tokens`. FK-safe — `identity_merge_log` and the `contacts` alteration moved to Phase 2B, which is what caused the original non-executable order, not a reordering around it. See `PHASE2_CANONICAL_PLAN.md` §2 |
| C4 — partitioning decision for `timeline_events` | ✅ **Decided.** Unpartitioned at creation, for Laddoos-only scope — a revision of the earlier 100-brand-scale recommendation, justified by Phase 1's own "no multi-tenant scaffolding" locked decision. Composite primary key and composite `dedupe_key` unique constraint (both include `occurred_at`) keep a future conversion cheap without paying partitioning's cost now. Explicit revisit trigger: 5M rows or a second tenant onboarded, whichever first. See `PHASE2_CANONICAL_PLAN.md` §3 |

**Verdict: both migration-writing blockers are resolved.** The four
Phase 2A migration files can now be written from `PHASE2_CANONICAL_PLAN.md`
§2 without opening a second, conflicting document. Writing them is still
out of scope for this pass and the canonicalization pass, per both
passes' own explicit rules — resolved readiness is not the same as
having been done.

---

## 4. Outstanding architectural decisions

Full register in `PHASE2_ARCHITECTURE_DECISIONS.md` — **38 decisions**
across six categories (corrected count — the register's own summary
previously understated this at 25; recounted directly against the
register's entries during this canonicalization pass). Status breakdown,
updated for this pass's resolutions:

| Status | Count |
|---|---|
| **Blocked** (external dependency) | 1 (A1 — migration ledger) |
| **Open** (no recommendation exists yet) | 12 |
| **Recommended, unconfirmed** (a document proposes an answer; no sign-off) | 20 |
| **Decided** (settled and consistent across documents) | 5 (A2, A4, B4, B8, C4 — **A2, B8, and C4 newly resolved by this canonicalization pass**) |

Of the five that originally gated Phase 2A (`PHASE2_ARCHITECTURE_DECISIONS.md`
Summary, `PHASE2_SCOPE_REDUCTION.md` §2): **A2 and C4 are now resolved**
and no longer block anything. **A1** blocks production apply only, not
writing or local testing. **B1** blocks Phase 2B, not 2A. **A3** blocks
neither 2A, 2B, nor 2C — only the later Follow-up engine.

---

## 5. Known technical debt

Carried forward, not introduced by this pass:

1. **Two vector stores** (`crm.ai_knowledge_chunks`, `public.kb_chunks`) —
   named as debt in three separate documents, still unscheduled.
2. **Client-side identity resolution** — `contact-form.tsx` calls
   `findExistingContact` directly from the browser (verified `'use
   client'`); the one identity-policy path not enforced server-side.
3. **Delivery is at-most-once, not at-least-once** — `deliver.ts`'s
   documented design. Phase 2's `events_outbox` draining and any
   follow-up sending need stronger guarantees than exist today.
4. **No scheduler is provisioned anywhere in this deployment** —
   verified: no `vercel.json`, `docker.md` states "nothing inside the
   container is scheduled."
5. **Phase 1.1 generated-types adoption** — 58 pre-existing schema-
   contract mismatches, partially sequenced (steps 3 and 6) ahead of
   Phase 2A's contact-model rewrite; the rest deferred.
6. **`crm_workspace_id` naming inconsistency** — a Phase 1 column name
   that doesn't match its own convention (`account_id` elsewhere).
   Documented in the glossary; not scheduled for a fix, since renaming it
   is its own migration with its own risk, unrelated to Phase 2.

---

## 6. Known production blockers

Unchanged from Phase 1, restated here because Phase 2 cannot proceed past
them either:

1. Phase 1 changes still not committed, pushed, or PR'd.
2. Independent PR review of Phase 1 not completed.
3. **Shared migration-ledger method not approved** — blocks Phase 1's own
   deploy and now every Phase 2 migration too.
4. No real production backup created and referenced.
5. Restore procedure not verified.
6. `crm` not yet added to hosted PostgREST exposed schemas.
7. Deployment/rollback window not approved.
8. Pre-deployment re-confirmation step (no conflicting objects appeared in
   production) not yet performed.

---

## 7. Items safe to implement now

Work that can start immediately, requires no external decision, and
carries no risk to anything live:

- ~~Reconcile the migration-numbering conflict (A2)~~ — **done, this
  canonicalization pass.** See `PHASE2_CANONICAL_PLAN.md` §2.
- **Write and locally test `043`–`046`** — the four Phase 2A migration
  files, now fully specified in `PHASE2_CANONICAL_PLAN.md` §2–§3. Not
  done by this pass (documentation-only, per its own rules), but no
  longer blocked by an unresolved decision — only by nobody having
  written them yet.
- Local Supabase stack work (`npx supabase start`, `npm run
  db:test:reset`) against those migrations once written — nothing here
  touches production.
- Phase 1.1 steps 3 (Contacts) and 6 (Inbox) — already decided (A4),
  independent of every other open item.
- Web SDK design for meaningful-event capture (C7 — already recommended).

## Items blocked

- **Applying `043`–`046` to production** — blocked on A1 (ledger) and the
  eight Phase 1 production blockers in §6. **Writing and locally testing
  them is not blocked** — see §7 above.
- **Phase 2B's contact-model rewrite specifically** — additionally
  blocked on B1 (shared-phone force-merge), which is a brain-repo/product
  decision, not something this repo can resolve unilaterally.
- **Phase 2C (phone)** — additionally blocked on the brain-repo voice
  identity fix (§8 below); building it before that fix ships would
  reproduce the same "0 returning customers" failure the review measured.

## Required external decisions

Decisions this repo cannot make alone:

| Decision | Needs |
|---|---|
| ~~A1 — migration ledger method~~ | ✅ **Decided 2026-08-01** — MCP `apply_migration` only |
| B1 — one phone may back multiple people | Brain-repo owner + founder |
| B6 — shared-device re-verification timing | Founder/product |
| D2 — CTWA consent basis | Legal |
| E3 — one AI configuration or two | Founder + brain-repo coordination |
| F2 — tenancy unification (workspace vs. tenant/brand) | Founder (depends on whether YALI OS becomes multi-founder) |
| F3 — portfolio/multi-account aggregation | Founder (same dependency as F2) |
| Voice identity fix (LiveKit phone extraction) | Brain-repo engineering — not this repo's code |

---

## 8. Success criteria before writing the first Phase 2 migration

In order — each is a precondition for the next, not a parallel checklist.
**Updated by the canonicalization pass:**

1. ✅ **A2 resolved.** `043`–`046`, FK-topologically ordered, confirmed
   executable — `PHASE2_CANONICAL_PLAN.md` §2.
2. ✅ **C4 resolved.** Unpartitioned at creation, with a composite-key
   shape and an explicit revisit trigger — `PHASE2_CANONICAL_PLAN.md` §3.
3. **A1 resolved or explicitly waived for local-only work.** Still open.
   No migration reaches production without it; local `db:test:reset`
   work does not need to wait — this was already true before this pass
   and remains so.
4. **Phase 2A's scope is understood as `PHASE2_SCOPE_REDUCTION.md`
   defines it, with `PHASE2_CANONICAL_PLAN.md` as the migration-level
   detail** — Instagram→website→timeline only, four migrations, nothing
   else — by whoever implements it, so the original roadmap's bundled
   version is not accidentally built instead.
5. **Before Phase 2B specifically:** B1 answered. Still open.
6. **Before Phase 2C specifically:** the brain-repo voice identity fix
   verified — `SELECT count(*) FROM customers WHERE total_sessions > 1`
   returns greater than zero, executed and observed, not assumed. Still
   open.

**The one-sentence test for "are we ready":** *can a fresh engineer read
`PHASE2_CANONICAL_PLAN.md` alone and start writing `043_identity_handles.sql`
without opening any other document to resolve a contradiction?* **Today,
yes** — items 1 and 2 are resolved, and item 4 is exactly what the
canonical plan is for. Items 3, 5, and 6 don't block *writing* Phase 2A's
migrations; they block, respectively, *applying* them to production,
*starting Phase 2B*, and *starting Phase 2C*.
