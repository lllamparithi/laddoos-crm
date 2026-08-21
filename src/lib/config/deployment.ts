/**
 * Deployment configuration contract for a single-tenant YALI Omni
 * deployment (one customer, one database, one credential set).
 *
 * Why this exists: the same core image is deployed per customer, so a
 * misconfigured deployment must fail loudly and immediately rather than
 * surfacing later as a confusing runtime error. `.env.local`'s
 * `NEXT_PUBLIC_SUPABASE_URL` shipping as an unconfigured placeholder has
 * already cost debugging time — a present-but-empty value is exactly as
 * broken as an absent one, so both are treated as missing here.
 *
 * ── Secret safety ────────────────────────────────────────────────
 * Validation reports **key names only, never values**. `DeploymentConfigError`
 * carries `missingKeys`; nothing in this module puts a value into a message.
 * The returned object also defines `toJSON()` so an accidental
 * `JSON.stringify(config)` or structured-log call emits key names instead of
 * credentials. That is deliberate: the object holds real secrets and is
 * server-only.
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
  /** Redacts values — see "Secret safety" above. */
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
