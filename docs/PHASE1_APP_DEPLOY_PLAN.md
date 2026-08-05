# Phase 1 — App Deploy Plan (VPS)

**Date:** 2026-08-05 (Step 0 findings folded in same day)
**Status:** PLAN ONLY — **Step 0 complete, §7 finalised.** Nothing deployed,
no DNS record created, no Supabase change, nothing committed. Step 0 was
read-only: no container, config or service on the VPS was altered.
**Scope:** getting this app served at `https://admin.laddoosdotcom.in`.
Database migrations are **already done** — `001`–`047` applied to production
2026-08-04, `crm` exposed in PostgREST. This plan does not touch them.

**Decision taken:** host on the existing Hostinger VPS behind Traefik, not on
Vercel.

> ⚠️ **The VPS also runs the live voice agent.** Read §11 before running
> anything on that box. A careless `docker` command there drops phone calls.

---

## ⛔ NEXT GATE — deployment cannot start until this is decided

**Nothing in this plan may begin until the code-transfer method is chosen
(§6).** This is not a step to work around; it is the gate. Every later
section — the build in §9, the rollback table in §10 — assumes an answer,
and picking wrong is only discovered when you need to roll back and find
there is nothing to roll back to.

| Option | Verdict |
|---|---|
| **Commit + push, clone on the VPS** | ✅ **Recommended.** The only option that makes §10's rollback real. Requires lifting the no-commit hold and closing the open PR review |
| **`rsync` the working tree** | ⚠️ **Throwaway smoke testing only.** Acceptable to prove Traefik routing and TLS once, on an explicitly disposable container. The deployed bytes match no commit, so it must never become the production path |
| **Build image off-box, push to a registry** | Viable but adds a registry for one app |

Deciding this is the **single next action.**

**Step 0 (§3) is now complete** — it ran read-only on 2026-08-05 and closed
every infrastructure unknown, so §7's compose override is finalised. That was
the only work available under the gate. Everything that remains changes the
box, and none of it may start until the transfer method is chosen.

---

## 🚫 Out of scope — do not edit the existing proxy stack

**Direct edits to Traefik's or n8n's configuration are not part of this
task.** `/docker/n8n/docker-compose.yml` and Traefik's own static/dynamic
config are **read-only** here — §3.4 opens that file to *learn* the
conventions, never to change them.

The CRM is added exactly one way: a **new, separate compose file** under
`/docker/laddoos-crm/`, written **only after Step 0 (§3.1, §3.2) has confirmed
the real network name and certresolver name**. Until those two values are
observed, §7 is a template with placeholders, not something to run.

Rationale: Traefik is a shared ingress. It currently terminates TLS for n8n
— which is also the Yali brain broker. A malformed label or a redefined
entrypoint does not fail politely in its own lane; it can take routing down
for services that have nothing to do with this deploy.

---

## 1. Why the VPS over Vercel

| | VPS + Traefik | Vercel |
|---|---|---|
| Deploy path | `docker compose up -d --build`, already tested locally | Hobby GitHub auto-deploy is **blocked on this account** ("commit author does not have contributing access") — CLI-only, same friction as the brain repo |
| Plan / ToS | Already paid for, already running two services | Hobby is **non-commercial use**; a founder CRM is commercial. Pro was declined |
| Cron | `/api/automations/cron` + `/api/flows/cron` need an external pinger — systemd timers or n8n are already on the box | Hobby cron is daily-only; automation Wait steps need minutes |
| Artifact | `Dockerfile` (standalone output, non-root, port 3000) + `docker-compose.yml` already exist and are documented in `docs/docker.md` | Would need a second, unproven deploy path |
| TLS + routing | Traefik already terminating TLS for `n8n.azulelefant.tech` on this box — marginal cost of one more router is ~zero | New project setup |
| Latency to data | Supabase is external either way — no edge advantage | No advantage |
| Long-lived work | Webhooks, background pings, future workers all fine | Serverless timeouts |

