import { createHash } from "node:crypto";
import type { NextConfig } from "next";
import { SERVER_ACTION_BODY_LIMIT } from "./src/lib/documents/limits";
import { THEME_BOOTSTRAP_SCRIPT } from "./src/lib/theme-bootstrap";

/**
 * Security response headers (app-layer security audit, finding M7).
 *
 * Measured against live production before this change: only
 * Strict-Transport-Security was present (Vercel's own default). No CSP, no
 * frame-ancestors control, no nosniff, no Referrer-Policy — so every
 * authenticated page was framable, and the dashboard carries one-click
 * destructive actions (deactivate client, cancel invoice, delete draft
 * invoice, revoke permission) that were all clickjackable.
 *
 * ── WHY THE CSP IS SPLIT IN TWO ─────────────────────────────────────────────
 * This ships an ENFORCED policy containing only the directives that cannot
 * break rendering, and the full script/connect policy as REPORT-ONLY.
 *
 * That split is not caution for its own sake — it is forced by how Next
 * renders. Next emits ~9 inline `self.__next_f.push(...)` bootstrap scripts per
 * page, whose contents vary per page and per build, so no static hash can cover
 * them. Next's own CSP guide
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)
 * gives exactly one supported answer — a per-request nonce injected via
 * proxy/middleware — and states plainly: "you **must use dynamic rendering** to
 * add nonces."
 *
 * This app deliberately prerenders `/`, `/login`, and `/signup` as static. A
 * nonce would make every route dynamic, which is a real architectural
 * trade-off (cold-start latency and cache behaviour on the unauthenticated
 * pages that matter most for a first impression), not a config tweak. It
 * deserves its own decision with its own testing, so it is NOT made here.
 *
 * What the enforced policy below still buys, with zero rendering risk:
 *   frame-ancestors  — closes the clickjacking finding outright
 *   form-action      — a form cannot be repointed at an attacker's origin
 *   base-uri         — a <base> tag cannot be injected to re-root relative URLs
 *   object-src       — no <object>/<embed> plugin content, which this app
 *                      never uses
 * None of these constrain script or connect sources, so none can block Next's
 * inline bootstrap or the app's own Supabase calls.
 *
 * The report-only header is the SAME policy the eventual enforced one should
 * be, minus the nonce. Point it at a collector (or read violations from the
 * browser console) to confirm the directive list is right before anyone does
 * the nonce work. It is observational: it blocks nothing.
 *
 * TO FINISH THIS: add the nonce in proxy/middleware per Next's guide, fold
 * `script-src`/`style-src`/`img-src`/`font-src`/`connect-src` from
 * `reportOnlyDirectives` into `enforcedDirectives`, accept the
 * dynamic-rendering cost, and delete the report-only header.
 */

/**
 * The one external origin the browser legitimately talks to: Supabase, for
 * auth token refresh, PostgREST reads, and signed storage URLs. Read from the
 * env var rather than hardcoded, so a project change cannot silently break the
 * app's own API calls. (The URL is already public — it ships in the client
 * bundle by design — so there is no secret in this file.)
 */
const supabaseOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
})();

/**
 * Hash of the inline theme-bootstrap script, computed from the SAME constant
 * layout.tsx renders — see src/lib/theme-bootstrap.ts for why they are shared
 * rather than duplicated. Only meaningful in the report-only policy today; it
 * is already correct for whenever script-src becomes enforced.
 */
const themeScriptHash = `'sha256-${createHash("sha256")
  .update(THEME_BOOTSTRAP_SCRIPT, "utf8")
  .digest("base64")}'`;

/** Enforced. Every directive here is rendering-safe — see the note above. */
const enforcedDirectives = [
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
];

/** Report-only. The intended full policy, pending the nonce work. */
const reportOnlyDirectives = [
  "default-src 'self'",
  // In development React uses eval for enhanced error stacks (Next's own CSP
  // guide says so explicitly); production needs neither eval nor unsafe-inline.
  `script-src 'self' ${themeScriptHash}${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  // Tailwind and next/font emit inline <style>. Inline CSS is not a
  // script-execution vector, and there is no style equivalent of the script
  // hash trick that survives their build output.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  // next/font/google self-hosts at build time — no runtime font origin needed.
  "font-src 'self'",
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  ...enforcedDirectives,
];

const securityHeaders = [
  { key: "Content-Security-Policy", value: enforcedDirectives.join("; ") },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyDirectives.join("; ") },
  // Belt-and-braces for anything that predates frame-ancestors support.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This app uses none of these; denying them costs nothing and shrinks the
  // surface a future XSS could reach for.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },

  experimental: {
    serverActions: {
      /**
       * Next's default is 1 MB (node_modules/next/dist/docs/01-app/
       * 03-api-reference/05-config/01-next-config-js/serverActions.md).
       * Nothing set it before, so the framework rejected any upload over 1 MB
       * BEFORE lib/documents/actions.ts's own 10 MB check could run — making
       * the friendly "File exceeds the 10MB size limit." message unreachable
       * and failing an ordinary 2 MB scanned PDF, the single most common thing
       * a CA firm uploads, with a raw framework error instead. See the
       * app-layer security audit, finding L5.
       *
       * Imported, never restated: SERVER_ACTION_BODY_LIMIT is derived from
       * MAX_DOCUMENT_SIZE in the same module the action checks against, so the
       * framework limit and the app limit cannot drift apart again. It carries
       * a deliberate 1 MB of slack over MAX_DOCUMENT_SIZE for the multipart
       * envelope and the sibling form fields, so a file of exactly the allowed
       * size does not trip the framework limit and reproduce the same problem
       * one byte later.
       */
      bodySizeLimit: SERVER_ACTION_BODY_LIMIT,
    },
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
