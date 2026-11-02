/**
 * "Pin it to the fridge" — the signed confirm binding. A pin proposal is review-only; a separate
 * parent confirmation is the only thing that pins it, and the HMAC signature binds EVERYTHING that
 * must not change between propose and confirm: caller, child, private asset, the exact caption and
 * fields, the audience, the kind, the version and the expiry. A changed audience (or caption, field,
 * child, asset, caller) invalidates the token. Stateless — no new DB table (contract §5, §7). The
 * idempotency key makes a confirm retry return the same pin, never a second.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Audience, PinExtracted, PinKind } from './pinTypes';

export type PinSignedClaims = {
  proposalId: string;
  version: number;
  callerId: string;
  childId: string;
  assetId: string;
  kind: PinKind;
  audience: Audience;
  captionHash: string;
  fieldsHash: string;
  expiresAt: string; // ISO
};

export type PinProposalEnvelope = {
  proposalId: string;
  version: number;
  expiresAt: string;
  claims: PinSignedClaims;
  signature: string;
};

/** Deterministic JSON (recursively sorted keys) — the canonical form we sign/hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

export function signClaims(claims: PinSignedClaims, key: string): string {
  return createHmac('sha256', key).update(canonicalJson(claims)).digest('hex');
}

export function verifyClaims(claims: PinSignedClaims, signature: string, key: string): boolean {
  const a = Buffer.from(signClaims(claims, key), 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** The audience and the exact fields are part of the signature via these hashes. */
export function captionHashOf(caption: string | null): string {
  return sha256(caption ?? '');
}
export function fieldsHashOf(extracted: PinExtracted): string {
  return sha256(extracted);
}

/**
 * Idempotency is bound to the EXACT PROPOSAL, not just the image: the key includes `proposalId` (and
 * `version`). Replaying one confirmation returns the same pin; two DISTINCT proposals for the same
 * image (different `proposalId`) are different pins and can never silently return each other's content
 * or audience. (Every `prepare` previously emitted `version:1`, so a caller+child+asset+version key
 * collided across proposals — fixed by keying on `proposalId`.)
 */
export function pinIdempotencyKey(claims: Pick<PinSignedClaims, 'callerId' | 'childId' | 'assetId' | 'proposalId' | 'version'>): string {
  return `pin:${claims.callerId}:${claims.childId}:${claims.assetId}:${claims.proposalId}:${claims.version}`;
}

export type BuildPinProposalInput = {
  proposalId: string;
  version: number;
  callerId: string;
  childId: string;
  assetId: string;
  kind: PinKind;
  audience: Audience;
  caption: string | null;
  extracted: PinExtracted;
  now: Date;
  ttlMs: number;
  signingKey: string;
};

export function buildPinProposal(input: BuildPinProposalInput): PinProposalEnvelope {
  const expiresAt = new Date(input.now.getTime() + input.ttlMs).toISOString();
  const claims: PinSignedClaims = {
    proposalId: input.proposalId,
    version: input.version,
    callerId: input.callerId,
    childId: input.childId,
    assetId: input.assetId,
    kind: input.kind,
    audience: input.audience,
    captionHash: captionHashOf(input.caption),
    fieldsHash: fieldsHashOf(input.extracted),
    expiresAt,
  };
  return { proposalId: input.proposalId, version: input.version, expiresAt, claims, signature: signClaims(claims, input.signingKey) };
}
