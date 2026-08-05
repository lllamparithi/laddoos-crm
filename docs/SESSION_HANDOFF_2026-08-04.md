# Session Handoff — 2026-08-04

**Read this first.** It supersedes `SESSION_HANDOFF_2026-08-01.md` as the
entry point. That file is still accurate for how Phase 2A was *built*;
this one covers what changed in production.

---

## The headline

**All 47 CRM migrations are applied to production. `crm` is live on the
Data API. Zero errors, zero rollbacks, no data lost.**

```text
Project            ugjishankutgfegplrgq — "Yali agentic chat Project"
                   Postgres 17.6.1.127, region ap-northeast-1, Free tier
Branch             phase1/fresh-migration-validation
Migrations         001-047, ALL APPLIED to production 2026-08-04
Local tree         80 modified / 64 untracked — NOTHING COMMITTED
crm schema         44 base tables, RLS on all of them
public schema      29 base tables — UNCHANGED throughout
Brain data         customers 21 / leads 62 / orders 0 — UNCHANGED
Realtime           crm.* only (6 tables), no public.*
PostgREST          exposed schemas: public, graphql_public, crm
App                NOT deployed. admin.laddoosdotcom.in does NOT resolve.
```

**Verify this before trusting it:**

```sql
SELECT count(*) FROM supabase_migrations.schema_migrations
WHERE name ~ '^0[0-4][0-9]_'
  AND name !~ 'product_demand|customers_extend|commerce_connections|realtime_turns';
-- expect 47
SELECT count(*) FROM information_schema.tables WHERE table_schema='crm';   -- 44
SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
  AND table_type='BASE TABLE';                                            -- 29
```

---

## What happened, in order

1. **Phase 2A CORS** — `src/lib/cors.ts`, applied per-route to the two
   anonymous endpoints only. Allow-list from
   `YALI_WEB_SDK_ALLOWED_ORIGINS`. Proven in a real cross-origin browser
   run *with a negative control*.
2. **Website SDK integration** — the CRM's web SDK vendored into
   `laddoos-website` at `src/lib/yali-web-sdk/`, mounted via
   `src/components/YaliTracking.tsx` in the root layout.
3. **A1 resolved** — migration method approved: MCP `apply_migration`
   only, `supabase db push` forbidden.
4. **Backup/restore gate** — manual `pg_dump` taken and restore-verified
   into a scratch container. Founder accepted an amended pass criterion.
5. **Production apply** — `001`–`046`, one file at a time, strict order.
6. **PostgREST exposure + audit** — `crm` added to exposed schemas, then
   a read-only audit which found a real hole.
7. **`047` security hotfix** — closed that hole same day.

---

## Three findings worth not relearning

### 1. The search_path trap (caught before the apply)

Every migration uses **unqualified** `CREATE TABLE` and relies on
`SET search_path = crm, public, extensions` at the top of the file. The
brain already owns a `public.messages` table. Had MCP not preserved that
`SET` across statements, `CREATE TABLE IF NOT EXISTS messages` would have
silently bound to the brain's table — no error, `IF NOT EXISTS` makes it
a no-op — and every later ALTER, index and FK would have attached to the
wrong table.

Verified safe with a zero-write probe (`SET search_path = pg_temp, …;
SELECT current_schema()`) **before** applying anything. Re-verify if the
apply mechanism ever changes. Do not delete those `SET` lines.

### 2. `claim_ai_reply_slot` was anon-callable (found and fixed)

The post-exposure audit found `crm.claim_ai_reply_slot(uuid, integer)` —
SECURITY DEFINER, mutating — executable by `anon` over PostgREST RPC.
`029` created it with a service_role grant but never revoked PostgreSQL's
default EXECUTE-to-PUBLIC; `031` re-granted service_role; `041`'s
enumerated revoke list omitted it.

The tell: calling it with a malformed UUID returned **`22P02`** (argument
parse error) rather than `42501` — meaning the caller was *authorised*.
That distinction is the whole diagnosis; a plain "it errored" would have
looked fine.

Fixed by `047`. Now returns `42501 permission denied` for both malformed
and well-formed arguments. `service_role` retained via its explicit
grant. Only `peek_invitation` remains anon-executable, as designed.

### 3. A restore test is only as good as its target