**The honest cost of this choice:** the VPS becomes a shared failure domain
with revenue-critical telephony. Vercel would isolate the CRM from the voice
agent. That is a real trade, and §10 (resource limits) plus §11 (build window)
are the mitigations — not a claim that the risk is zero.

---

## 2. DNS — do not create yet

| Type | Name | Value | TTL | Proxy |
|---|---|---|---|---|
| `A` | `admin` | `157.173.219.125` | `300` | DNS-only (no proxy) |

Zone: `laddoosdotcom.in`. Result: `admin.laddoosdotcom.in` → the VPS.

- **TTL 300 is deliberate** — it keeps the rollback in §10 to a five-minute
  revert rather than a day.
- Verified 2026-08-01 and still true: **the hostname does not resolve today.**
- Step 0 has now run (§3) and confirmed Traefik's config. Create this record
  *before* the first container start, so the certificate can issue on the
  first attempt.

> **Corrected 2026-08-05 — the challenge type is TLS-ALPN-01, not HTTP-01.**
> An earlier version of this section said ACME would "complete the HTTP-01
> challenge". This Traefik is configured with
> `--certificatesresolvers.mytlschallenge.acme.tlschallenge=true`, which is
> **TLS-ALPN-01, validated on `:443`** — not HTTP-01 on `:80`.
>
> The practical requirement is unchanged: `admin.laddoosdotcom.in` must
> resolve to `157.173.219.125` *before* the container starts, or the
> certificate cannot issue. What changes is where you look when it fails —
> port 443 and the TLS handshake, not `/.well-known/acme-challenge/` on
> port 80. Traefik does listen on `:80`, but only to 301 everything to
> `websecure`; no ACME traffic is served there.

---

## 3. Step 0 — ✅ COMPLETE, ran 2026-08-05 (read-only)

All checks were read-only over one SSH session. Nothing on the box was
changed, restarted, or written. **The placeholders in §7 are now resolved**
— see the table below and §7's finalised override.

| # | Question | **Answer** |
|---|---|---|
| 3.1 | Traefik docker network | **`n8n_default`** |
| 3.2 | ACME certresolver | **`mytlschallenge`** (TLS-ALPN-01 — see §2) |
| 3.3 | Entrypoints | **`web`** (:80) and **`websecure`** (:443) |
| 3.4 | Is port 3000 free? | ❌ **NO — `waha` holds `127.0.0.1:3000`.** See §3.3 |
| 3.5 | n8n resource limits? | **None.** The CRM will be the only capped container |

Traefik is **v3.6.13**, `--providers.docker=true` with
`--providers.docker.exposedbydefault=false` — a container is routed only if
it carries `traefik.enable=true`. Nothing is exposed by accident.

### 3.1 Traefik's docker network — `n8n_default`

Traefik sits on exactly one network, `n8n_default` (aliases `traefik`,
`n8n-traefik-1`, IP `172.18.0.3`). The CRM container must join it or the
router will exist and every request will 502.

> ⚠️ **`n8n_default` is compose-created, not a standalone network.** The n8n
> compose file declares external *volumes* but **no `networks:` block**, so
> Docker Compose auto-created `n8n_default` for the `n8n` project and owns
> its lifecycle.
>
> **The CRM compose file must still declare it `external: true`** — that is
> correct and is what stops the CRM project from trying to create or manage
> it. But understand the coupling it creates:
>
> - A `docker compose down` in `/docker/n8n` will try to remove a network the
>   CRM is attached to. Docker refuses and warns; nothing breaks, but the
>   network survives in a state n8n's project no longer thinks it owns.
> - If n8n's stack is ever fully recreated, `n8n_default` may come back with
>   a new network ID. The CRM container would need recreating to rejoin.
>
> Neither is a reason to change n8n's config — **that is explicitly out of
> scope.** It is a reason to check `docker network inspect n8n_default` after
> any n8n maintenance, and to expect the CRM to need a restart if n8n's stack
> was rebuilt.

### 3.2 ACME certresolver — `mytlschallenge`

From Traefik's live static config:

