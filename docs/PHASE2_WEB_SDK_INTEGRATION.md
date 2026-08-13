# Phase 2A — Web SDK Integration Guide

**What this is:** the browser-side client for `POST /api/web-events` and
`GET /api/continuation-tokens/resolve`. Lives at `src/lib/web-sdk/` in
this repo. Not yet wired into any actual page — this is the library and
its proof that it works, not a deployed script tag.

**Read alongside:** `docs/PHASE2_CANONICAL_PLAN.md` (scope),
`src/app/api/web-events/route.ts` and
`src/app/api/continuation-tokens/resolve/route.ts` (what the server
actually accepts/returns).

---

## Quick start

```ts
import { initYaliWebSdk } from '@/lib/web-sdk'

const yali = initYaliWebSdk()

// On every page load:
await yali.resolveContinuationFromUrl() // no-op if there's no ?yali_ref= in the URL
await yali.trackPageView({ path: window.location.pathname, title: document.title })

// On a product page:
await yali.trackProductView({ productId: 'sku-123', productName: 'Millet Laddoo' })
```

Nothing here runs automatically on import — call `initYaliWebSdk()` and
its methods explicitly, wherever the website's own page-load code lives.

---

## Cross-origin (CORS) — supported, allow-list only

**Cross-domain browser integration works.** Both anonymous Phase 2A
endpoints send `Access-Control-Allow-Origin` for allow-listed origins
and answer the `OPTIONS` preflight:

| Endpoint | Preflights? | Why |
|---|---|---|
| `POST /api/web-events` | **Yes** | The SDK sends `Content-Type: application/json`, which makes it a non-simple request |
| `GET /api/continuation-tokens/resolve` | **Yes** | Sends the `x-yali-visitor-id` header, which makes it a non-simple request. The header is on the fixed `Access-Control-Allow-Headers` list in `src/lib/cors.ts`; without it the browser drops the header and identity linking silently stops |

Implementation: `src/lib/cors.ts`, applied **per route**, never in
middleware. `src/middleware.ts` matches every `/api/*` path, and a
path-prefix rule there is how CORS leaks onto a sibling that should
never have had it — this app already has that shape in the wild
(`/api/invitations/[token]/peek` is anonymous, its `/redeem` sibling is
authenticated).

**No other route in this app has CORS.** Not `/api/v1/*` (API-key), not
the cookie-session dashboard routes, not the WhatsApp or Instagram
webhooks. Don't add it to them.

### Configuration

```bash
# Comma-separated full origins: scheme + host + port.
YALI_WEB_SDK_ALLOWED_ORIGINS=https://laddoos.com,https://www.laddoos.com
```

| Environment | Value |
|---|---|
| Local, same-origin only | leave unset — same-origin never needs it |
| Local, driving the cross-origin proof | `http://127.0.0.1:3000,http://localhost:3000` |
| Staging | `https://staging.laddoos.com` |
| Production | `https://laddoos.com,https://www.laddoos.com` |

- **Never `*`.** The allowed origin is reflected back exactly, and only
  after an exact match against the list.
- **Unset or empty = no cross-origin caller is allowed.** Fail-closed by
  default.
- **The CRM's own origin never needs to be listed.** Browsers don't
  apply CORS to same-origin requests.
- Trailing slashes and host casing are normalised
  (`https://Laddoos.com/` ≡ `https://laddoos.com`). A bare hostname
  (`laddoos.com`, no scheme) is **not** a valid origin — it's dropped
  silently and therefore won't be allowed. This is the most likely
  misconfiguration; check it first when a cross-origin call fails.
- Ports are part of the origin: `http://localhost:3000` and
  `http://127.0.0.1:3000` are different origins, and so are
  `https://laddoos.com` and `https://laddoos.com:8443`.
- Subdomains are **not** implied. `https://laddoos.com` does not allow
  `https://www.laddoos.com`; list both.

### What a disallowed origin gets — and why it isn't a 403

A request from an origin that isn't allow-listed is **processed
normally but receives no `Access-Control-Allow-Origin` header.** The
browser then refuses to hand the response to the calling page. That is
the fail-closed enforcement — CORS is browser-enforced, and a response
with no ACAO is unreadable cross-origin.

