# OAuth verification — 7 September 2026

## Passed

- 14 Node tests for the OAuth handlers, encrypted cookies, CSRF state, origin checks,
  cancellation, account selection, permission failures, pagination and sanitized errors.
  Meta and Supabase HTTP responses are mocked in these tests.
- TypeScript type checking and the production Next.js/Turbopack build.
- Migration `20260907160848_content_hub_meta_oauth_batch.sql` applied to project
  `ntdqqzqgkylxixivkmrp`.
- `tests/meta-oauth-database.sql` executed against that database in a transaction
  ending with ROLLBACK. Owner access, idempotent reconnect, atomic rollback,
  cross-organization denial, editor denial, anonymous denial, invoker security and
  encrypted token round trips passed. No publish jobs were created.

## Remaining verification

The production site's login page loads in the browser. The authenticated account-selection
screen has not been verified visually because this browser has no MediaGrow session.
Real Meta OAuth, provider permissions, external-client access and actual publishing remain
untested. Follow [the setup guide](meta-oauth-setup.md) after configuring the App Secret.

## Existing database advisories

The security advisor returned the same six warnings before and after the migration:

- One [extension in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)
  warning for `pg_net`.
- Four [authenticated SECURITY DEFINER function](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
  warnings for the existing `bootstrap_workspace`, `create_brand`, `connect_social_account`
  and `schedule_content` RPCs. The new batch RPC is SECURITY INVOKER.
- [Leaked password protection is disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

These existing settings were not changed by this OAuth patch.