```text
--certificatesresolvers.mytlschallenge.acme.tlschallenge=true
--certificatesresolvers.mytlschallenge.acme.email=hello@azulelefant.tech
--certificatesresolvers.mytlschallenge.acme.storage=/letsencrypt/acme.json
```

Reuse this resolver. It has been issuing and renewing n8n's certificate for
weeks — it is the proven path, and adding a second resolver would mean a
second untested ACME configuration for no gain. Note the challenge type: see
§2's correction.

### 3.3 Entrypoints — `web,websecure`, and port 3000 is TAKEN

```text
--entrypoints.web.address=:80
--entrypoints.web.http.redirections.entryPoint.to=websecure
--entrypoints.web.http.redirections.entryPoint.scheme=https
--entrypoints.websecure.address=:443
```

`web` redirects everything to `websecure` globally. n8n's own router uses
`entrypoints=web,websecure`; **match that pair.**

> ### ⛔ Port 3000 is NOT free — this invalidated the original plan
>
> `ss -ltnp` on 2026-08-05:
>
> ```text
> 127.0.0.1:3000   docker-proxy   → container `waha` (devlikeapro/waha:latest)
> 0.0.0.0:8082     python pid 276002 → laddoos-gemini-live health server
> :8081            NOTHING LISTENING
> ```
>
> An earlier version of this plan said to set `HOST_PORT=127.0.0.1:3000`.
> **That would fail to start** — the bind collides with `waha`. Leaving
> `HOST_PORT` unset is worse: the base compose file's default renders
> `0.0.0.0:3000`, which collides too.
>
> **Fix: `HOST_PORT=127.0.0.1:3001`** (§4, §7). The CRM does not actually
> need a published host port at all — Traefik reaches it over
> `n8n_default` — but Compose merges `ports` lists *additively*, so the base
> file's `'${HOST_PORT:-3000}:3000'` cannot be removed by an override. 3001
> is the cheapest way to make it harmless.
>
> **The container's internal port stays 3000.** Only the host-side binding
> moves. `traefik.http.services.laddooscrm.loadbalancer.server.port` is
> therefore still `3000` — see §7.

### 3.4 The n8n compose file — the reference implementation

Read only; **never edited**. It is the source of the label style, resolver
name and entrypoint pair adopted in §7. One deliberate divergence: n8n
attaches a `headers` middleware chain (HSTS, nosniff, XSS filter). The CRM
does **not** copy it — [`next.config.ts`](../next.config.ts) already sets
its own security headers, and duplicating HSTS at the proxy would give two
sources of truth for one header. §12 verifies the app's headers survive the
proxy.

### 3.5 Resource limits — n8n has none

Neither `n8n` nor `traefik` sets `deploy.resources` or `mem_limit`. The CRM
will be the only capped container on the box. That is the correct outcome,
not an inconsistency to fix: the CRM is the new, unproven workload sharing a
host with revenue-critical telephony. Capping the new thing is the point.

Observed at Step 0 — memory is not a constraint:

```text
Mem: 7941 total / 2425 used / 5516 available
waha 748 MB · hermes-agent 458 MB · n8n 439 MB · traefik 116 MB
```

---

## 4. Required environment variables

Lives in `/docker/laddoos-crm/.env.local` on the VPS, mode `600`, owned by root.
**Never committed.**

> **Path decided 2026-08-05: `/docker/laddoos-crm/`, not `/opt/laddoos-crm/`.**
> An earlier revision of this plan used `/opt/`. The box's actual convention,
> confirmed by Step 0, is `/docker/<project>/` for Docker Compose projects
> (`/docker/n8n/`, `/docker/hermes-agent-azc8/`) and `/opt/` for systemd
> services (`/opt/laddoos-gemini-live/`). The CRM is a Compose project, so it
> belongs under `/docker/`. Nothing functional depends on this — it is
> consistency, per §3.4's "do not invent a second convention."

### Build-time — inlined into the client bundle, changing one needs a rebuild

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ugjishankutgfegplrgq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase → Project Settings → API |
| `NEXT_PUBLIC_SITE_URL` | `https://admin.laddoosdotcom.in` |
| `NEXT_PUBLIC_APP_LOCALE` | `en` |