It is deliberately *not* a 403, because **browsers send an `Origin`
header on same-origin POSTs too.** Rejecting on "Origin present and not
allow-listed" would break this app's own same-origin calls unless the
CRM's production origin were also added to the env var in every
environment — one forgotten variable away from breaking a working path
in production. The current design has no such failure mode.

The `OPTIONS` preflight *does* return a hard **403** for a disallowed
origin. That's safe there: these routes have no legitimate same-origin
OPTIONS traffic, so a rejected preflight is always cross-origin, and a
visible 403 in devtools beats debugging a silently absent header.

`Vary: Origin` is set on every response, allowed or not, so no cache can
serve one origin's answer to another.

### What the allow-list does NOT do — read this before relying on it

**CORS controls who can *read* a response. It does not gate *writes*.**
This was measured, not assumed, and it has two concrete consequences:

1. **A non-browser caller ignores CORS entirely.** `curl`, a server-side
   fetch, or any script that isn't a browser can `POST /api/web-events`
   with any `Origin` — or none — and get a `201`. Verified. That is not
   a CORS bug: `/api/web-events` is *anonymous by design* (see its own
   header comment), so it was always open to any caller. The real abuse
   control is the per-IP rate limit (`webEventIngest`, 120/min), not the
   origin allow-list.

2. **A browser with a cached preflight can still deliver a write for up
   to `Access-Control-Max-Age` (10 min) after its origin is removed from
   the allow-list.** Observed during the negative control: after
   removing the origin and restarting, the preflight correctly returned
   403 to a fresh caller, but the already-open page — holding a cached
   204 from before the change — skipped re-preflighting, sent the POST,
   the server processed it (writing a real `timeline_events` row), and
   the browser blocked only the *response*. So an origin removal is
   fully effective within 10 minutes, not instantly.

Neither is a reason to switch to rejecting disallowed origins outright —
that breaks same-origin POSTs, as explained above, and it still wouldn't
stop a non-browser caller. The correct mental model is: **the allow-list
decides which websites can use the SDK and read its results; the rate
limit decides how much anyone can write.** If write authorisation ever
genuinely matters for this endpoint, it needs a real credential, not a
CORS header.

### Credentials

## Identity binding on continuation-token first use

The SDK sends its existing anonymous visitor id in the **`x-yali-visitor-id`
header** — never the query string, because query strings land in server access
logs, browser history, and `Referer` headers sent to third parties.

On the **first** successful use of a token, and only when every guard passes,
the server links that visitor's existing `identity_handles` row to the token's
originating Contact at `strong` confidence, recording
`continuation_token_first_use` evidence (both values come from the
`identity_evidence_policy` allow-list, not from application code).

Every guard is a **silent no-op, never an error**: first use only,
`binds_identity` true, an origin contact exists, the visitor header is present,
a matching handle exists **within the token's account**, the handle has no
existing `contact_id`, and its confidence is neither `verified` nor `rejected`
— both of which mean a human already decided.

Two things this deliberately never does:

- **It never creates a handle.** `POST /api/web-events` remains the sole owner
  of visitor-handle creation. If the visitor has never hit that endpoint, there
  is nothing to link and the resolve simply succeeds without binding.
- **It never writes `timeline_events`.** The Contact Timeline reads through
  `handle_id`, so one handle update surfaces that visitor's whole history —
  past and future — with no backfill.

The response is byte-identical whether or not a link happened, and no longer
returns `origin_contact_id` or `origin_handle_id`. An anonymous caller cannot
learn whether a handle exists, whether it was already linked, or why not.

The confidence ceiling is `strong`, never `verified`: possession of a forwarded
link is not proof of identity, and a shared device would otherwise bind the
wrong person. `verified` stays reserved for an explicit human decision.


