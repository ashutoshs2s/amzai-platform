-- =============================================================================
-- The magic-link request flow, and the identity problem it has to solve.
--
-- Client-facing routes run under the service role on client.amzai.events, so
-- auth.uid() is null. The audit trigger falls back to actor_type 'system', and
-- set_actor() is transaction-scoped while each PostgREST call is its own
-- transaction — so a route calling set_actor and then writing would lose the
-- setting in between and attribute every client action to nobody.
--
-- The rule these functions follow: ONE CLIENT WRITE IS ONE FUNCTION IS ONE
-- TRANSACTION. set_actor is called inside the body, so the setting is still
-- live when the row triggers fire. Its transaction-local scope is also what
-- makes it safe behind a connection pooler: it dies at commit and cannot leak
-- onto the next request that borrows the connection.
--
-- Identity is derived from the token, never taken as an argument. A function
-- accepting p_contact_id and trusting it would let anything holding the service
-- role attribute a write to any contact. These look the contact up FROM the
-- token row, so attribution is a consequence of proving possession.
--
-- SECURITY INVOKER, not DEFINER. The service role already bypasses row level
-- security, so these need no privileges of their own; anything less privileged
-- calling them still meets RLS. Rule 3 stays intact and this is simply the one
-- surface where a token check is the access control.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Attempts, which is what rate limiting counts
--
-- Every attempt is recorded, matched or not. Counting client_link_requests
-- would only count attempts that FOUND a contact, which is precisely backwards:
-- the attacker enumerating addresses is the one whose attempts never match, and
-- they would have been the only person not rate limited.
--
-- The address is stored as a bucket rather than in full. Somebody typing an
-- address that is not a contact has not consented to Amzai keeping it, and a
-- counter does not need to know what it is counting. md5 is used deliberately:
-- this is a bucket key, not a secret, and it avoids a pgcrypto dependency.
-- -----------------------------------------------------------------------------

