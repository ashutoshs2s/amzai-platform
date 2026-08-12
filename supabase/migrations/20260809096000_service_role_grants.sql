-- =============================================================================
-- Grant the service role its table privileges.
--
-- A bug in 20260809091000. That migration revoked everything from `anon` and
-- granted what `authenticated` needs, and said nothing at all about
-- `service_role`. Where Supabase's default privileges did not already cover
-- these tables, the service role ended up with no rights to them:
--
--   42501  permission denied for table users
--   hint:  GRANT SELECT ON public.users TO service_role;
--
-- BYPASSRLS is not a substitute for a grant. The service role skips row level
-- security, but it is still refused by the privilege system, so a policy-free
-- read fails just as hard as a policy-blocked one.
--
-- This is not cosmetic. Every client-facing route in SPEC.md sections 5 and 6
-- runs under the service role, because a client has no database identity: the
-- dashboard, the onboarding link request, the one-time token exchange and every
-- client-written answer. All of them would have failed exactly like the seed.
--
-- Default privileges are set too, so a table added by a later migration does
-- not reintroduce the same gap.
-- =============================================================================

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;

-- audit_events stays append-only for the service role as well. The triggers in
-- 20260809092000 already refuse update, delete and truncate whoever asks, but
-- a privilege that is never granted cannot be relied on being blocked further
-- down; both belong.
revoke update, delete, truncate on public.audit_events from service_role;

-- The restricted views exist for data_ops reading through the app. The service
-- role reads the base tables directly and has no use for them.
revoke all on public.organisations_restricted from service_role;
revoke all on public.programs_restricted from service_role;
