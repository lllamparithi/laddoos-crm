# Session Handoff & Review Brief — Architecture Review + Phase 2 Design

**For:** an independent reviewing agent (Codex), or any fresh session
**Repo:** `D:\Antigravity repo\laddoos-crm`, branch `phase1/fresh-migration-validation`
**Session date:** 2026-07-31 (second session of the day)
**Prior handoff:** `SESSION_HANDOFF_2026-07-31.md` covers the Phase 1 state this session started from

---

## 0. Why this matters

YALI is not aiming to become a better WhatsApp CRM. The target is a
customer lifecycle platform: one customer, one timeline, one founder
view, across every channel. The CRM is the operational surface on top of
that — not the thing itself. Full argument in `YALI_ARCHITECTURE_REVIEW.md`.

One interaction-model reference worth naming: **BlackBerry Hub**. Not its
UI — its principle. Every channel lands in one chronological stream,
against one customer, with one place to act. That's what
`PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §4 designs toward, and it's why the
channel icon is metadata, never a separate inbox.

And the actual point of all the identity-resolution rigor isn't proving
two contacts are the same person — it's giving the founder better
decisions, faster (`PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` §3). Judge the
identity design by whether it's the minimum rigor that payoff needs, not
as an end in itself.

How the pieces relate, using only what's actually specified — no new
layer beyond what's in the five `PHASE2_*` docs, just those components in
one picture:

```text
public (brain)              — the person, the knowledge base, voice/chat
      │  read-only, verified evidence only
identity_handles/evidence    — the relationships (who is who, how sure)
      │
timeline_events               — the facts (append-only, immutable)
      │
customer_summaries            — the interpretation (regenerable, cited)
      │
insights                      — the founder-facing aggregate (evidenced)
      │
