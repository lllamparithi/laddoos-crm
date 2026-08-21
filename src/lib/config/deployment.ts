/**
 * Typed deployment configuration validation utility for a single-tenant
 * YALI Omni deployment (one customer, one database, one credential set).
 *
 * ── Status: foundation, not yet wired ───────────────────────────
 * This module has **no production caller**. It does not currently run at
 * startup and does not, by itself, make any deployment fail. It is the
 * validation primitive that future callers opt into — a boot check, a
 * readiness probe or an integration slice can call `loadDeploymentConfig()`
 * to fail fast on a misconfigured deployment. Until something calls it, its
 * only effect is on code that chooses to use it.
 *
 * Why it exists: the same core image is deployed per customer, so the same
 * misconfiguration will recur per deployment. `.env.local`'s
 * `NEXT_PUBLIC_SUPABASE_URL` shipping as an unconfigured placeholder has
 * already cost debugging time — a present-but-empty value is exactly as
 * broken as an absent one, so both are treated as missing here.
 *
 * ── Secret safety, stated precisely ─────────────────────────────
 * Two properties hold, and only these two:
 *
 *   1. Validation failures name **keys, never values**. `DeploymentConfigError`
 *      carries `missingKeys`; no value reaches a message or stack.
 *   2. `toJSON()` redacts values **during JSON serialisation only** — that
 *      covers `JSON.stringify(config)` and loggers that serialise to JSON.
 *
 * It does **not** make this object safe to log generally. `console.log(config)`
 * in Node uses `util.inspect`, which ignores `toJSON()` and would print every
 * value. Anything that reads a property directly, spreads the object, or
 * inspects it will see real credentials. This object holds the service-role
 * key: normal secret-safe discipline still applies at every call site.
 *
 * ── Server-only boundary ────────────────────────────────────────
 * The runtime guard below throws if this module is ever evaluated in a
 * browser. It is a **runtime** check, not a build-time one: it prevents
 * execution in client code, not bundling into it. A build-time boundary
 * would need the `server-only` package, which is not a dependency of this
 * repo — adding it is a separate decision, not part of this slice.
 * (`src/lib/auth/account.ts` gets its boundary for free by transitively
 * importing `next/headers`; this module imports nothing, so it has none.)
 *
 * ── Deliberately additive ───────────────────────────────────────
 * This does NOT centralise the ~15 existing `process.env` reads across the
 * codebase. Migrating those is a separate, larger change; doing it here
 * would make an infrastructure slice touch WhatsApp, AI and automation
 * paths at once. New code should prefer this loader.
 *
 * Feature-scoped variables (Meta/WhatsApp, AI tuning, cron secrets,
 * continuation signing, CORS origins) are intentionally NOT required here.
 * They gate individual features and belong to those features' own slices;
 * a deployment without WhatsApp configured should still boot and report
 * its real problem.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'src/lib/config/deployment.ts is server-only and must not run in the browser.',
  )
}

/**
 * Variables without which no request can be served. All four are read at
 * module load or on the first Supabase call, so a deployment missing any
 * of them is non-functional rather than degraded.
 */
export const REQUIRED_DEPLOYMENT_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENCRYPTION_KEY',
] as const

export type RequiredDeploymentKey = (typeof REQUIRED_DEPLOYMENT_KEYS)[number]

export type DeploymentConfig = Readonly<Record<RequiredDeploymentKey, string>> & {
  /** Redacts values on JSON serialisation only — see "Secret safety" above. */
  toJSON(): { configuredKeys: readonly string[] }
}

/** Thrown when one or more required variables are absent or blank. */
export class DeploymentConfigError extends Error {
  readonly missingKeys: readonly string[]

  constructor(missingKeys: readonly string[]) {
    super(
      `Deployment configuration invalid — missing or empty: ${missingKeys.join(', ')}`,
    )
    this.name = 'DeploymentConfigError'
    this.missingKeys = missingKeys
  }
}

/**
 * True when a raw env value cannot be used. Whitespace-only counts as
 * missing: a quoted blank in an env file is a configuration mistake, not
 * an intentional empty setting.
 */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

/**
 * Validate and return the deployment configuration.
 *
 * `env` is injectable so tests never touch the real `process.env`.
 * Throws {@link DeploymentConfigError} listing every missing key at once —
 * reporting them one per run would mean one redeploy per mistake.
 */
export function loadDeploymentConfig(
  env: NodeJS.ProcessEnv = process.env,
): DeploymentConfig {
  const missingKeys = REQUIRED_DEPLOYMENT_KEYS.filter((key) => isBlank(env[key]))

  if (missingKeys.length > 0) {
    throw new DeploymentConfigError(missingKeys)
  }

  const resolved = Object.fromEntries(
    REQUIRED_DEPLOYMENT_KEYS.map((key) => [key, env[key] as string]),
  ) as Record<RequiredDeploymentKey, string>

  return Object.freeze({
    ...resolved,
    toJSON: () => ({ configuredKeys: [...REQUIRED_DEPLOYMENT_KEYS] }),
  })
}
