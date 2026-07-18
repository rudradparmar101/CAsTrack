# Legacy DeadlineTracker artifacts — reference only, DO NOT APPLY

This directory holds the **original DeadlineTracker** schema, migrations, cron job, and edge function — the codebase this project was forked from before the Praxida rewrite (see `REFERENCE_ARCHITECTURE.md` at the repo root for the full original architecture writeup).

None of this reflects the current data model. The live database is defined entirely by `supabase/ca-firm/schema.sql` and `supabase/ca-firm/ROLES_AND_RLS.md` — that is the only schema source of truth for this project.

**Do not run, import, or apply anything in this directory against the live Supabase project.** It is kept only as a reference for how the original DeadlineTracker modeled auth, tasks, and notifications, in case that history is useful while porting or comparing behavior.

Contents:
- `schema.sql` — original DeadlineTracker schema (`organizations`/`teams`/`role IN ('admin','member')` model).
- `migrations/` — two follow-up migrations against that old schema.
- `cron.sql` — the old reminder cron job definition.
- `fix-rls-policies.sql` — an ad-hoc RLS patch script against the old schema.
- `functions/send-reminders/` — a Deno edge function (Resend email reminders) written against the old `tasks`/`organizations` shape; superseded by the CA schema's notification/reminder design (Phase 11).