`Access-Control-Allow-Credentials` is **not** sent, and the SDK sends no
cookies (fetch's default `credentials: 'same-origin'`). These endpoints
authenticate nothing — `/api/web-events` is anonymous by design and
`/continuation-tokens/resolve` is gated by the token's own HMAC. A
reflected-origin ACAO combined with ACAC is the classic cross-origin
credential footgun; read `src/lib/cors.ts`'s header comment before
changing this.

### Error responses are readable cross-origin

Every response carries the CORS headers, including the ones returned
*before* the handler body runs — notably the rate limiter's **429**. A
429 without ACAO reaches the browser as an opaque CORS failure rather
than a rate-limit signal, so the SDK could never tell "slow down" from
"blocked." Covered by test.

---

## Pointing the real Laddoos website at this API

The SDK defaults to same-origin. For a marketing site on a different
domain, pass `apiBaseUrl`:

```ts
const yali = initYaliWebSdk({ apiBaseUrl: 'https://admin.laddoosdotcom.in' })
```

- **No trailing slash.** The URL is built by plain concatenation
  (`${apiBaseUrl}/api/web-events`), so a trailing slash produces a
  double slash.
- Include the scheme. Must be `https://` in production.
- Whatever origin that site is served from must be in
  `YALI_WEB_SDK_ALLOWED_ORIGINS` **on the CRM**, not on the website.
- The value is a public API base, safe to inline in client code.

---

## API

### `initYaliWebSdk(config?)`

```ts
interface YaliWebSdkConfig {
  /** Cross-origin API base, e.g. "https://admin.laddoosdotcom.in". Default: same-origin. */
  apiBaseUrl?: string
  /** Injectable fetch, mainly for tests. Default: the browser's global fetch. */
  fetchImpl?: typeof fetch
}
```

Returns an object with the methods below. Create one instance per page
(or reuse a module-level singleton — either is fine, the underlying
visitor/session id is read from storage either way, not held in the
instance).

### `sdk.getVisitorId()` / `sdk.getSessionId()`

Synchronous. Reads-or-creates a long-lived visitor id (persisted in
`localStorage`) and a per-tab session id (`sessionStorage`). Both
degrade to an in-memory value, scoped to the current page load only, if
storage is unavailable — never throws, never blocks the page.

### `sdk.trackPageView({ path, title?, dedupeSuffix?, campaignId?, adId?, creativeId? })`

Records a `web.page_view` event. `dedupeSuffix` is auto-generated per
call if omitted; pass your own if you need to safely retry the exact
same call without double-recording (e.g. your own retry-on-failure
logic). Returns `Promise<boolean>` — `true` if the server accepted it,
`false` on any failure. **Never throws.**

### `sdk.trackProductView({ productId, productName?, ... })`

Same shape and same underlying `web.page_view` event type as
`trackPageView` — see [Event types](#event-types-what-is-and-isnt-supported)
below for why there's no separate `product_view` type.

### `sdk.trackCtaClick()`

**Not implemented.** Always resolves `false` and logs one
`console.warn`. Kept as a real, callable function (not omitted) so the
gap is visible in code, not just in this doc. See the section below.

### `sdk.resolveContinuationFromUrl(overrides?)`

Reads `?yali_ref=` from the current page URL (or a `url` you pass in
`overrides`), resolves it against the server if present, and strips it
from the visible address bar afterward (`history.replaceState` — set
`stripFromUrl: false` to keep it). Returns one of:

```ts
{ present: false }                                      // no ref in the URL — the common case
{ present: true, resolved: false }                       // a ref was there but couldn't be resolved
{ present: true, resolved: true, data: { ... } }          // success
```

**`resolved: false` never says why.** Expired, revoked, unknown,
malformed, wrong signature, or wrong tenant are all the same outcome —
this mirrors the server's own deliberate design
(`docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md` §11–§12): distinguishing
them would let a script probe which refs are "close" to valid.
`data` never contains a token hash or the server's internal row id —
only the fields the API route itself already scoped for public
consumption.

---

## Event types — what is and isn't supported

The task behind this SDK asked for **page view / product view / CTA
click**. Server-side, `crm.timeline_event_types`
(`045_timeline_events.sql`) is seeded with exactly:

```
message.inbound, message.outbound,
web.visit, web.page_view, web.chat_started, web.chat_turn, web.form_submitted,
campaign.click, campaign.token_issued, campaign.token_redeemed, campaign.token_rejected,
identity.handle_observed, identity.linked, identity.rejected, identity.verification_sent, identity.verified,
system.correction
```

There is no `web.product_view` and no `web.cta_click`. Per this task's
own instruction ("page view / product view / CTA click **unless already
specified in the canonical plan**") and the separate instruction not to
modify migrations without a real bug, this SDK follows what's already
specified rather than inventing new server-side event types:

| Requested | What this SDK does |
|---|---|
| Page view | `trackPageView()` → `web.page_view`, exactly as seeded |
| Product view | `trackProductView()` → **also** `web.page_view` — a product page view genuinely is a page view; the product id/name go in the summary line so it's findable, not into a type that doesn't exist |
| CTA click | `trackCtaClick()` → **not implemented.** No matching event type exists; sending one would be rejected by the server's own foreign-key constraint on `timeline_events.event_type`. |

**CTA-click status: deliberately still disabled — now a recorded
decision, not an open gap.** See
[`PHASE2A_CTA_TAXONOMY_DECISION.md`](./PHASE2A_CTA_TAXONOMY_DECISION.md).

In short: seeding a `web.cta_click` event type is the semantically
correct answer, but the next migration number (`047`) is reserved for
Phase 2B by `PHASE2_CANONICAL_PLAN.md` §2, and Phase 2B's migration set
isn't designed yet. Reusing an existing type instead was **rejected** —
`campaign.click` means "arrived from a tracked link," the opposite
direction from an on-site click, and mixed rows can't be un-mixed later.

So: `trackCtaClick()` keeps returning `false`, and the seed gets folded
into Phase 2B's migration range when that's assigned. Its signature
won't need to change then. **Do not enable it by pointing it at an
existing event type.**

---

## Degradation behavior — what "safe" means here

| Condition | Behavior |
|---|---|
| No `window` (SSR, or this code runs on the server by mistake) | Visitor/session ids fall back to an in-memory value for that call; storage functions return `null`/`false`. No throw. |
| `window` exists but storage throws (private browsing) | Same as above — probed once per read/write, degrades silently. |
| No `fetch` available | `trackPageView`/`trackProductView`/`resolveContinuationFromUrl` resolve `false` / `{ resolved: false }` without attempting a call. |
| Network error, non-2xx response, malformed response body | Same — resolves `false`, never rejects. |

Every public function in this SDK is safe to call from anywhere in a
page's lifecycle without a `try/catch` around it.

---

## Local end-to-end proof

A dev harness at `/dev/phase2a-proof` (`src/app/dev/phase2a-proof/`)
proves the SDK actually reaches the API from a real browser, not just in
mocked unit tests. It can drive **both same-origin and cross-origin**
calls.

### What it does in production — stated accurately

It is a **production-404 diagnostic route**, not a page that "never
ships." Verified against a clean `npm run build`, not assumed:

- The route **is** in the production route manifest
  (`routes-manifest.json`, `app-paths-manifest.json`, and `next build`'s
  own route table). It doesn't disappear.
- It prerenders to a **static 404** —
  `.next/server/app/dev/phase2a-proof.meta` records `"status": 404` and
  the emitted HTML contains none of the harness markup.
- The harness's client chunk (~6.5 KB) **is** still emitted into
  `.next/static/`. It's orphaned — only the 404'd route's own manifest
  references it, so no live page loads it — but it remains fetchable by
  direct URL. That's harmless (it's UI code calling two endpoints that
  are already public and anonymous by design), but "it ships" is the
  accurate word. Making the import dynamic to drop it was tried and
  **didn't work** — Turbopack emits the chunk regardless.

The guard is `process.env.NODE_ENV !== 'development'` — a positive
allow-list, not `=== 'production'`. A deny-list guard would leave the
harness live whenever `NODE_ENV` is unset or unexpected (build without
`NODE_ENV`, then `next start`). Only a real dev server serves it.

It's kept rather than deleted because it's the only way to re-run a real
browser proof of these endpoints — including CORS, below.

**To run it:**

```bash
npx supabase start        # local stack, ports 55321-55323
npm run db:test:reset     # from-zero, 46 migrations, 0 errors expected
npm run dev                # Next.js dev server
```

The harness needs one account and an active `workspace_brand_map` row to
exist first (`resolveSingleAccountWorkspaceContext` requires it — same
precondition as every other Phase 2A endpoint). A fresh
`db:test:reset` has neither yet; either sign up through `/signup` once,
or seed it directly for a quick local check:

```sql
-- Illustrative only — not part of any migration, not for production.
insert into auth.users (id, email, encrypted_password, email_confirmed_at)
  values (gen_random_uuid(), 'dev@example.com', 'x', now());
-- the signup trigger creates the profile + account; then:
insert into crm.workspace_brand_map (crm_workspace_id, tenant_id, brand_id, is_active)
  select id, gen_random_uuid(), gen_random_uuid(), true from crm.accounts limit 1;
```

Then open `http://localhost:3000/dev/phase2a-proof`. It resolves any
`?yali_ref=` on load, and has two buttons — "Track page view" and
"Track product view" — each firing one real `POST /api/web-events`
call. The call log on the page shows the boolean/JSON result of each.

**To confirm it actually wrote rows**, query the local DB directly:

```bash
docker exec supabase_db_laddoos-crm psql -U postgres -d postgres \
  -c "select event_type, channel, summary, dedupe_key from crm.timeline_events order by occurred_at;"
docker exec supabase_db_laddoos-crm psql -U postgres -d postgres \
  -c "select count(*) from crm.messages;"  -- must stay 0 — this SDK never writes there
```

### Proving CORS cross-origin, with one dev server

No second host, tunnel, or DNS entry needed. Browsers treat
`http://localhost:3000` and `http://127.0.0.1:3000` as **different
origins** even though they're the same server, which is enough for a
genuine cross-origin request — preflight and all.

```bash
export YALI_WEB_SDK_ALLOWED_ORIGINS="http://127.0.0.1:3000"
# Required, or the page will not hydrate — see the note below.
export ALLOWED_DEV_ORIGINS="127.0.0.1,127.0.0.1:3000"
npm run dev
```

Then open:

```
http://127.0.0.1:3000/dev/phase2a-proof?api=http://localhost:3000
```

> **`ALLOWED_DEV_ORIGINS` is not optional here, and the failure is
> silent.** Next 16 blocks dev-only resources when the browser's origin
> isn't the host the dev server booted on (`localhost`). Loading the
> harness from `127.0.0.1` without this set produces a page that renders
> its server HTML perfectly, returns **200 for every chunk**, logs **no
> console error** — and never hydrates. Buttons do nothing, `visitor_id`
> stays `(loading)`, and no API call is ever made. It reads as "CORS is
> broken" when CORS was never reached. Cost an entire debugging detour
> the first time; `next.config.ts` already plumbs the env var for it.

The page loads from `127.0.0.1` and calls the API on `localhost` — the
header reads **CROSS-ORIGIN**, and the `?api=` value seeds the on-mount
continuation resolve as well as the buttons (the input also edits it
live for the buttons). In devtools you should see an `OPTIONS` preflight
returning **204** before the `POST`, and the rows land in
`crm.timeline_events` exactly as in the same-origin run.

**Then run the negative control** — this is the half that actually
proves the allow-list does something:

```bash
export YALI_WEB_SDK_ALLOWED_ORIGINS="https://not-this-one.example"
# restart the dev server, reload the same URL
```

The preflight now returns **403**, the browser blocks the POST, and the
harness logs `failed`. If it still succeeds, the allow-list isn't being
read — don't record a pass.

---

## What this pass does not include

- No wiring into an actual website page — this repo doesn't contain the
  Laddoos marketing site. The remaining work there is: serve the site,
  call `initYaliWebSdk({ apiBaseUrl })`, call `trackPageView()` on load
  and route change, call `resolveContinuationFromUrl()` once per load,
  and add that site's origin to `YALI_WEB_SDK_ALLOWED_ORIGINS` here.
- No CTA-click event type — decided, see above.
- No automatic page-view-on-load or route-change listener — the host
  page calls `trackPageView()` itself, on whatever event (Next.js
  `usePathname` change, a plain `<script>` at the bottom of the page,
  etc.) makes sense for that site's own framework.
- No rate-limit sharing across instances — `checkRateLimit` is
  in-memory and per-process, so the per-IP limits are per-instance.
  Fine at one instance; note it before scaling out.
