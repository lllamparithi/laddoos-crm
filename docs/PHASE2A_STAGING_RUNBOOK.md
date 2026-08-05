# Phase 2A — Staging Runbook: website → CRM tracking

**Scope:** getting browser page views from the Laddoos marketing website
into `crm.timeline_events`, through the CRM/admin app acting as the
gateway. Website page views and `?yali_ref=` continuation only. No
WhatsApp, no phone/voice, no inbox UI, no CTA clicks.

**Two repos:**

| Repo | Role |
|---|---|
| `D:\Antigravity repo\laddoos-website` | The public site. Owns *nothing* — it only calls the gateway. |
| `D:\Antigravity repo\laddoos-crm` | **The gateway.** Owns identity, timeline, and continuation logic, and is the only thing that writes to Postgres. |

---

## ⛔ STAGING PERMITTED: NO — the database is ready, the gateway is not deployed

> **Corrected 2026-08-05.** This section previously said migrations had
> **never been applied to production** and that the backup/restore gate
> was the next blocker. Both were true when written and are now false.
> **The entire database half of this chain is done.** The blocker moved
> to app deploy + DNS.

Checked live 2026-08-05, not assumed:

```text
Resolve-DnsName admin.laddoosdotcom.in   →  NXDOMAIN / no record
```

```sql
-- read-only, against ugjishankutgfegplrgq
crm_ledger_rows        47
last_crm_migration     047_revoke_claim_ai_reply_slot_public
crm base tables        44
public base tables     29        -- unchanged, brain-owned
anon EXECUTE on crm.claim_ai_reply_slot          false
service_role EXECUTE on crm.claim_ai_reply_slot  true
```

**`admin.laddoosdotcom.in` still has no DNS record.** The website is
live; the gateway is not. Current production state, from
`PHASE1_DEPLOYMENT_RUNBOOK.md` and `SESSION_HANDOFF_2026-08-04.md`:

- ✅ **Migrations `001`–`047` ARE applied to production** (2026-08-04, via
  MCP `apply_migration`, zero errors). `crm.timeline_events` exists.
- ✅ **`crm` IS exposed in PostgREST.** Anon table reads all return
  `42501`, audited live.
- ✅ **`047_revoke_claim_ai_reply_slot_public` is applied** — the security
  hotfix from the post-exposure audit, which found
  `crm.claim_ai_reply_slot` executable by `anon` over RPC. Closed same
  day. It also took the number `PHASE2_CANONICAL_PLAN.md` §2 had reserved
  for Phase 2B, so **Phase 2B starts at `048`+**.
- ⛔ **The CRM app is still not deployed anywhere.**
- ⛔ `crm.accounts` is empty, so `crm.workspace_brand_map` cannot be
  seeded yet.

> ### 🚫 DO NOT RE-APPLY MIGRATIONS
> All 47 are already in the shared ledger. Re-running the chain against
> `ugjishankutgfegplrgq` is not a no-op you can shrug at — it fights the
> brain repo over one ledger. **Never `supabase db push`.** If you think
> production is missing a migration, query
> `supabase_migrations.schema_migrations` and prove it first.

