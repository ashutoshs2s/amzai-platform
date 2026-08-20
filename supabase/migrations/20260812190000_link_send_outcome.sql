-- =============================================================================
-- Whether the email actually left.
--
-- The link row was written before the send was attempted, and the Contacts tab
-- read "Link sent" from the row's existence. So a send that failed — a wrong
-- password, a provider refusing, no provider configured at all — looked
-- identical to one that arrived. The client waits for something that never
-- left, and Amzai believes it did.
--
-- That is the worst failure in this flow precisely because nothing is broken on
-- either side of it: no error, no empty state, no missing row. Only a silence
-- that both parties read as somebody else's turn.
-- =============================================================================

alter table public.client_link_requests
  add column if not exists send_status text not null default 'pending',
  add column if not exists send_attempted_at timestamptz,
  add column if not exists send_detail text;

alter table public.client_link_requests
  drop constraint if exists client_link_requests_send_status_valid;
alter table public.client_link_requests
  add constraint client_link_requests_send_status_valid
  check (send_status in ('pending', 'sent', 'failed', 'not_configured'));

comment on column public.client_link_requests.send_status is
  'pending until the send is attempted, then sent, failed, or not_configured. A link row alone never means the email arrived.';

comment on column public.client_link_requests.send_detail is
  'An error code for an operator. Never a provider response body, which can quote the message and therefore the link.';

/*
  `not_configured` is deliberately not `failed`. "Nobody set up a mail provider"
  and "the provider refused it" need different actions from different people,
  and collapsing them into one status makes the screen say the wrong thing to
  whoever is reading it.
*/


-- -----------------------------------------------------------------------------
-- Recording the outcome
--
-- No set_actor here, and that is deliberate rather than an oversight.
--
-- Every other client-flow write is attributed to the contact, because the
-- contact did it. This one is not: the contact asked for a link, and what is
-- being recorded is whether Amzai's own infrastructure managed to send it. No
-- person performed this. `system` is the truthful actor, and the trigger's
-- fallback records exactly that.
-- -----------------------------------------------------------------------------

create or replace function public.record_client_link_send(
  p_token_hash text,
  p_status     text,
  p_detail     text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_status not in ('sent', 'failed', 'not_configured') then
    raise exception 'Unknown send status: %', p_status;
  end if;

  update public.client_link_requests
  set send_status = p_status,
      send_attempted_at = clock_timestamp(),
      -- Capped hard. The caller passes a code, but a cap is what makes it
      -- impossible for a long provider message to arrive here by accident.
      send_detail = left(nullif(trim(coalesce(p_detail, '')), ''), 120)
  where token_hash = p_token_hash;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.record_client_link_send(text, text, text) is
  'Records whether the email left. Attributed to system on purpose: the contact asked for the link, but no person sent it.';

revoke all on function public.record_client_link_send(text, text, text) from public, anon;
grant execute on function public.record_client_link_send(text, text, text) to service_role;

/*
  Existing rows predate the column and their outcome is genuinely unknown. They
  are left `pending` rather than assumed `sent`: assuming success is the exact
  mistake this migration exists to correct.
*/
