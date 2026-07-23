/**
 * Allow-list a caller-supplied `next` parameter down to an internal path
 * (app-layer security audit, finding L1).
 *
 * The bug this closes, proved during the audit by executing the concatenation
 * rather than reasoning about it: `/auth/callback` and `/auth/confirm` both
 * built their redirect as `${origin}${next}` with `next` straight from the
 * query string.
 *
 *   origin + '/dashboard'  -> https://praxida.in/dashboard   host: praxida.in
 *   origin + '//evil.com'  -> https://praxida.in//evil.com   host: praxida.in
 *   origin + '@evil.com'   -> https://praxida.in@evil.com    host: EVIL.COM
 *
 * The last one is the whole finding: `praxida.in` becomes the URL's *userinfo*
 * and `evil.com` becomes the host. Severity was LOW only because the redirect
 * fires solely AFTER a successful exchangeCodeForSession/verifyOtp, so an
 * attacker needs a valid one-time code or token — the realistic chain being to
 * mint one for their own account and send a victim a link that signs them in
 * as the attacker and then bounces them off-site. Cheap to close regardless.
 *
 * The rule is an ALLOW-LIST, not a blocklist of the known-bad shapes: the value
 * must begin with exactly one `/` and contain nothing that could make a URL
 * parser read a host, or make a header parser read a new header. Anything else
 * falls back to a caller-supplied internal default — so a shape nobody thought
 * of fails closed instead of needing a new rule.
 */

/** True if the string contains any C0 control character or DEL. */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Return `candidate` if it is unambiguously a path on this origin, otherwise
 * `fallback` (which callers always supply as a literal internal path).
 */
export function safeInternalPath(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback;

  // Reject control characters before inspecting anything else — a CR or LF in
  // a Location header is a response-splitting primitive regardless of whether
  // the rest of the value parses as a path.
  if (hasControlCharacters(candidate)) return fallback;

  // Must start with exactly one '/'. This single rule rejects, in one stroke:
  //   '@evil.com'          userinfo trick — the actual finding
  //   'https://evil.com'   absolute
  //   'evil.com'           bare host
  //   'javascript:alert(1)' scheme-relative
  //   '//evil.com'         protocol-relative
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//')) return fallback;

  // Backslashes anywhere are rejected outright: browsers normalise '\' to '/'
  // inside URLs, so '/\evil.com' and friends are host-bearing in practice even
  // though they read like paths.
  if (candidate.includes('\\')) return fallback;

  return candidate;
}