So there is still nothing to point the website at — but for a different
reason than before. Setting `NEXT_PUBLIC_YALI_CRM_API_BASE_URL` today
would produce a site that fires requests at a hostname that does not
resolve — harmless (every call resolves to `false`, see "Failure
behaviour"), but pointless.

**The website side is the LAST step of this sequence, not the first.**

### Prerequisite chain, in order

| # | Step | Owner | Status |
|---|---|---|---|
| 1 | ~~Resolve **A1**~~ — method approved 2026-08-01: MCP `apply_migration` only | Brain-repo owner + founder | ✅ **RESOLVED** |
| 2 | ~~Production backup created, reference recorded, restore **tested**~~ | Founder | ✅ **SATISFIED 2026-08-04** — `PHASE1_BACKUP_RESTORE_GATE.md` |
| 3 | ~~Apply migrations `001`–`047` to production via MCP `apply_migration`~~ | CRM | ✅ **APPLIED 2026-08-04**, 0 errors. **Do not re-apply.** |
| 4 | ~~Add `crm` to the hosted PostgREST exposed schemas~~ | Founder | ✅ **DONE 2026-08-04**, then audited — which produced `047` |
| 5 | **Deploy the CRM app and point `admin.laddoosdotcom.in` at it** (DNS A/CNAME + TLS) | Founder | **← NEXT BLOCKER** |
| 6 | First admin signup, then seed one `crm.accounts` row + one active `crm.workspace_brand_map` row | Founder | Blocked by 5 — use `PHASE1_DEPLOYMENT_RUNBOOK.md` §6's **corrected 6a/6b/6c SQL**; the old `auth.uid()` version fails from the dashboard |
| 7 | Verify the `authenticated` RLS path with a real admin session | CRM | Blocked by 6 — **never tested**; `auth.users` is empty, so every conclusion so far rests on catalog inspection only |
| 8 | Set the CRM env vars below, redeploy the CRM | Founder | Blocked by 5 |
| 9 | Set the website env var below, **rebuild and redeploy the website** | Founder | Blocked by 8 |

Steps 1–4 are done. **Step 5 is where work resumes**, and steps 5–9 are
what this runbook covers. Note step 7: nothing has ever exercised RLS as
a logged-in user, so treat the first admin session as a test, not a
formality.

---

## 1. How a page view actually flows

```text
visitor's browser
  │  loads https://laddoosdotcom.in/
  │
  ├─ src/app/layout.tsx renders <YaliTracking /> (renders nothing)
  │     └─ src/lib/yali-web-sdk  →  initYaliWebSdk({ apiBaseUrl })
  │
  ├─ reads/creates yali_visitor_id  (localStorage,   long-lived)
  ├─ reads/creates yali_session_id  (sessionStorage, per tab)
  │
  ├─ OPTIONS https://admin.laddoosdotcom.in/api/web-events      ← CORS preflight
  │     └─ 204 + Access-Control-Allow-Origin: https://laddoosdotcom.in
  │
  └─ POST    https://admin.laddoosdotcom.in/api/web-events      ← the actual call
        { event_type: "web.page_view", web_visitor_id, web_session_id,
          summary: "Viewed /", dedupe_suffix }
              │
              ▼
        CRM route (the gateway — the ONLY thing that touches Postgres)
          ├─ per-IP rate limit (120/min)
          ├─ resolveSingleAccountWorkspaceContext() → accountId/tenantId/brandId
          ├─ recordIdentityHandle()  → crm.identity_handles (sha256 of visitor id)
          ├─ recordWebEvent()        → crm.timeline_events
          └─ 201 { ok: true }        ← no internal row ids on the wire
```

**The gateway domain is `admin.laddoosdotcom.in`.** The website never
holds Supabase credentials, never opens a DB connection, and never
decides identity. It sends an anonymous visitor id and a path; the CRM
decides everything else.

`?yali_ref=` follows the same shape via
`GET /api/continuation-tokens/resolve?ref=…`, once per page load.

### What is deliberately not wired

- **CTA clicks** — `trackCtaClick()` is a stub that always returns
  `false`. No `web.cta_click` row exists in `crm.timeline_event_types`, so
  the write would be rejected by a foreign key. See
  `PHASE2A_CTA_TAXONOMY_DECISION.md`. Do not enable it for staging.
- **Product views** — `trackProductView()` is available but has no call
  site: the website has no product pages (the storefront is the separate
  Comez store on `shop.laddoosdotcom.in`, and the website's
  `next.config.ts` 308-redirects `/product/*` there).

---

## 2. Env vars — exactly what goes where

### Website (`laddoos-website`, Vercel project `laddoos-website`)

```bash
NEXT_PUBLIC_YALI_CRM_API_BASE_URL=https://admin.laddoosdotcom.in
```

- Origin only. **No trailing slash, no path** — the SDK builds
  `` `${base}/api/web-events` `` by plain concatenation, so a trailing
  slash yields `//api/web-events`.
- Not a secret. It is a public API base and is inlined into the client
  bundle by design.
- **`NEXT_PUBLIC_*` is baked in at BUILD time.** Setting or changing it in
  the Vercel dashboard does nothing until the site is rebuilt and
  redeployed. This matters most for rollback — see §6.
- Leaving it unset/blank disables tracking entirely and is the safe
  default.

### CRM (`laddoos-crm`, wherever the admin app is deployed)

```bash
YALI_WEB_SDK_ALLOWED_ORIGINS=https://laddoosdotcom.in,https://www.laddoosdotcom.in
CONTINUATION_TOKEN_SIGNING_KEY=<64 hex chars — generate, never reuse another key>
```

- **Both website origins must be listed.** Subdomains are not implied:
  `https://laddoosdotcom.in` does **not** allow `https://www.laddoosdotcom.in`.
  The site serves on both.
- Scheme matters. `https://` only in staging/production.
- Read per request, so a change takes effect on the CRM's next request —
  no rebuild needed on this side (unlike the website).
- `CONTINUATION_TOKEN_SIGNING_KEY`: generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  Required only for `?yali_ref=`; page views work without it. Unset, the
  resolve endpoint fails closed with a 500 "Service not configured" — it
  never silently accepts an unsigned ref.

Plus the CRM's existing Supabase/app vars, unchanged by Phase 2A.

---

## 3. Verifying `crm.timeline_events`

Rows land in the shared Supabase project's `crm` schema. Read-only checks:

```sql
-- Did anything arrive at all, and what does it look like?
select occurred_at, event_type, channel, summary
from crm.timeline_events
where event_type = 'web.page_view'
order by occurred_at desc
limit 20;
```

Expect `summary` values of the form `Viewed /` and
`Viewed /policies/privacy-policy` — the **path**, not the page title (the
integration passes `path` deliberately; the homepage's title is the long
site title and would make every row read identically).

```sql
-- One stable visitor across repeat visits, not a new one per page load.
select handle_type, channel, count(*)
from crm.identity_handles
group by 1, 2;
```

`web_visitor_id` / `web` should grow far slower than the event count. One
browser that visits five pages is **1 handle, 5 events**. If handles track
events 1:1, `localStorage` is being cleared or blocked — check for an
extension or private-browsing session before assuming a bug.

```sql
-- Freshness — is traffic flowing right now?
select max(occurred_at) from crm.timeline_events where channel = 'web';
```

Verify via the Supabase SQL editor or the MCP `execute_sql` tool. Locally:

```bash
docker exec supabase_db_laddoos-crm psql -U postgres -d postgres \
  -c "select event_type, channel, summary from crm.timeline_events order by occurred_at;"
```

---

## 4. Confirming `crm.messages` is unchanged

Phase 2A writes web activity to `crm.timeline_events` **only**.
`crm.messages` is WhatsApp/inbox territory and this integration must never
touch it. This is the single sharpest regression check.

```sql
-- Record this number BEFORE enabling the website env var.
select count(*) as messages_before from crm.messages;
```

```sql
-- After a staging soak, it must be identical (or changed only by real
-- WhatsApp traffic in the same window — check the timestamps).
select count(*) as messages_after from crm.messages;

select max(created_at) from crm.messages;   -- must predate the rollout, if idle
```

Locally the equivalent is `select count(*) from crm.messages;` — it stayed
`0` across every local proof run.

**If `crm.messages` grows from website traffic, roll back immediately
(§6)** — it means something is writing far outside Phase 2A's scope.

---

## 5. Testing `?yali_ref=`

`?yali_ref=` is the Instagram→website continuation link. Requires
`CONTINUATION_TOKEN_SIGNING_KEY` on the CRM.

**Test with a deliberately invalid ref first** — nothing needs minting, and
it exercises the whole path:

1. Open `https://laddoosdotcom.in/?yali_ref=v1.bogus.testref`.
2. **The param must be gone from the address bar** once the page settles —
   the SDK strips it with `history.replaceState` so the token isn't left
   in a copyable URL or leaked in a `Referer` header. URL should read
   `https://laddoosdotcom.in/`.
3. In devtools → Network, expect
   `GET …/api/continuation-tokens/resolve?ref=v1.bogus.testref` → **404**
   with `{"ok":false}`.
4. The page must render completely normally. A failed resolve is a no-op.

**A 404 here is the correct, expected result for a bogus ref.** Every
failure reason — malformed, bad signature, unknown, expired, revoked,
exhausted, wrong tenant — returns the identical `{ ok: false }` on
purpose, so the endpoint can't be used to probe which refs are nearly
valid. Do not "improve" this by distinguishing them.

If instead you see a **500**, `CONTINUATION_TOKEN_SIGNING_KEY` is unset on
the CRM. If you see a **CORS error**, the origin is missing from
`YALI_WEB_SDK_ALLOWED_ORIGINS`.

A real end-to-end test needs a genuinely minted token from
`POST /api/continuation-tokens` (authenticated, CRM-side) — out of scope
until the gateway is deployed.

---

## 6. Rollback

Two paths. They differ in speed and in what they actually stop — pick
deliberately.

### 6a. CRM-side kill switch — fast, no website rebuild ✅ preferred in an incident

Remove the website origins from `YALI_WEB_SDK_ALLOWED_ORIGINS` on the CRM
(set it blank) and redeploy/restart the CRM.

- The preflight then returns **403**, so the browser **never sends the
  POST** and no row is written.
- Effective on the CRM's next request — but browsers cache a successful
  preflight for `Access-Control-Max-Age`, **10 minutes**. Already-open
  pages holding a cached preflight keep writing until it expires. Plan for
  a ≤10-minute tail, measured, not guessed.
- Caveat: `GET /api/continuation-tokens/resolve` is a *simple* request and
  does not preflight, so it will still be sent (and its response merely
  blocked from being read). That path only fires on URLs carrying
  `?yali_ref=`.

### 6b. Website-side disable — complete, but requires a rebuild

Unset (or blank) `NEXT_PUBLIC_YALI_CRM_API_BASE_URL` on the website's
Vercel project, then **rebuild and redeploy**.

`YaliTracking` becomes a no-op: no SDK init, no requests of any kind, no
console noise beyond one dev-only line. Verified locally — the row count
did not move across a full page load with the var unset.

> **`NEXT_PUBLIC_*` is inlined at build time.** Removing the variable in
> the Vercel dashboard without redeploying changes nothing — the old value
> is still compiled into the JS bundle being served. Confirm the rollback
> actually landed:
>
> ```bash
> curl -s https://laddoosdotcom.in/ | grep -o '_next/static/chunks/[^"]*\.js' | head
> # then fetch a chunk and confirm the CRM hostname is absent:
> curl -s https://laddoosdotcom.in/_next/static/chunks/<chunk>.js | grep -c "admin.laddoosdotcom.in"
> # 0 = rollback is real
> ```
>
> This repo has hit exactly this class of mistake before — see the
> website's own CLAUDE.md note about verifying a baked-in
> `NEXT_PUBLIC_YALI_BASE_URL` by grepping the deployed bundle.

### 6c. What neither rollback undoes

Rows already written to `crm.timeline_events` stay. They are append-only
by design (an `UPDATE`/`DELETE` trigger blocks mutation). Deleting them is
a deliberate DB operation, not part of a rollback.

---

## 7. Failure behaviour — what a visitor sees when this breaks

Nothing. Verified by killing the CRM mid-session locally: a raw `fetch`
to the dead gateway threw a `TypeError`, while the page rendered fully
with **zero console errors** and no error UI. Every failure path — gateway
down, DNS unresolvable, CORS blocked, non-2xx, malformed body, storage
blocked in private browsing — resolves to `false` inside the SDK and is
swallowed.

There is deliberately no user-facing error state. A tracking call that
fails is not something a visitor buying laddoos should learn about.

---

## 8. Staging sign-off checklist

```text
[x] A1 resolved; migrations 001-047 applied to production  (2026-08-04)
[x] crm added to hosted PostgREST exposed schemas          (2026-08-04)
[x] 047 security hotfix applied; anon EXECUTE on
    crm.claim_ai_reply_slot returns false                  (re-verified 2026-08-05)
[ ] CRM deployed; admin.laddoosdotcom.in resolves and serves it over TLS
[ ] First admin signed up (crm.accounts non-empty)
[ ] One crm.accounts row + one active crm.workspace_brand_map row exist
    — runbook §6, corrected 6a/6b/6c SQL
[ ] `authenticated` RLS verified with a real admin session (NEVER tested)
[ ] CRM: YALI_WEB_SDK_ALLOWED_ORIGINS set to BOTH website origins
[ ] CRM: CONTINUATION_TOKEN_SIGNING_KEY set
[ ] Baseline recorded: select count(*) from crm.messages
[ ] Website: NEXT_PUBLIC_YALI_CRM_API_BASE_URL set, site REBUILT + redeployed
[ ] Preflight check: OPTIONS .../api/web-events from the site origin -> 204
[ ] Load the homepage; crm.timeline_events gains one 'Viewed /' row
[ ] Load a policy page;  crm.timeline_events gains 'Viewed /policies/...'
[ ] Handle count grows slower than event count (1 browser = 1 handle)
[ ] crm.messages count UNCHANGED from the baseline
[ ] ?yali_ref=v1.bogus.testref -> param stripped from URL, resolve 404
[ ] Site renders normally with no console errors on a production build
[ ] Rollback rehearsed at least once (6a preferred), and verified
```

Do not tick a box you have not executed. A green checklist that was
reasoned about rather than run is exactly the failure mode Phase 1's five
bugs came from.
