import { describe, expect, it } from 'vitest'
import {
  generateTokenId,
  buildContinuationTokenRef,
  parseContinuationTokenRef,
  verifyContinuationTokenRef,
  hashTokenId,
} from './sign'

const secret = 'test-signing-secret'

describe('buildContinuationTokenRef / verifyContinuationTokenRef', () => {
  it('round-trips: a freshly built ref verifies and returns the same token id', () => {
    const tokenId = generateTokenId()
    const ref = buildContinuationTokenRef(tokenId, secret)
    const verified = verifyContinuationTokenRef(ref, secret)
    expect(verified).not.toBeNull()
    expect(verified?.equals(tokenId)).toBe(true)
  })

  it('has the exact v1.<id>.<sig> shape', () => {
    const ref = buildContinuationTokenRef(generateTokenId(), secret)
    expect(ref.split('.')).toHaveLength(3)
    expect(ref.startsWith('v1.')).toBe(true)
  })

  it('rejects a ref signed with a different secret', () => {
    const ref = buildContinuationTokenRef(generateTokenId(), secret)
    expect(verifyContinuationTokenRef(ref, 'wrong-secret')).toBeNull()
  })

  it('rejects a tampered token id (forwarded-attack shape: flip one char)', () => {
    const ref = buildContinuationTokenRef(generateTokenId(), secret)
    const [v, id, sig] = ref.split('.')
    const tamperedId = id[0] === 'A' ? 'B' + id.slice(1) : 'A' + id.slice(1)
    expect(verifyContinuationTokenRef(`${v}.${tamperedId}.${sig}`, secret)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const ref = buildContinuationTokenRef(generateTokenId(), secret)
    const [v, id, sig] = ref.split('.')
    const tamperedSig = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1)
    expect(verifyContinuationTokenRef(`${v}.${id}.${tamperedSig}`, secret)).toBeNull()
  })

  it('rejects an unknown version prefix', () => {
    expect(verifyContinuationTokenRef('v2.abc.def', secret)).toBeNull()
  })

  it('rejects a malformed ref (wrong segment count) without throwing', () => {
    expect(verifyContinuationTokenRef('not-a-ref', secret)).toBeNull()
    expect(verifyContinuationTokenRef('v1.onlyonepart', secret)).toBeNull()
    expect(verifyContinuationTokenRef('v1.a.b.c', secret)).toBeNull()
  })

  it('rejects non-base64url garbage without throwing', () => {
    expect(verifyContinuationTokenRef('v1.!!!not-base64!!!.sig', secret)).toBeNull()
  })
})

describe('parseContinuationTokenRef', () => {
  it('parses a well-formed ref structurally, independent of signature validity', () => {
    const ref = buildContinuationTokenRef(generateTokenId(), secret)
    const parsed = parseContinuationTokenRef(ref)
    expect(parsed).not.toBeNull()
    expect(parsed?.version).toBe('v1')
  })

  it('still parses even when the signature itself is wrong', () => {
    const ref = buildContinuationTokenRef(generateTokenId(), secret)
    const [v, id, sig] = ref.split('.')
    const tamperedSig = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1)
    expect(parseContinuationTokenRef(`${v}.${id}.${tamperedSig}`)).not.toBeNull()
  })
})

describe('hashTokenId', () => {
  it('is deterministic for the same token id', () => {
    const tokenId = generateTokenId()
    expect(hashTokenId(tokenId)).toBe(hashTokenId(tokenId))
  })

  it('differs for different token ids', () => {
    expect(hashTokenId(generateTokenId())).not.toBe(hashTokenId(generateTokenId()))
  })

  it('never reveals the raw token id (not a substring of the hash)', () => {
    const tokenId = generateTokenId()
    const hash = hashTokenId(tokenId)
    expect(hash).not.toContain(tokenId.toString('hex'))
    expect(hash).not.toContain(tokenId.toString('base64url'))
  })
})