### Runtime — read from `.env.local`, never baked into the image

Required for the app to run at all:

| Var | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → API. Bypasses RLS |
| `ENCRYPTION_KEY` | 64 hex chars, AES-256-GCM |
| `HOST_PORT` | **`127.0.0.1:3001`** — **not 3000**, `waha` already holds `127.0.0.1:3000`. See §3.3 and §7 |

### Required before a specific milestone — not optional, just later

Each of these fails **closed**, so an unset value is a dead feature rather
than a hole. That makes them easy to forget, and the failure looks like a
bug in the feature rather than a missing variable. Set each one *before*
the milestone in its row, not after the first confusing test result.

| Var | Required before | Value | If unset |
|---|---|---|---|
| `CONTINUATION_TOKEN_SIGNING_KEY` | **Phase 2A website continuation testing** | 64 hex chars, HMAC-SHA256 | `POST /api/continuation-tokens` and `GET /api/continuation-tokens/resolve` both fail closed. Every `?yali_ref=` link is unissuable and unresolvable — the continuation path cannot be tested at all |
| `YALI_WEB_SDK_ALLOWED_ORIGINS` | **connecting the public website** | `https://laddoosdotcom.in,https://www.laddoosdotcom.in` | No cross-origin caller is allowed. Every web SDK call from the site is silently refused at CORS preflight; `crm.timeline_events` gains nothing and the SDK looks broken |
| `META_APP_SECRET` | **WhatsApp channel enablement** | Meta for Developers → App Settings → Basic | Every inbound WhatsApp/Instagram webhook POST is rejected. Only required if WhatsApp/Meta webhook or template functionality is part of *this* deploy — if the CRM ships web-tracking-only first, this can wait |
| `AUTOMATION_CRON_SECRET` | automation/flow **Wait** steps | 64 hex chars | `/api/automations/cron` and `/api/flows/cron` return 503; Wait steps never drain |

> **Canonical origins, stated once.** `YALI_WEB_SDK_ALLOWED_ORIGINS` takes
> **`https://laddoosdotcom.in,https://www.laddoosdotcom.in`** — full origins,
> scheme included, no trailing path, comma-separated. Do **not** copy the
> value from `.env.local.example`, which suggests `https://laddoos.com` — that
> is a domain this account does not own. A bare hostname is silently dropped
> (it cannot be parsed as an origin), so a typo here presents as "the SDK
> does nothing" with no error anywhere.

### Recommended for this deployment

| Var | Value | Why |
|---|---|---|
| `ALLOWED_INVITE_HOSTS` | `admin.laddoosdotcom.in` | Belt-and-braces against a spoofed `Host` producing a phishing invite URL |

### Genuinely optional

`META_APP_ID` (only for image-header WhatsApp templates, and only once the
WhatsApp channel is live), `WHATSAPP_TEMPLATES_DRY_RUN` (must stay unset in
production).

---

## 5. Which env vars you must set manually

Nothing here can be derived, generated, or guessed by me.

**Fetch from a console — only you have access:**

1. `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase dashboard
2. `SUPABASE_SERVICE_ROLE_KEY` — Supabase dashboard (secret; RLS-bypassing)
3. `META_APP_SECRET` — Meta for Developers — **only if WhatsApp/Meta webhook
   or template functionality is in this deploy**; otherwise defer to WhatsApp
   channel enablement (§4)
4. `META_APP_ID` — Meta for Developers (only if image-header templates, and
   only once the WhatsApp channel is live)

**Generate once, then store in your password manager before pasting:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
openssl rand -hex 32                                                       # AUTOMATION_CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CONTINUATION_TOKEN_SIGNING_KEY
```

> **`ENCRYPTION_KEY` is not rotatable in practice.** Rotating it orphans every
> WhatsApp token encrypted under the old key — every user has to re-save their
> WhatsApp settings to reconnect. Generate it once, back it up, never
> regenerate casually.

---

