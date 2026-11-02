/**
 * Client IP resolution behind a trusted proxy.
 *
 * THE TRAP (2026-11-02, hosting scope)
 * Behind cloudflared every request arrives with socket peer `127.0.0.1`, so a loopback check admits
 * EVERYTHING and provides no public protection at all. `X-Forwarded-For` is likewise attacker-controlled
 * unless the peer is a proxy we actually trust — reading it unconditionally would let any caller claim
 * any address, including one that looks loopback.
 *
 * The rule implemented here:
 *   - socket peer NOT in the trusted set  → the header is spoofed input; return the socket peer;
 *   - socket peer IS trusted              → walk X-Forwarded-For from the RIGHT, skipping trusted hops,
 *                                           and return the first untrusted hop (the real client);
 *   - every hop trusted                   → the peer itself (no client identity to recover).
 *
 * Right-to-left is the only correct direction: the left-most entries are whatever the client chose to
 * send, and only the hops appended by infrastructure we control can be believed.
 */

export const DEFAULT_TRUSTED_PROXIES: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function resolveClientIp(
  socketAddress: string,
  forwardedFor: string | undefined | null,
  trustedProxies: ReadonlySet<string> = DEFAULT_TRUSTED_PROXIES,
): string {
  if (!trustedProxies.has(socketAddress)) return socketAddress;
  const hops = String(forwardedFor ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    if (!trustedProxies.has(hops[i])) return hops[i];
  }
  return socketAddress;
}

/** A proxy chain we cannot resolve to a non-proxy address is not a client identity. */
export function isResolvedClient(ip: string, trustedProxies: ReadonlySet<string> = DEFAULT_TRUSTED_PROXIES): boolean {
  return !trustedProxies.has(ip);
}
