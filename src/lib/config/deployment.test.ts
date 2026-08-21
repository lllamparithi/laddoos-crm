import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DeploymentConfigError,
  REQUIRED_DEPLOYMENT_KEYS,
  loadDeploymentConfig,
} from './deployment'

/**
 * No network, no database, no credentials, no production access. Every
 * value below is an obvious non-secret placeholder — never a real key,
 * and never shaped like one.
 */
const PLACEHOLDER = 'test-value-not-a-secret'

function validEnv(overrides: Record<string, string | undefined> = {}) {
  const base = Object.fromEntries(
    REQUIRED_DEPLOYMENT_KEYS.map((key) => [key, PLACEHOLDER]),
  )
  return { ...base, ...overrides } as NodeJS.ProcessEnv
}

describe('loadDeploymentConfig — present configuration', () => {
  it('returns every required key when all are set', () => {
    const config = loadDeploymentConfig(validEnv())
    for (const key of REQUIRED_DEPLOYMENT_KEYS) {
      expect(config[key]).toBe(PLACEHOLDER)
    }
  })

  it('ignores unrelated variables rather than failing on them', () => {
    const config = loadDeploymentConfig(
      validEnv({ SOME_FEATURE_FLAG: 'on' } as Record<string, string>),
    )
    expect(config.ENCRYPTION_KEY).toBe(PLACEHOLDER)
  })

  it('trims nothing — a real value is returned verbatim', () => {
    const config = loadDeploymentConfig(
      validEnv({ NEXT_PUBLIC_SUPABASE_URL: ' https://example.test ' }),
    )
    expect(config.NEXT_PUBLIC_SUPABASE_URL).toBe(' https://example.test ')
  })
})

describe('loadDeploymentConfig — missing configuration', () => {
  it('throws when a required key is absent', () => {
    expect(() =>
      loadDeploymentConfig(validEnv({ ENCRYPTION_KEY: undefined })),
    ).toThrow(DeploymentConfigError)
  })

  it('reports every missing key at once, not just the first', () => {
    try {
      loadDeploymentConfig(
        validEnv({
          ENCRYPTION_KEY: undefined,
          SUPABASE_SERVICE_ROLE_KEY: undefined,
        }),
      )
      throw new Error('expected loadDeploymentConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigError)
      expect((error as DeploymentConfigError).missingKeys).toEqual([
        'SUPABASE_SERVICE_ROLE_KEY',
        'ENCRYPTION_KEY',
      ])
    }
  })
})

describe('loadDeploymentConfig — empty configuration is missing', () => {
  // The deployed `.env.local` has shipped an unconfigured placeholder
  // before; an empty string must fail exactly like an absent key.
  it.each([
    ['empty string', ''],
    ['single space', ' '],
    ['tab and newline', '\t\n'],
  ])('treats %s as missing', (_label, value) => {
    try {
      loadDeploymentConfig(validEnv({ NEXT_PUBLIC_SUPABASE_URL: value }))
      throw new Error('expected loadDeploymentConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(DeploymentConfigError)
      expect((error as DeploymentConfigError).missingKeys).toEqual([
        'NEXT_PUBLIC_SUPABASE_URL',
      ])
    }
  })
})

describe('secret safety', () => {
  it('never puts a value in the error message', () => {
    const secretish = 'super-secret-do-not-log'
    try {
      loadDeploymentConfig(
        validEnv({
          NEXT_PUBLIC_SUPABASE_ANON_KEY: secretish,
          ENCRYPTION_KEY: undefined,
        }),
      )
      throw new Error('expected loadDeploymentConfig to throw')
    } catch (error) {
      const text = `${(error as Error).message} ${(error as Error).stack ?? ''}`
      expect(text).not.toContain(secretish)
      expect(text).toContain('ENCRYPTION_KEY')
    }
  })

  // Scope note: toJSON covers JSON serialisation only. util.inspect
  // (console.log) ignores it, so this is NOT a general logging guard —
  // see the module header.
  it('redacts values during JSON serialisation', () => {
    const config = loadDeploymentConfig(
      validEnv({ ENCRYPTION_KEY: 'super-secret-do-not-log' }),
    )
    const serialised = JSON.stringify(config)
    expect(serialised).not.toContain('super-secret-do-not-log')
    expect(JSON.parse(serialised)).toEqual({
      configuredKeys: [...REQUIRED_DEPLOYMENT_KEYS],
    })
  })

  it('does not redact on direct property access — discipline still required', () => {
    const config = loadDeploymentConfig(
      validEnv({ ENCRYPTION_KEY: 'super-secret-do-not-log' }),
    )
    // Documents the real boundary of toJSON: reading a property still
    // yields the credential, by design.
    expect(config.ENCRYPTION_KEY).toBe('super-secret-do-not-log')
  })
})

describe('server-only boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('throws if the module is evaluated in a browser', async () => {
    vi.stubGlobal('window', {})
    vi.resetModules()
    await expect(import('./deployment')).rejects.toThrow(/server-only/)
  })

  it('imports cleanly in a server runtime', async () => {
    vi.resetModules()
    await expect(import('./deployment')).resolves.toBeDefined()
  })
})
