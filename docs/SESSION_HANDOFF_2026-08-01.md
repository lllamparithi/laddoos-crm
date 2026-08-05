# Session Handoff — 2026-08-01

**Read this first in the new session.** This covers everything since
`SESSION_HANDOFF_2026-07-31.md` (Phase 1) — that document is now
historical background, not the starting point. Phase 2A is
schema-complete, backend-complete, SDK-complete, and has a **real,
verified, browser-driven proof** that it works end to end locally.

---

## Where things stand in one screen

```text
Repo             D:\Antigravity repo\laddoos-crm
Branch           phase1/fresh-migration-validation
Supabase (prod)  ugjishankutgfegplrgq   ← still untouched by any of this

Phase 1                Implementation complete, still uncommitted (unchanged)
Phase 2A schema        Migrations 043-046, verified twice from zero, 0 errors
Phase 2A backend        Repository + service + API layer, done
Phase 2A web SDK        Browser client, done
Phase 2A browser proof  Real Postgres rows confirmed via a real browser session
Commit / PR              NOT done. Nothing in this entire session has been
                          committed, pushed, or applied to production.
Production               Still BLOCKED — same items as Phase 1, plus A1/B1/
                          brain-voice-fix for Phase 2B/2C (see bottom)
```

```text
Modified files (Phase 1 baseline)   80   — unchanged all session, verify this first
Untracked entries                    57   — Phase 1's 42 + everything below
Migrations                           46   — 001-042 (Phase 1) + 043-046 (Phase 2A)
Local Supabase                       Up, healthy, reset to CLEAN state (0 rows)
Dev server                           Stopped
Full test suite                      799/799
typecheck / build                    Clean
```

**Do this first:**
```bash
git status --short | grep -c '^ M'   # expect 80
git branch --show-current             # expect phase1/fresh-migration-validation
ls supabase/migrations | wc -l        # expect 46
docker ps --filter "name=supabase_db_laddoos-crm"   # expect Up, healthy
```
If any of these differ, stop and work out why before continuing — same
rule as the original handoff.

---

## What happened this session, in order

This was one long continuous session covering the entire path from
"Phase 1 reviewed" to "Phase 2A proven in a real browser." Roughly:

1. **Architecture review** — `YALI_ARCHITECTURE_REVIEW.md`: judged Phase 1
   against the five-year YALI vision. Headline finding: the brain repo
   (`public` schema) is already multi-channel; `crm` has zero "channel"
   references across 42 migrations.
2. **Phase 2 identity/timeline design** — five detailed docs written once
   full scope was specified: `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md`,
   `PHASE2_UNIFIED_TIMELINE_SPEC.md`, `PHASE2_FOLLOWUP_POLICY_ENGINE.md`,
   `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md`, `PHASE2_IMPLEMENTATION_ROADMAP.md`.
3. **Independent review** — attempted to hand off to Codex CLI (not
   installed, blocked). A full independent review then appeared at
   `docs/PHASE2_ARCHITECTURE_REVIEW.md` **from an unknown source — this
   was never resolved** (see "Open question," below). Its live-database
   claims were independently re-verified and confirmed exact; an
   addendum was added rather than overwriting it.