Hub                            — the interface (one stream, all channels)
```

---

## 1. What this session produced

No code was written. No migration was written. Nothing was executed
against a database. **Eight documents, all design-stage.**

| Document | Lines | What it is |
|---|---|---|
| `YALI_ARCHITECTURE_REVIEW.md` | 214 | Phase 1 judged against a five-year product vision, not the CRM migration it was scoped as |
| `PHASE2_PLAN.md` | 241 | **First-pass** roadmap. Partially superseded — see §3 |
| `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` | 727 | Cross-channel identity: handles, confidence, tokens, merge/split, voice |
| `PHASE2_UNIFIED_TIMELINE_SPEC.md` | 441 | Append-only event model, taxonomy, late binding, retention |
| `PHASE2_FOLLOWUP_POLICY_ENGINE.md` | 366 | Consent, channel policy windows, nine send-time gates |
| `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` | 364 | Living customer summary + aggregate insights + Hub interface |
| `PHASE2_IMPLEMENTATION_ROADMAP.md` | 256 | Phase 2A slice, sequencing, consolidated decisions, risks |
| `CODEX_REVIEW_BRIEF.md` | this | Handoff + review brief |

### Session narrative

1. Confirmed the Phase 1 working tree intact (78 modified / 42 migrations).
2. Audited the CRM and brain schemas and wrote the architecture review.
3. Wrote a first-pass Phase 2 plan.
4. The user then specified a much larger Phase 2 scope — cross-channel
   identity resolution and the unified customer timeline — with a
   critical rule: *never assume two identities belong to the same
   customer without sufficient evidence.*
5. Re-audited (contacts, conversations, messages, automations, flows,
   webhooks, consent, attribution) and wrote the five detailed documents.

---

## 2. What we need from you

**Not a code-quality review.** Phase 1's code is already reviewed
(`PHASE1_REVIEW_REPORT.md`). We need the *architecture* pressure-tested
before any of it is built.

### Caveat you must factor in

> **None of the SQL in these documents has been executed.** It is
> illustrative design, not tested DDL. Constraint names, trigger
> behaviour, index choices and function bodies have not been run against
> Postgres. Treat every SQL block as a proposal that still needs a
> from-zero verification pass, in line with this project's standing rule:
> *execute, don't assert.*

---

## 3. Known problems in this document set — read first

Flagged deliberately rather than left for you to find.

### 3.1 Migration numbering conflict (real contradiction)

Two documents assign **different meanings to the same migration
numbers**:

| Number | `PHASE2_PLAN.md` (earlier) | `PHASE2_IMPLEMENTATION_ROADMAP.md` (later) |
|---|---|---|
| `043` | channel dimension on `crm.messages`/`conversations` | `timeline_events` |
| `044` | `crm.contact_handles` | `identity_handles` |
| `045` | identity bridge → `email_hash` | `identity_evidence` |
| `046`–`048` | — | merge log, contacts alter, continuation tokens |

The later roadmap reflects the fuller design and should be treated as
authoritative; `PHASE2_PLAN.md` has not been reconciled to it. **The
numbering must be unified before any migration is written.** Also note
the two docs use different table names for the same concept
(`contact_handles` vs `identity_handles`).

### 3.2 An unresolved gap between the two designs

`PHASE2_PLAN.md` stage 1 proposed adding a `channel` column to
`crm.messages` and `crm.conversations`. The five detailed documents put
channel on `timeline_events` instead and are silent on `crm.messages`.

**That leaves a genuine open question:** the existing inbox UI reads
`crm.messages`. For it to show "this message came from Instagram",
either

- (a) `crm.messages` also gains a `channel` column, or
- (b) the inbox migrates to reading `timeline_events`.

Neither is chosen anywhere. (a) is cheaper now and duplicates a concept;
(b) is architecturally cleaner and a much larger UI change. **We would
value your recommendation.**

### 3.3 Scope of the audit

The audit behind these documents read the migration files, the generated
`public` types, and the identity/webhook/dedupe code paths. It did
**not** exhaustively read all 78 modified files or the full dashboard UI.
Claims about the CRM's *data model* are well grounded; claims about UI
effort are estimates.

---

## 4. The two theses to attack

Everything rests on these. If either is wrong, large parts of the design
are wrong.

### Thesis A — the platform is the brain, not the CRM

> `public` (brain repo) is already multi-channel: `sessions.channel`,
> `realtime_turns`, `kb_chunks`, `customers.last_contact_channel`. `crm`
> has zero occurrences of "channel" across 42 migrations. Therefore the
> CRM should become the operations cockpit over the brain, not the
> unified platform itself.

Counter-arguments worth weighing: is it actually cheaper to add channels
to the CRM (which has the UI, team model and automations) than to
surface brain data in the CRM? Does making the brain the identity spine
worsen the two-repos-one-database coupling that is already production
blocker 3?

**A sharper framing of the same thesis, also worth evaluating:** instead
of a flat "CRM is cockpit, brain is platform," split ownership by
function — the CRM owns the **operational surface** (inbox, team,
pipelines); the brain owns **intelligence** (memory, persona, skills);
`timeline_events` owns **history**; `identity_handles`/`contacts` own
**relationships**; `customer_summaries`/`insights` own **decisions**. Tell
us whether this framing holds up better, or whether it's the same claim
at finer resolution.

### Thesis B — a continuation token proves attribution, not identity

> If Meera forwards a tracked link to her sister and the sister clicks
> first, a naive design binds the sister to Meera's contact. So token
> redemption yields `strong` **attribution** but only `probable`
> **identity**, and never auto-merges alone. WhatsApp's platform-attested
> `wa_id` is what later promotes it to `verified`.

This is the sharpest consequence of the critical rule. Is the
`probable`/`strong` split correct, or over-cautious to the point of being
useless in practice? Is there a case where it still merges wrongly?

---

## 5. Verify, don't trust

The design's factual premises are checkable in seconds. Please check them.

```bash
grep -ric "channel" supabase/migrations/ | grep -v ":0"
```

```bash
grep -n "channel" src/lib/supabase/types/public.generated.ts | head
```

```bash
grep -rn "findExistingContact" src --include=*.ts --include=*.tsx | grep -v test
```

```bash
grep -rin "opt_out\|consent\|campaign\|utm_" supabase/migrations/
```

```bash
sed -n '41,50p' supabase/migrations/001_initial_schema.sql
```

Expected: zero `channel` hits in the 42 CRM migrations; `channel` present
on the brain's `sessions` and `last_contact_channel` on `customers`;
exactly four non-test `findExistingContact` call sites; **zero** consent
or campaign hits in `crm`; `contacts.phone TEXT NOT NULL`.

Also worth reading directly, because the design claims to *generalize*
rather than invent: `supabase/migrations/040_phone_linkability_guard.sql`.
The claim is that it already implements the "never assume without
evidence" rule for phone — eligibility separate from normalization, fail
closed on ambiguity, no `ORDER BY … LIMIT 1` fallback. Confirm or reject
that reading.

---

## 6. Decisions needing a verdict

Ranked by what they block. A reasoned recommendation beats a list of
options.

| # | Decision | Blocks |
|---|---|---|
| 1 | **Migration ledger method** — two repos, one Supabase project, one `schema_migrations` ledger. Four options in `PHASE1_MIGRATION_LEDGER_COMPATIBILITY.md`, none selected | **All of Phase 1 deploy and all of Phase 2** |
| 2 | **Unify the migration numbering + table names** (§3.1) | any migration |
| 3 | **`crm.messages.channel` or inbox-reads-timeline?** (§3.2) | Phase 2A design |
| 4 | Handles in `crm` or `public`? (proposed `crm`) | Phase 2A.2 |
| 5 | Token signing key: global or per-tenant, rotation plan | Phase 2A.3 |
| 6 | Web visitor id: cookie vs localStorage vs both; consent-banner interaction | Phase 2A.3 |
| 7 | Does `probable` ever auto-promote by accumulation? (we recommend **no** — two probables should not equal a strong) | Phase 2A.4 |
| 8 | Phase 1.1 sequencing — do only steps 3 and 6 before 2A.2, or run it in full first? | Phase 2A.2 |
| 9 | Two vector stores (`crm.ai_knowledge_chunks` vs `public.kb_chunks`) — consolidate on the critical path or in parallel? | 2D/2G |
| 10 | Legal, not engineering: DPDP erasure scope, call-recording consent, CTWA consent basis | 2B / 2E / 2I |
| 11 | **Should `timeline_events` become the source of truth the inbox reads from, or stay a read-side projection over `crm.messages` + brain events?** Sharper form of the §3.2 gap — decide now or it recurs at every future channel | Phase 2A design, and every increment after |

Seventeen decisions are consolidated in
`PHASE2_IMPLEMENTATION_ROADMAP.md` §5; the ten above are the ones where
an outside opinion helps most.

---

## 7. Repo state — please don't change it

- **Nothing is committed.** 78 modified files, 35 untracked. All of Phase
  1 plus this session's eight documents, in the working tree deliberately.
- **Do not run** `git reset`, `git clean`, `git checkout -- .`,
  `git restore .`, or `git pull --rebase`. The working tree is the only copy.
- **Do not commit, push, or open a PR.**
- **Do not apply anything to production.** The Supabase project
  (`ugjishankutgfegplrgq`) is shared with the live brain app. No CRM
  migration has ever been applied to it. `supabase db push` is forbidden
  from this repo unconditionally.
- Local work is fine: `npx supabase start` (ports 55321–55323), then
  `npm run db:test:reset`.
- Migration count must remain **42**. If you see a `000_` fixture inside
  `supabase/migrations/`, a test run was interrupted — delete it.

---

## 8. Out of scope

- Code quality, style, test coverage — already reviewed.
- Re-litigating Phase 1 decisions recorded in `PHASE1_REVIEW_REPORT.md`
  §4. Disagree deliberately if warranted; they were decided with reasons.
- The five bugs found in Phase 1 — fixed and verified.
- Implementation. Nothing is to be built yet.

---

## 9. What a useful output looks like

1. **Verdicts on Thesis A and Thesis B** — agree, disagree, or
   agree-with-caveats.
2. **A recommendation on the ledger** (decision 1). It has blocked since
   Phase 1 and now gates an entire phase. We want a five-year answer, not
   a workaround.
3. **A call on §3.2** — `crm.messages.channel`, or migrate the inbox to
   the timeline.
4. **Any architectural limit or threat the design missed.** The identity
   doc lists twelve threats; we would rather learn about a thirteenth now
   than in production. Wrong-merge scenarios are the highest-value place
   to look.
5. **A judgement on whether Phase 2A is genuinely the smallest safe
   slice**, or still too large. Concretely: is bundling the WhatsApp
   merge (2A.2's identity-model change + 2A.4's handoff) into the same
   slice as Instagram→website→timeline (2A.1, 2A.3) correct — or should
   Instagram→website→timeline ship alone first, with the WhatsApp merge
   and later phone→timeline as separate follow-on slices? If it can be
   cut further without proving less, say so.
6. **Anything in the SQL that would fail on execution.** It has never
   been run.
7. **A stress test against reference products.** If Apple were building
   this, what would they cut? If Linear were building it, what would they
   remove? If HubSpot were rebuilding from scratch with today's
   constraints, what would they simply never build? Answers here are
   more valuable than a feature-completeness check.

---

## 10. Suggested opening prompt

> Review the Phase 2 architecture proposal in `D:\Antigravity repo\laddoos-crm`,
> branch `phase1/fresh-migration-validation`. Start with
> `docs/CODEX_REVIEW_BRIEF.md`, then the five `PHASE2_*.md` documents and
> `YALI_ARCHITECTURE_REVIEW.md`. Verify the premises with the commands in
> §5 rather than trusting the documents. Give verdicts on the two theses
> in §4 and the decisions in §6. Do not commit, push, apply migrations,
> or modify the working tree. Nothing is to be implemented.
