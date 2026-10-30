/**
 * Server-side session minting. Supabase Auth issues every session; this module never signs a token
 * and never invents an identity.
 *
 * THE PATH (primary, and the only one implemented):
 *   admin.generateLink({ type: 'magiclink', email })   service role, server-side, no password
 *   verifyOtp({ token_hash, type: 'magiclink' })       one fresh publishable-key client per request
 *
 * The password fallback described in the task design is NOT implemented, because the primary path
 * works on this project (proven in ops/e2-mint-probe.mjs). That keeps the rule intact: no server
 * reads `.demo-credentials`, and no password exists in any request path.
 *
 * ISOLATION: both clients are created per call with persistSession:false, autoRefreshToken:false,
 * detectSessionInUrl:false. There is no module-level client and no shared mutable session state, so
 * two simultaneous logins cannot see each other's session.
 *
 * CREDENTIAL HYGIENE: the link, the OTP, the token hash and both tokens are credentials. Nothing in
 * this file logs them, and errors are reduced to a code.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { identityMapPath, type DemoPersona } from './personas';

export type MintedSession = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
};

export class MintError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MintError';
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new MintError('DEMO_LOGIN_UNAVAILABLE');
  return value;
}

/** The sub -> personId map, re-read so a seed run needs no restart. Never returned to a client. */
function mappedPersonId(sub: string): string | undefined {
  const path = identityMapPath();
  if (!existsSync(path)) return undefined;
  try {
    const map = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    return map[sub];
  } catch {
    return undefined;
  }
}

/**
 * Mints one real session for an allow-listed persona.
 *
 * Refuses, rather than degrading: a mint whose subject does not map to the requested person, or
 * whose token lacks the demo marker, is an error — never a session for somebody else.
 */
export async function mintSession(persona: DemoPersona): Promise<MintedSession> {
  const url = required('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const publishableKey = required('SUPABASE_PUBLISHABLE_KEY');

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: persona.email });
  if (link.error || !link.data?.properties?.hashed_token) {
    throw new MintError('MINT_LINK_FAILED');
  }

  const verified = await anon.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: 'magiclink',
  });
  if (verified.error || !verified.data?.session || !verified.data?.user) {
    throw new MintError('MINT_VERIFY_FAILED');
  }

  const { session, user } = verified.data;

  // The session must belong to the persona that was asked for. No substitution, ever.
  if (mappedPersonId(user.id) !== persona.personId) {
    throw new MintError('MINT_IDENTITY_MISMATCH');
  }

  // And it must carry the trusted marker; an unmarked token would be a normal session, not a demo.
  if (user.app_metadata?.demo !== true) {
    throw new MintError('MINT_MARKER_MISSING');
  }
  const isGuide = persona.id === 'demo-guide';
  if (isGuide !== (user.app_metadata?.demo_guide === true)) {
    throw new MintError('MINT_MARKER_MISSING');
  }

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type ?? 'bearer',
    expires_in: session.expires_in,
    expires_at: session.expires_at ?? 0,
  };
}