4. **Canonicalization pass** — resolved the two decisions blocking
   migration-writing: **A2** (migration order) and **C4** (partitioning).
   Produced `PHASE2_CANONICAL_PLAN.md` (now the single source of truth
   for Phase 2A's migration order), plus `PHASE2_DOCUMENT_AUDIT.md`,
   `PHASE2_GLOSSARY.md`, `PHASE2_ARCHITECTURE_DECISIONS.md` (38-item
   register), `PHASE2_SCOPE_REDUCTION.md`, `PHASE2_CRM_ENTITY_REVIEW.md`,
   `PHASE2_READINESS_CHECKLIST.md`. Added supersession banners to the
   now-stale `PHASE2_PLAN.md` and parts of `PHASE2_IMPLEMENTATION_ROADMAP.md`.
5. **Migrations `043`-`046` written and verified** — `identity_handles`,
   `identity_evidence`(+policy), `timeline_events`(+types),
   `continuation_tokens`. Verified **twice**, independently, from a true
   zero reset, 0 errors both times. Real positive **and** negative RLS
   controls executed directly against Postgres (not asserted) —
   cross-account isolation, the append-only trigger, the composite-key
   partitioning-readiness design, idempotent dedupe, all confirmed live.
6. **Repository + service layer** — `src/lib/identity/`,
   `src/lib/timeline/`, `src/lib/continuation/`. 68 tests. Found and
   fixed 3 real bugs, all in test stubs, none in the implementation.
7. **API endpoints** — `POST /api/continuation-tokens`,
   `GET /api/continuation-tokens/resolve`, `POST /api/web-events`,
   `GET/POST /api/instagram/webhook` (explicitly an adapter stub — no
   `instagram_config` table exists). 30 tests.
8. **Web SDK** — `src/lib/web-sdk/` (`storage`, `identity`, `events`,
   `continuation`, `index`). 45 tests. `docs/PHASE2_WEB_SDK_INTEGRATION.md`
   is the integration guide.
9. **Real browser end-to-end proof** — `src/app/dev/phase2a-proof/`
   (dev-only, 404s in production). Driven through an actual browser
   session: found and fixed a **real bug** (`.env.local`'s
   `NEXT_PUBLIC_SUPABASE_URL` was still the literal placeholder, never
   configured — see "Environment gotcha" below), then confirmed via
   direct `psql` queries that **2 real rows landed in
   `crm.timeline_events`** and **`crm.messages` stayed at 0**. Reset to
   clean afterward.

Full session total: **799/799 tests passing**, typecheck clean, build
clean, `.env.local` never modified, 8 API/migration bugs found and fixed
along the way (all caught by executing things, none by static review —
same pattern as Phase 1).

---

## Open question — not resolved this session

`docs/PHASE2_ARCHITECTURE_REVIEW.md` existed on disk, fully written, with
live-database numbers already in it, **before** this session queried
those numbers itself. Nothing in this session produced it. It was
independently verified (every number re-checked live, all exact) and is
genuinely high quality — but its provenance was never established. You
asked to check; that check was never completed within this session.
Worth resolving before treating it as fully trusted going forward, even
though everything checkable in it has checked out.

---

## Hard rules carried forward (Phase 1's, still in force)

- Never `supabase db push` against production from this repo.
- Never apply a migration to production without the runbook's backup
  gate filled in.
- Migrations are `001`-`046` now, strictly ordered. **`047`+ is reserved
  for Phase 2B** (`identity_merge_log`, the `contacts.phone` nullable
  alteration, the `web_to_wa` token purpose) — not designed yet, see
  `PHASE2_CANONICAL_PLAN.md` §2.
- Every new function declares its own `REVOKE`/`GRANT`. No blanket grants.
- `crm.messages` never gains a `channel` column — decided, not open.
- `public` belongs to the brain repo. Never write to it from here.

## New rules from this session

- **`identity_handles` is the canonical table name** — never
  `contact_handles` (that name only ever existed in the now-superseded
  `PHASE2_PLAN.md`).
- **`timeline_events` primary key is composite `(id, occurred_at)`**, and
  its dedupe constraint is `(account_id, dedupe_key, occurred_at)` — both
  deliberate, for future partitioning readiness. A future table needing a
  hard FK to a specific event must reference both columns; a table that
  only needs to record an event id for display should store it with no
  FK at all (see `identity_evidence.source_event_id` for the pattern).
- **CTA-click tracking is deliberately not implemented.** No
  `web.cta_click` row exists in `crm.timeline_event_types` (045's seed is
  scoped to what Phase 2A actually writes). `trackCtaClick()` exists as a
  real, callable, tested stub that always returns `false` with a
  `console.warn` — do not wire it up without first deciding whether to
  seed a new event type (a small migration, a real decision) or
  deliberately reuse an existing one.
  > **Decided in the follow-up session:** stays disabled for Phase 2A;
  > seed `web.cta_click` inside Phase 2B's migration range rather than
  > spending the reserved `047`. Reusing an existing type is **rejected**.
  > See `PHASE2A_CTA_TAXONOMY_DECISION.md`.
- ~~**CORS is not implemented** on `/api/web-events` or
  `/api/continuation-tokens/resolve`.~~ **Superseded — CORS is now
  implemented** in the follow-up session (`src/lib/cors.ts`, per-route,
  allow-list from `YALI_WEB_SDK_ALLOWED_ORIGINS`, verified in a real
  cross-origin browser run with a negative control). Cross-domain
  browser integration works. See
  `PHASE2_WEB_SDK_INTEGRATION.md`'s CORS sections — in particular the
  one on what the allow-list does *not* do (it gates reads, not writes).
- **Continuation-token resolve failures are deliberately uniform** —
  malformed, wrong signature, unknown, expired, revoked, exhausted, wrong
  tenant, and even a server-side "signing key not configured" all
  collapse to the identical `{ ok: false }` / `{ present: true, resolved:
  false }`. Verified live in the browser proof, not just unit-tested.
  Never add a way to distinguish these on the wire.
- **`resolveSingleAccountWorkspaceContext()`
  (`src/lib/identity/workspace-context.ts`) fails loudly, not silently,
  if more than one `crm.accounts` row ever exists** — Phase 2A's
  anonymous endpoints (web-events, continuation-resolve, the Instagram
  adapter) assume single-tenancy on purpose. This is the first thing that
  will need real per-account routing if that assumption ever changes.

---

## Environment gotcha — read before running the app locally

**`.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` is still the literal
placeholder** (`your-project.supabase.co`) — confirmed this session,
never fixed (fixing it wasn't this session's call to make, and doing so
would be editing a file explicitly off-limits). Running `npm run dev`
normally will make every server-side Supabase call fail with `TypeError:
fetch failed`.

**Workaround used this session, safe to reuse — process-only env vars,
never written to any file:**

```bash
# Get the local stack's URL and keys — do not paste them into this doc.
npx supabase status          # prints API URL, anon key, service_role key

export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:55321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key from npx supabase status>"
export SUPABASE_SERVICE_ROLE_KEY="<service_role key from npx supabase status>"
export ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
export META_APP_SECRET="test-meta-app-secret"
npm run dev
```

> **The two key literals were removed from this block on 2026-08-05.** They
> were the Supabase CLI's fixed public demo JWTs — identical on every local
> Supabase install and not secret in any way (see the paragraph below, which
> is still accurate). They were replaced with `npx supabase status` purely so
> GitHub secret scanning does not raise a permanent false positive on this
> repository. Nothing about the workaround changed.

These are the Supabase CLI's fixed, publicly-documented local-dev demo
keys (identical for every developer running `supabase start`), not a
real secret. `CONTINUATION_TOKEN_SIGNING_KEY` was deliberately **not**
set this session — its absence is what proved the fail-closed behavior
works; set it the same way if a session needs the full signed-token
success path.

**`workspace_brand_map` is not seeded by default.** Every Phase 2A
anonymous endpoint needs one real account + one active mapping row to
exist first. The local DB is currently **empty** (0 accounts, 0
timeline_events — reset deliberately at the end of this session, not a
bug). See `docs/PHASE2_WEB_SDK_INTEGRATION.md`'s "Local end-to-end proof"
section for the exact seed SQL used.

**`.claude/launch.json` now exists at `D:\Antigravity repo\.claude\launch.json`**
(top level, not inside `laddoos-crm`) — configured as a `url`-only entry
that *attaches* to an already-running dev server rather than spawning
one. Spawning via `preview_start` hit a Windows path-quoting bug (the
space in `C:\Program Files\nodejs\`) that never got resolved — start the
dev server manually first (as above), then `preview_start` will attach
to it.

**A broad `taskkill /F /IM node.exe /T` was run once** mid-session to
clear a stuck dev server before switching to precise per-PID kills. If
anything Node-based on this machine was running outside this session at
that moment, it would have been stopped too — not verified either way.

---

## Document map (Phase 2)

| Doc | What it's for |
|---|---|
| **This file** | Start here |
| `PHASE2_CANONICAL_PLAN.md` | **The migration order and partitioning decision.** Authoritative for `043`-`046`; reserves `047`+ |
| `PHASE2_READINESS_CHECKLIST.md` | Consolidated go/no-go — decisions resolved vs. still open |
| `PHASE2_ARCHITECTURE_DECISIONS.md` | The full 38-item decision register |
| `PHASE2_SCOPE_REDUCTION.md` | Why/how 2A/2B/2C got split (IG→Web / →WhatsApp / →Phone) |
| `PHASE2_GLOSSARY.md` | Canonical names — `identity_handles` etc. |
| `PHASE2_DOCUMENT_AUDIT.md` | Every inconsistency found across the design docs |
| `PHASE2_CRM_ENTITY_REVIEW.md` | What Phase 2A must never duplicate from Phase 1's existing tables |
| `PHASE2_WEB_SDK_INTEGRATION.md` | The SDK's own API docs + how to run the local browser proof |
| `PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` | Full identity/confidence/token design detail |
| `PHASE2_UNIFIED_TIMELINE_SPEC.md` | Full timeline design detail |
| `PHASE2_FOLLOWUP_POLICY_ENGINE.md`, `PHASE2_FOUNDER_INTELLIGENCE_SPEC.md` | Designed, **not built** — Phase 2D+ |
| `PHASE2_ARCHITECTURE_REVIEW.md` | Independent review — see "Open question" above |
| `PHASE2_PLAN.md` | **Superseded in full** — historical only |
| `PHASE2_IMPLEMENTATION_ROADMAP.md` | **Partially superseded** — its §2.1 migration table is stale; the rest still holds |
| `CODEX_REVIEW_BRIEF.md` | The (never-completed) Codex handoff attempt |
| `YALI_ARCHITECTURE_REVIEW.md` | The five-year vision review that started all of this |

Phase 1 docs (`SESSION_HANDOFF_2026-07-31.md`, `PHASE1_REVIEW_REPORT.md`,
etc.) are unchanged and still accurate for Phase 1 specifically.

---

## What's next

Three genuinely different directions, same as the original handoff's
framing — pick one, they need different setups:

### A. Wire Phase 2A into the real product

Nothing built this session touches any actual page or the inbox. A real
integration needs: a decision on where the SDK script is served from
(same app vs. separate marketing site → reopens the CORS question), and
someone to actually call `initYaliWebSdk()` from a real page.

### B. Start Phase 2B (WhatsApp continuity)

Blocked on **B1** (the shared-phone customer-identity rule) — a
brain-repo/product decision, not an engineering one. `identity_merge_log`
and the `contacts.phone` nullable migration (`047`+) are designed
(`PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md`) but not written.

### C. Resolve a real blocker

- **A1** (shared migration ledger) — still blocks production, unchanged
  since Phase 1.
- **The Codex/`PHASE2_ARCHITECTURE_REVIEW.md` provenance question** above.
- **CORS decision** for cross-domain SDK use, if (A) is the direction.
- **CTA-click taxonomy decision** — seed `web.cta_click` or reuse an
  existing type.

---

## Suggested opening prompt for the new session

> Continuing Laddoos CRM Phase 2A at `D:\Antigravity repo\laddoos-crm`,
> branch `phase1/fresh-migration-validation`. Read
> `docs/SESSION_HANDOFF_2026-08-01.md` first, then
> `docs/PHASE2_CANONICAL_PLAN.md` and `docs/PHASE2_READINESS_CHECKLIST.md`.
> Confirm the working tree first (80 modified / 46 migrations / local
> Supabase healthy). Do not commit, push, or touch production without
> being asked.
>
> This session I want to: **[A: wire Phase 2A into a real page / B: start
> Phase 2B / C: resolve a specific blocker]**