## 6. Getting the code onto the VPS — **open decision, blocks everything**

The working tree is **uncommitted** (80 modified / 64 untracked) and you have
asked not to commit. There is therefore no git ref to clone. Three options,
none of which I have taken:

| Option | What it means | Cost |
|---|---|---|
| **A. Commit + push, clone on VPS** | The normal path. Requires lifting the no-commit hold and the still-open PR review | Cleanest provenance, reproducible deploys |
| **B. `rsync` the working tree** | `rsync -az --exclude node_modules --exclude .next --exclude .git ./ root@VPS:/docker/laddoos-crm/` | Works today, but the deployed bytes match no commit — rollback has nothing to roll back *to* |
| **C. Build image locally, push to a registry** | Needs a registry and a local Docker build | Extra moving part for one app |

**Recommendation: A**, because §10's rollback plan is only real if a previous
known-good ref exists. B is acceptable for a first smoke test explicitly
labelled throwaway — never as the production path. This is yours to decide,
and it is the **next gate** at the top of this document.

---

## 7. Compose override with Traefik labels

New file `/docker/laddoos-crm/docker-compose.override.yml`. The committed
`docker-compose.yml` is **not edited** — Compose merges the override.

**Finalised 2026-08-05** — every placeholder resolved by Step 0. No `<...>`
values remain.

```yaml
# docker-compose.override.yml — VPS only, not committed.
# All values below confirmed live by Step 0 (§3), 2026-08-05.
services:
  app:
    container_name: laddoos-crm
    networks:
      - n8n_default
    labels:
      traefik.enable: 'true'
      traefik.docker.network: n8n_default
      traefik.http.routers.laddooscrm.rule: Host(`admin.laddoosdotcom.in`)
      traefik.http.routers.laddooscrm.entrypoints: web,websecure
      traefik.http.routers.laddooscrm.tls: 'true'
      traefik.http.routers.laddooscrm.tls.certresolver: mytlschallenge
      traefik.http.services.laddooscrm.loadbalancer.server.port: '3000'
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1536M
        reservations:
          memory: 512M
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: '3'

networks:
  n8n_default:
    external: true
```

Four things that will bite if skipped:

- **`entrypoints: web,websecure` matches n8n exactly.** Confirmed from
  Traefik's live static config (§3.3): the entrypoints are named `web` and
  `websecure`, not `http`/`https`. `web` globally 301s to `websecure`, so
  listing both gives plain-HTTP callers a redirect instead of a connection
  reset.
- **`loadbalancer.server.port: '3000'` is the port *inside* the container**
  and is correct as written. Do not "fix" it to 3001 — 3001 is only the
  host-side binding (see below). Traefik connects over `n8n_default` directly
  to the container's own port 3000, never via the published host port.
- **`traefik.docker.network` is required** when a container is on more than
  one network, which this one is (its compose default plus `n8n_default`).
  Without it Traefik may pick the wrong IP and 502.
- **The host binding must be 3001, not 3000.** Compose merges `ports` lists
  *additively*, so the base file's `'${HOST_PORT:-3000}:3000'` cannot be
  removed by an override. Set **`HOST_PORT=127.0.0.1:3001`** in `.env.local`,
  which renders `127.0.0.1:3001:3000` — loopback only, and clear of `waha`
  on `127.0.0.1:3000` (§3.3). **Verify with §12's `curl` from outside.**

> **`n8n_default` is declared `external: true` deliberately.** It is created
> and owned by the n8n compose project, not by this one (§3.1). `external`
> is what tells Compose to attach to it rather than try to manage it — and
> it is also why this file never needs to touch `/docker/n8n/`. Re-read
> §3.1's coupling note before any n8n maintenance.

`deploy.resources.limits` is honoured by `docker compose up` on Compose v2
(non-Swarm). Confirm with `docker stats` in §12 rather than trusting it.

---

## 8. Resource limits

| Resource | Limit | Reason |
|---|---|---|
| CPU | 1.0 vCPU | Leaves headroom for the voice agent and n8n |
| Memory | 1536 MB hard limit, 512 MB reservation | A Next.js standalone server idles far below this; the cap is what stops a leak from OOM-killing the voice agent |

