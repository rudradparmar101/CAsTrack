# Deployment — Vercel Production environment variables

Reference table of every environment variable this app reads, sourced directly from
`process.env.*` usages in `src/`. Keep this in sync when a new one is added — grep for
`process.env\.[A-Z_]+` in `src/` to re-derive it if this file drifts.

See `docs/DECISIONS.md`'s "Operational knowledge" section for the specific incidents
(silent Resend 403s, stale `NEXT_PUBLIC_SITE_URL`, accidental test-recipient redirects)
that made several of the "what breaks" columns below worth writing down.

## Required for core functionality

| Variable | Correct value / format | Build-time or runtime? | What breaks if missing or wrong |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The live CA-firm Supabase project URL (`https://<project-ref>.supabase.co`) | Build-time (bundled into every client + server bundle, `NEXT_PUBLIC_*` prefix) | Nothing works — every Supabase client (`lib/supabase/client.ts`, `server.ts`, `admin.ts`, `middleware.ts`) fails to construct. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The project's anon/public key | Build-time | Same as above — auth, all RLS-scoped reads/writes, and middleware session handling all fail. |
| `SUPABASE_SERVICE_ROLE_KEY` | The project's service-role (secret) key | Runtime | `lib/supabase/admin.ts` (provisioning, cron routes, admin-API scripts) fails. **Never expose to the client bundle — no `NEXT_PUBLIC_` prefix, by design.** Never commit it; `.env.local` is gitignored specifically to keep this out of git history. |
| `NEXT_PUBLIC_SITE_URL` | `https://praxida.in` — **no trailing space** | **Build-time** (bundled wherever it's referenced — signup emails, forgot-password links, portal invite links, billing invoice-issued emails, reminder cron emails) | Emails/links built from it point at the wrong host (or a broken one with a trailing-space artifact) until the **next deploy** — setting it in the Vercel dashboard alone does nothing; a build must actually run. Used in `signup/actions.ts`, `forgot-password/actions.ts`, `clients/portal-actions.ts`, `billing/actions.ts`, `lib/tasks/activity.ts`, `api/cron/send-reminders/route.ts`. |
| `RESEND_API_KEY` | A valid Resend API key | Runtime | `sendEmail()` (`lib/email/resend.ts`) silently no-ops (logs `[email] RESEND_API_KEY not configured — skipping send` and returns) — every invite, notification, and reminder email is dropped with no user-facing error, since sending is deliberately fire-and-forget. |
| `RESEND_FROM_EMAIL` | A "From" address on the **verified subdomain**, e.g. `Praxida <noreply@mail.praxida.in>` | Runtime | If unset, falls back to Resend's shared `onboarding@resend.dev` test sender (only delivers to the Resend account owner's own inbox — fine for dev, useless in production). **If set to an address on the bare `praxida.in` domain (not `mail.praxida.in`), every send 403s** — that domain is not verified in Resend. This failure is silent: `sendEmail()` only logs `[email] Send failed`, nothing surfaces to a user or an alert. See `docs/DECISIONS.md`. |
| `CRON_SECRET` | A real, randomly-generated production secret (the value in `.env.local` is a local-only placeholder — must be a fresh value in Vercel, not copied from `.env.local`) | Runtime | `/api/cron/generate-statutory-tasks` and `/api/cron/send-reminders` both reject with 401 if the bearer token doesn't match — statutory task generation and reminder emails simply never run. Also requires a `vercel.json` `crons` entry pointing at both routes with a matching `Authorization: Bearer <CRON_SECRET>` header; the routes existing alone does not schedule them. |

## Must NOT be set in Production

| Variable | What it does when set | Why it must stay unset in Production |
|---|---|---|
| `RESEND_TEST_RECIPIENT` | Redirects **every** outbound email (invites, assignment/review/rejection/completion notifications, statutory reminders, waiting-client nags, invoice-issued emails) to this one address, regardless of the real recipient, prefixing the subject with `[to: real@address]` | It's a dev/pre-verified-domain testing aid only. Left set in Production, real clients and staff never receive their emails — they all silently land in one internal inbox instead. |

## Optional / adjacent integrations

| Variable | Correct value / format | Build-time or runtime? | What breaks if missing or wrong |
|---|---|---|---|
| `TG_TOKEN` | A Telegram bot token | Runtime | `notifyTelegram()` (`lib/notifyTelegram.ts`) silently no-ops if either `TG_TOKEN` or `TG_CHAT` is unset — it's explicitly designed never to throw, so a missing value just means no Telegram notification is sent, nothing else is affected. |
| `TG_CHAT` | The target chat ID | Runtime | Same as `TG_TOKEN` — both are required together or the notification is skipped. |
| `TG_WEBHOOK_SECRET` | A secret used to validate incoming Telegram webhook calls | Runtime | Gates `api/telegram/webhook/route.ts`; if unset or mismatched, incoming Telegram webhook calls are rejected. |

## Notes

- `NEXT_PUBLIC_*` variables are **compiled into the JavaScript bundle at build time**.
  Changing one in the Vercel dashboard has zero effect on an already-built deployment —
  the next build/deploy must actually run for the new value to take effect anywhere.
- Everything else above is read at **request/runtime** via `process.env` inside server
  code (server actions, API routes, cron routes) — a value change takes effect on the next
  invocation, no rebuild required, though Vercel functions may need a redeploy to pick up
  new env vars depending on your Vercel project settings.
- Before setting `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET` anywhere, confirm they are
  not the same values present in the local, gitignored `.env.local` — those are dev-only
  and should not be reused as the production secrets.
- `.env.local` must never be committed. Before any push to a remote, verify it's
  gitignored and absent from git history entirely (`git log --all -- .env.local`) — if it
  was ever committed, key rotation is required, not just a `.gitignore` fix after the
  fact.