create table if not exists public.client_link_attempts (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid references public.programs (id) on delete cascade,
  /** md5 of the lowercased, trimmed address. Never the address itself. */
  email_bucket text not null,
  request_ip   inet,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.client_link_attempts is
  'One row per link request attempt, whether or not the address matched a contact. What the rate limit counts. Holds a bucket of the address, never the address.';

create index if not exists client_link_attempts_email_idx
  on public.client_link_attempts (email_bucket, created_at desc);
create index if not exists client_link_attempts_ip_idx
  on public.client_link_attempts (request_ip, created_at desc);

alter table public.client_link_attempts enable row level security;
grant select, insert on public.client_link_attempts to authenticated;
grant all privileges on public.client_link_attempts to service_role;
revoke all on public.client_link_attempts from anon;

drop policy if exists client_link_attempts_select on public.client_link_attempts;
create policy client_link_attempts_select on public.client_link_attempts
  for select to authenticated using ((select public.is_admin()));

drop policy if exists client_link_attempts_write on public.client_link_attempts;
create policy client_link_attempts_write on public.client_link_attempts
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

do $$
begin
  execute 'drop trigger if exists set_updated_at on public.client_link_attempts';
  execute 'create trigger set_updated_at before update on public.client_link_attempts
             for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists record_audit on public.client_link_attempts';
  execute 'create trigger record_audit after insert or update or delete
             on public.client_link_attempts
             for each row execute function public.record_audit_event()';
end;
$$;


-- -----------------------------------------------------------------------------
-- 2. Requesting a link
--
-- Public and unauthenticated, which makes it two things at once: an
-- email-sending machine pointed at Amzai's domain reputation, and an address
-- oracle — send to a hundred addresses, see which ones receive something, and
-- you have learned who the client's people are.
--
-- Both are answered here rather than in the route, so a route written in a
-- hurry cannot skip either. The limits are five per address per hour and twenty
-- per IP per hour.
--
-- The return value is the same shape whether the address matched, did not
-- match, or was rate limited. The caller cannot tell them apart and therefore
-- cannot leak the difference even by accident. Only whether to send an email
-- differs, and that is a fact the route needs and the browser never sees.
-- -----------------------------------------------------------------------------

create or replace function public.request_client_link(
  p_program_id   uuid,
  p_email        text,
  p_token_hash   text,
  p_expires_at   timestamptz,
  p_request_ip   inet default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  -- Five per address per hour, twenty per IP per hour.
  c_email_limit constant integer := 5;
  c_ip_limit    constant integer := 20;

  v_bucket   text := md5(lower(trim(coalesce(p_email, ''))));
  v_by_email integer;
  v_by_ip    integer;
  v_contact  uuid;
begin
  /*
    Recorded before anything is decided, so a refused attempt still counts
    towards the limit. Counting only successful ones would let somebody hold
    the door open indefinitely by always failing.
  */
  insert into public.client_link_attempts (program_id, email_bucket, request_ip)
  values (p_program_id, v_bucket, p_request_ip);

  select count(*) into v_by_email
  from public.client_link_attempts
  where email_bucket = v_bucket
    and created_at > clock_timestamp() - interval '1 hour';

  if v_by_email > c_email_limit then
    return jsonb_build_object('issued', false);
  end if;

  if p_request_ip is not null then
    select count(*) into v_by_ip
    from public.client_link_attempts
    where request_ip = p_request_ip
      and created_at > clock_timestamp() - interval '1 hour';

    if v_by_ip > c_ip_limit then
      return jsonb_build_object('issued', false);
    end if;
  end if;

  -- An address is a contact only on the programme it was named for. A contact
  -- of one client cannot request a link to another's onboarding.
  select id into v_contact
  from public.client_contacts
  where program_id = p_program_id
    and lower(email) = lower(trim(coalesce(p_email, '')))
    and active;

  if v_contact is null then
    return jsonb_build_object('issued', false);
  end if;

  -- Inside the function, so it is still set when the trigger below fires.
  perform public.set_actor('client_contact', null, v_contact);

  insert into public.client_link_requests
    (program_id, client_contact_id, token_hash, expires_at, request_ip)
  values
    (p_program_id, v_contact, p_token_hash, p_expires_at, p_request_ip);

  return jsonb_build_object('issued', true);
end;
$$;

comment on function public.request_client_link(uuid, text, text, timestamptz, inet) is
  'Records an attempt, enforces the rate limits, and issues a link only to an active contact of that programme. Returns the same shape in every case so the caller cannot leak which happened.';


-- -----------------------------------------------------------------------------
-- 3. Following a link
--
-- One use, one programme, one contact. The programme comes from the URL and is
-- checked against the programme the link was issued for, because CLAUDE.md is
-- explicit that a route trusting the slug rather than the token is a data
-- breach — and putting the check here means a route that forgets it cannot
-- exist.
--
-- Consuming and issuing the session happen in the same transaction, so a link
-- can never be marked used without a session existing, or the reverse.
-- -----------------------------------------------------------------------------

create or replace function public.consume_client_link(
  p_link_token_hash    text,
  p_program_id         uuid,
  p_session_token_hash text,
  p_session_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_request uuid;
  v_contact uuid;
begin
  select r.id, r.client_contact_id into v_request, v_contact
  from public.client_link_requests r
  join public.client_contacts c on c.id = r.client_contact_id
  where r.token_hash = p_link_token_hash
    and r.program_id = p_program_id     -- the URL must match the token
    and r.consumed_at is null           -- one use
    and r.expires_at > clock_timestamp()
    and c.active                        -- deactivating a contact ends their access
  for update;

  if v_request is null then
    return jsonb_build_object('ok', false);
  end if;

  perform public.set_actor('client_contact', null, v_contact);

  update public.client_link_requests
  set consumed_at = clock_timestamp()
  where id = v_request;

  insert into public.client_sessions
    (client_contact_id, program_id, token_hash, expires_at)
  values
    (v_contact, p_program_id, p_session_token_hash, p_session_expires_at);

  return jsonb_build_object('ok', true, 'contact_id', v_contact);
end;
$$;

comment on function public.consume_client_link(text, uuid, text, timestamptz) is
  'Exchanges an unused, unexpired link for a session, once. Refuses when the programme in the URL is not the one the link was issued for.';


-- -----------------------------------------------------------------------------
-- 4. Who a session belongs to
--
-- Every later client write starts here: hand it the session token hash and the
-- programme from the URL, and it returns the contact or nothing. Same rule —
-- the caller never asserts who it is.
-- -----------------------------------------------------------------------------

create or replace function public.client_session_contact(
  p_session_token_hash text,
  p_program_id         uuid
)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.client_contact_id
  from public.client_sessions s
  join public.client_contacts c on c.id = s.client_contact_id
  where s.token_hash = p_session_token_hash
    and s.program_id = p_program_id
    and s.revoked_at is null
    and s.expires_at > clock_timestamp()
    and c.active
$$;


-- Nothing public, nothing anonymous. The routes that call these hold the
-- service role; no browser ever reaches them.
do $$
declare f text;
begin
  foreach f in array array[
    'public.request_client_link(uuid, text, text, timestamptz, inet)',
    'public.consume_client_link(text, uuid, text, timestamptz)',
    'public.client_session_contact(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