> **The build is the dangerous step, not the runtime.** `next build` on
> Next 16 routinely peaks well above the runtime footprint, and it is
> **not** covered by `deploy.resources.limits` — those apply to the running
> service. Check free memory *before* building (§12's `free -m`) and consider
> `NODE_OPTIONS=--max-old-space-size=1024` for the build stage, or option C in
> §6 (build off-box) if the VPS is tight. **Open decision.**

---

## 9. Build and start

```bash
# on the VPS, in /docker/laddoos-crm
docker compose --env-file .env.local config          # 1. render + validate, changes nothing
docker compose --env-file .env.local build           # 2. build only — watch memory here
docker compose --env-file .env.local up -d           # 3. start
docker compose logs -f --tail=100 app                # 4. watch first boot
```

`--env-file .env.local` is **required** on every invocation — Compose only
reads `.env` by default for `${VAR}` substitution, and this project keeps its
config in `.env.local`.

Rebuild after changing any `NEXT_PUBLIC_*` value (they are inlined at build
time): `docker compose --env-file .env.local up -d --build`.
Runtime-only secrets need just `docker compose --env-file .env.local up -d`.

---

## 10. Rollback plan

The database is **not** part of this deploy — migrations were applied
2026-08-04 and are untouched here. So rollback is app-only and cheap.

| Failure | Action |
|---|---|
| Container won't start / crash-loops | `docker compose --env-file .env.local down` — Traefik drops the router, site 404s, **everything else on the box keeps running** |
| Bad build, previous image exists | `docker tag` the prior image back to the compose image name and `up -d` without `--build`. Tag the current good image *before* rebuilding: `docker tag wacrm-app:latest wacrm-app:rollback-$(date +%s)` |
| TLS never provisions | Leave the container down; DNS TTL 300 means removing the A record de-points in ~5 min |
| Voice agent degraded (§11) | `docker compose down` **first**, then verify the agent, then investigate |
| Total revert | `docker compose down && docker image rm <image>` and delete the A record. The box returns to exactly its pre-deploy state — no Supabase, systemd, or n8n change was made |

**Never** `docker system prune -a` on this box — it would remove the n8n,
`waha` and hermes-agent images too. **Never** restart the Docker daemon — it
takes n8n, `waha` and Traefik down with it.

---

## 11. ⚠️ This VPS also runs the live voice agent

`157.173.219.125` runs the following. **Inventory corrected 2026-08-05 from
a live `docker ps` + `ss -ltnp`, replacing an earlier version that was wrong
in two places** (it omitted `waha` entirely and claimed `:8081` was occupied):

| Service | Type | Listening on | Notes |
|---|---|---|---|
| `laddoos-gemini-live` | systemd | **`0.0.0.0:8082`** (python pid 276002) | **The live telephony voice agent.** `/opt/laddoos-gemini-live`. Revenue-critical, real calls. `active` + `enabled`, 0 ERROR lines in the 2h before Step 0 |
| **`waha`** | docker | **`127.0.0.1:3000`** | `devlikeapro/waha:latest` — a **WhatsApp HTTP API gateway**. ~748 MB, the largest container on the box. **This is what makes port 3000 unavailable** (§3.3). Was missing from this table entirely until 2026-08-05 |
| `n8n-n8n-1` | docker | `127.0.0.1:5678` | `/docker/n8n/`, behind Traefik. Also the Yali brain broker |
| `n8n-traefik-1` | docker | `0.0.0.0:80`, `0.0.0.0:443` | Traefik v3.6.13. TLS + routing, **shared ingress** — a bad label can affect routing for n8n too |
| `hermes-agent-azc8` | docker | `0.0.0.0:32768` | Hostinger's own VPS management agent. Leave alone |
| `monarx-agent` | host | `127.0.0.1:65529` | Hostinger malware scanner. Leave alone |
| ~~old `main.py`~~ | — | **nothing listening on `:8081`** | Previously documented as occupying 8081. **It is not running.** Do not treat 8081 as reserved on that basis — but equally, do not repurpose it without finding out why the service is gone |

> **`waha` deserves a second look, separately from this deploy.** There is
> already a WhatsApp gateway on this box. That may be relevant to how the
> CRM's own WhatsApp channel gets enabled later (§4's `META_APP_SECRET` row).
> It is **not** a deploy question and nothing here touches it — noted so it
> is not rediscovered as a surprise.

