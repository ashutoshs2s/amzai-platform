-- =============================================================================
-- Pin search_path on the remaining helper functions.
--
-- A function without a pinned search_path resolves unqualified names using
-- whatever search_path the caller happens to have set. The attack is to create
-- a schema containing something that shadows a built-in, put it first on your
-- search_path, and wait for a privileged function to call it.
--
-- None of these five is SECURITY DEFINER, so the ceiling on that attack is low.
-- Pinning them anyway costs nothing, clears the advisor warning, and means the
-- next person to add SECURITY DEFINER to one of them does not inherit a hole.
--
-- Set to the empty string rather than to `public`: every name these five use is
-- either a built-in, which resolves from pg_catalog regardless, or already
-- schema-qualified. Nothing is left to be resolved by search.
--
-- ALTER FUNCTION rather than CREATE OR REPLACE, because
-- sub_vertical_belongs_to() is referenced by check constraints on two tables
-- and there is no reason to touch a body that is not changing.
-- =============================================================================

alter function public.set_updated_at() set search_path = '';
alter function public.sub_vertical_belongs_to(text, text) set search_path = '';
alter function public.set_actor(text, uuid, uuid) set search_path = '';
alter function public.redact_secrets(jsonb) set search_path = '';
alter function public.audit_events_are_append_only() set search_path = '';