The first restore of the production dump into stock `postgres:17`
produced 23 errors, and they were **not** benign: `public.kb_chunks` (the
brain's knowledge base) failed to restore entirely, because stock
Postgres has no **pgvector**. The dump was never at fault. Re-running
against `pgvector/pgvector:pg17` restored it — 309 rows, `vector(1536)`
intact — and dropped errors to 3, all `supabase_vault` (Supabase-only,
and the table is empty).

Any future restore test must use a pgvector-capable image.

---

## Backup — the restore point for this apply

```text
C:\laddoos-backups\laddoos-prod-pre-migration-20260804T1321Z.dump
C:\laddoos-backups\SECOND-COPY-laddoos-prod-pre-migration-20260804T1321Z.dump
SHA-256  62b8ba011d3e46475aafb5376774b6e805dfd4701bbb3167a8b807a0af69e991
3,254,701 bytes each — byte-identical, both verified
```

⚠️ **Both copies are on the same disk in the same folder.** That guards
against deleting one file and nothing else. Move one somewhere
physically separate. Full evidence: `PHASE1_BACKUP_RESTORE_GATE.md`.

---

## Rollback, if it comes to that

Phase 1 is schema-isolated, so the footprint is narrow:

```sql
DROP SCHEMA IF EXISTS crm CASCADE;
DROP TRIGGER IF EXISTS on_auth_user_created_wacrm ON auth.users;  -- lives OUTSIDE crm
```

Then remove `crm` from Settings → API → Exposed schemas. Nothing in the
chain writes to `public`; the only `public` interaction is a read-only
`SELECT` on `public.customers` inside the identity-linking functions.
The dump above is the second line of defence if `public` or `auth` were
ever damaged.

---

## What is NOT done

| # | Item | Owner |
|---|---|---|
| 1 | **Deploy the CRM app** + DNS/TLS for `admin.laddoosdotcom.in` (does not resolve). Host undecided. Expect the Vercel-CLI path — Hobby blocks GitHub auto-deploy for this account. | Founder |
| 2 | **Seed `workspace_brand_map`** — runbook §6. Impossible until the first admin signs up (`crm.accounts` is empty). Without it `link_contact_to_customer()` silently no-ops and every Phase 2A anonymous endpoint returns "Service not configured". **Use the corrected 6a/6b/6c SQL** — the old `auth.uid()` version fails from the dashboard. | Founder |
| 3 | **Verify the `authenticated` RLS path with a real JWT.** Never tested — `auth.users` is empty, so no session exists. Conclusions so far rest on catalog inspection only. | Next session |
| 4 | CRM env: `YALI_WEB_SDK_ALLOWED_ORIGINS`, `CONTINUATION_TOKEN_SIGNING_KEY` | Founder |
| 5 | Website env: `NEXT_PUBLIC_YALI_CRM_API_BASE_URL` — **inlined at build time, so a rebuild is required**, including to roll it back | Founder |
| 6 | Move one backup copy off-disk | Founder |
| 7 | **Commit + PR review** — nothing is committed in either repo | Founder |
| 8 | ~~`PHASE2_CANONICAL_PLAN.md` §2 says `047`+ is reserved for Phase 2B.~~ ✅ **Done 2026-08-05.** §2 now reserves `048`+; the same stale claim was also corrected in `PHASE2A_CTA_TAXONOMY_DECISION.md`, and `047`'s applied-in-production status was written into the runbook, backup gate, readiness checklist and `CLAUDE.md`. | Done |

---

## Rules still in force

- **Never `supabase db push` against production.** MCP `apply_migration`
  only (A1).
- **Never apply `000_public_schema_fixture.sql`** — local test stub only.
- `public` belongs to the brain repo. Never write to it from here.
- `crm.messages` never gains a `channel` column.
- `identity_handles` is the canonical name, never `contact_handles`.
- `timeline_events` PK is composite `(id, occurred_at)` — a bare
  `REFERENCES timeline_events(id)` FK is invalid. Use a composite FK, or
  store the UUID with no FK.
- Every new function declares its own `REVOKE`/`GRANT`. Never a blanket
  `GRANT ... ON ALL FUNCTIONS` — that is exactly how `047` happened.
- **CTA tracking stays disabled** — `trackCtaClick()` returns `false`.
  See `PHASE2A_CTA_TAXONOMY_DECISION.md`. Do not enable it by pointing it
  at an existing event type.
- Do not commit, push, or deploy without being asked.

---

## Still blocking later phases

- **B1** (one phone backing multiple people) — brain-repo/product
  decision. Blocks Phase 2B.
- **Brain-repo voice identity fix** — blocks Phase 2C. Gate:
  `SELECT count(*) FROM customers WHERE total_sessions > 1` returns > 0,
  executed and observed.

---

## Companion repo

`D:\Antigravity repo\laddoos-website` — SDK integration complete and
locally proven, **uncommitted**. Vendored SDK is byte-identical to the
CRM's except two documented edits (see its `VENDORED.md`). Product-view
tracking has no call site by design: the storefront is a separate Comez
store and `/product/*` is 308-redirected there.