Rules for this deploy:

1. **Build in a low-traffic window.** A docker build will saturate the CPU on a
   shared box; the voice agent is latency-sensitive by nature.
2. **Check the agent before and after** every step in **§9 (build and start)**
   and **§12 (post-deploy smoke tests)** — those are the sections that put load
   on the box. `systemctl is-active laddoos-gemini-live` plus a journal scan for
   `ERROR` since the build began. §12's "Neighbours unharmed" block is the
   after-check; run the same two commands once *before* you start §9 so you
   have a baseline to compare against.
3. **Do not touch** `/opt/laddoos-gemini-live`, its `.venv`, its `.env`, or the
   systemd unit. Nothing in this plan requires it.
4. **Do not restart Docker, prune images, or edit `/docker/n8n/`.** Step 0 only
   *read* that file, and it stays read-only. The same applies to `waha` and
   the hermes agent — nothing in this plan starts, stops or reconfigures them.
5. **Do not bind host port 3000.** `waha` has it. Use `127.0.0.1:3001`
   (§3.3, §7). A collision here fails at container start, which is loud and
   safe — but it fails *after* a full build has already loaded the box.
6. If the agent shows any degradation, §10's first move is `docker compose
   down` on the CRM — not debugging the CRM while calls are dropping.

---

## 12. Post-deploy smoke tests

Run in order. Any failure → §10.

**Infrastructure**

```bash
dig +short admin.laddoosdotcom.in                    # → 157.173.219.125
curl -sSI https://admin.laddoosdotcom.in/login       # → 200, valid cert, no warning
curl -sS  https://admin.laddoosdotcom.in/login -o /dev/null -w '%{http_code} %{ssl_verify_result}\n'
```

**Port 3000 must NOT be reachable from outside** (the §7 loopback binding):

```bash
curl -sS --max-time 5 http://157.173.219.125:3000/ && echo "FAIL: exposed" || echo "OK: not reachable"
```

**Security headers survive the proxy** (`next.config.ts` sets them):

```bash
curl -sSI https://admin.laddoosdotcom.in/login | grep -iE 'strict-transport|x-frame-options|x-content-type|referrer-policy'
```

**App health**

```bash
docker compose --env-file .env.local ps        # app healthy (compose healthcheck hits :3000)
docker compose logs --tail=200 app | grep -iE 'error|unhandled' || echo "clean"
docker stats --no-stream laddoos-crm           # within 1 vCPU / 1.5 GB
```

**Supabase reachability from the container** — a wrong anon key or unexposed
schema shows here, not in the logs:

```bash
docker compose exec app node -e "fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/',{headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}}).then(r=>console.log('supabase',r.status))"
```

**Neighbours unharmed — do not skip**

```bash
systemctl is-active laddoos-gemini-live
journalctl -u laddoos-gemini-live --since '30 min ago' | grep -c ERROR      # expect 0
curl -sSI https://n8n.azulelefant.tech | head -1                            # n8n still served
free -m
```

**Browser, manually:** load `https://admin.laddoosdotcom.in`, confirm it
redirects to `/login`, styles load (no unstyled page — that symptom means
stale HTML referencing missing chunks), and the console is clean.

---

## 13. First admin signup and `workspace_brand_map` seed

Only after §12 passes. This is `PHASE1_DEPLOYMENT_RUNBOOK.md` §6 — the
authoritative copy. Summarised here for sequence only; **run it from the
runbook.**

