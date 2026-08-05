// ============================================================
// Continuation-token signing — pure, server-side.
//
// Format (docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §4.1):
//
//   yali_ref = v1.<token_id_base64url>.<hmac_sha256_sig_base64url>
//
//   token_id = 16 random bytes (CSPRNG). Carries no meaning.
//   sig      = HMAC-SHA256(secret, "v1." + base64url(token_id)),
//              truncated to the first 16 bytes.
//
// The signature covers the exact string that precedes it in the ref
// (the "v1.<token_id>" prefix), not the raw token_id bytes — the same
// "sign what you send" principle src/lib/webhooks/sign.ts already
// follows for outbound webhook payloads, so verification never has to
// guess at an encoding.
//
// This module takes `secret` as an explicit parameter rather than
// reading an env var internally (mirroring webhooks/sign.ts, not
// whatsapp/webhook-signature.ts) — pure functions are trivially
// testable without env mocking; the one call site that needs the real
// secret (continuation/service.ts) reads and validates it once.
//
// The raw token is never stored anywhere — only hashTokenId()'s output
// (sha256 of the token_id), following the phone_hash precedent set in
// migration 038. The HMAC signature and the storage hash are
// deliberately different digests over different inputs: the signature
// authenticates the ref the client presents; the hash is the DB lookup
// key. Reusing one for the other would let a stolen DB row forge a
// valid-looking ref.
// ============================================================

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const VERSION = 'v1'
const TOKEN_ID_BYTES = 16
const SIG_BYTES = 16

export function generateTokenId(): Buffer {
  return randomBytes(TOKEN_ID_BYTES)
}

function signedPrefix(tokenId: Buffer): string {
  return `${VERSION}.${tokenId.toString('base64url')}`
}

function computeSignature(tokenId: Buffer, secret: string): Buffer {
  return createHmac('sha256', secret).update(signedPrefix(tokenId)).digest().subarray(0, SIG_BYTES)
}

/** Builds the full opaque ref to embed in a URL (`?yali_ref=<this>`). */
export function buildContinuationTokenRef(tokenId: Buffer, secret: string): string {
  const sig = computeSignature(tokenId, secret)
  return `${signedPrefix(tokenId)}.${sig.toString('base64url')}`
}

/** sha256(token_id) hex — the DB lookup key. The raw token_id is never stored. */
export function hashTokenId(tokenId: Buffer): string {
  return createHash('sha256').update(tokenId).digest('hex')
}

interface ParsedRef {
  version: string
  tokenId: Buffer
  sig: Buffer
}

/**
 * Structural parse only — does NOT verify the signature. Exposed
 * separately from verifyContinuationTokenRef() so a caller can log "not
 * even a well-formed ref" distinctly in a debug context, without ever
 * exposing that distinction to the resolver's own response (§4.1 step
 * 1-2: malformed and invalid-signature both resolve to the same 404).
 */
export function parseContinuationTokenRef(ref: string): ParsedRef | null {
  const parts = ref.split('.')
  if (parts.length !== 3) return null
  const [version, tokenIdB64, sigB64] = parts
  if (version !== VERSION) return null
  try {
    const tokenId = Buffer.from(tokenIdB64, 'base64url')
    const sig = Buffer.from(sigB64, 'base64url')
    if (tokenId.length !== TOKEN_ID_BYTES || sig.length !== SIG_BYTES) return null
    return { version, tokenId, sig }
  } catch {
    return null
  }
}

/**
 * Full verification: parse, recompute the expected signature, compare
 * in constant time. Returns the raw token_id bytes on success (the
 * caller hashes them via hashTokenId() to do the DB lookup) or null on
 * any failure — malformed, wrong version, or bad signature are all
 * indistinguishable to the caller, deliberately (see the module comment
 * and docs/PHASE2_IDENTITY_RESOLUTION_ARCHITECTURE.md §11: the resolve
 * endpoint must not become an oracle).
 */
export function verifyContinuationTokenRef(ref: string, secret: string): Buffer | null {
  const parsed = parseContinuationTokenRef(ref)
  if (!parsed) return null

  const expected = computeSignature(parsed.tokenId, secret)
  if (expected.length !== parsed.sig.length) return null
  if (!timingSafeEqual(expected, parsed.sig)) return null

  return parsed.tokenId
}