**13.1 — Sign up the founder account.** Go to
`https://admin.laddoosdotcom.in/signup` and create the single Laddoos admin.
`crm.handle_wacrm_user_created` creates the `crm.accounts` row automatically.
Create **exactly one** account: Phase 2A's anonymous endpoints call
`resolveSingleAccountWorkspaceContext()`, which fails loudly if more than one
`crm.accounts` row exists.

**13.2 — Find the account id** (Supabase SQL editor, runbook §6a). Expect
exactly one row. None → signup did not complete.

**13.3 — Insert the mapping** (runbook §6b), using the email-matching variant
to avoid hand-copying a UUID. Laddoos `tenant_id`
`7a1a52f2-1bc0-444c-b6b3-6ec44c51e39b`, `brand_id`
`cce781df-c17f-4791-a183-5a9683a93ad1`. Check it reports `INSERT 0 1` —
`INSERT 0 0` means the email matched nothing and **no mapping exists**.

**13.4 — Verify** (runbook §6c): one row, `is_active = true`.

> **Do not use `auth.uid()` in the SQL editor.** The editor runs as `postgres`
> with no JWT, so it returns NULL and the insert fails on the NOT NULL
> constraint. Reproduced 2026-08-02. The runbook's superseded version is
> marked; use §6a–6c as written.
>
> **Running the insert twice fails by design** — the partial unique index
> rejects a second active mapping. Deactivate the old row instead.

Without this row `link_contact_to_customer()` silently no-ops for every
contact, and every Phase 2A anonymous endpoint returns "Service not
configured".

**13.5 — Then, and only then:** verify `authenticated` RLS with a real JWT.
Per `CLAUDE.md` this has **never been tested** — `auth.users` was empty until
13.1. A real logged-in session is the first opportunity. Treat it as its own
task, not a footnote to the deploy.

---

## 14. Open decisions

1. **How code reaches the VPS (§6).** Blocks everything. Commit + push (clean
   rollback), rsync the working tree (works now, nothing to roll back to), or
   build off-box. **Recommend commit + push** — it is the only option that
   makes §10 real. Your call; the no-commit hold is yours to lift.
2. **Where the build runs (§8).** 1.5 GB alongside a live voice agent is tight
   for `next build`. Build on the VPS in a quiet window, or build elsewhere and
   ship the image. Decide before the first build, not during it.
3. **Cron pinger.** `/api/automations/cron` and `/api/flows/cron` need an
   external scheduler. n8n is already on the box and is the obvious candidate —
   or a systemd timer. Not required for first deploy; required before automation
   Wait steps work.
4. ~~**Traefik entrypoint/resolver names.**~~ ✅ **CLOSED 2026-08-05 by Step 0.**
   Network `n8n_default`, resolver `mytlschallenge`, entrypoints `web,websecure`.
   §7's override is finalised — no placeholders remain.
5. ~~**Does n8n set resource limits?**~~ ✅ **CLOSED 2026-08-05 by Step 0.** It
   does not. The CRM will be the only capped container, which is the intended
   outcome — cap the new, unproven workload, not the one that has been stable
   for weeks.

**Opened by Step 0 — decide before the first build:**

6. **Host port.** Resolved in this document as `127.0.0.1:3001` because `waha`
   holds `127.0.0.1:3000` (§3.3). Flagged here only so the change is visible
   to anyone working from an older copy that said 3000.
7. **`waha` overlaps the CRM's WhatsApp story.** A WhatsApp HTTP API gateway
   already runs on this box (§11). Whether the CRM's WhatsApp channel should
   integrate with it, replace it, or ignore it is a **product decision, not a
   deploy one** — and it is not needed for first deploy, which is web-tracking
   only. Do not let it expand this deploy's scope.

---

## 15. What this plan does NOT do

- No deploy, no DNS record, no Supabase change, no commit — all held per
  instruction.
- No migration work. `001`–`047` were applied 2026-08-04; this plan is app-only.
- Does not touch the voice agent, n8n, or Traefik's own configuration.
- Does not resolve the outstanding commit/PR-review blocker, or the
  `public`-schema commerce proposals (runbook §7, a brain-repo action).
