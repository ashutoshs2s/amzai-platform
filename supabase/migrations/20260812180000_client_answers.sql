-- =============================================================================
-- A client answering a question.
--
-- Same shape as the link functions, for the same reason: the route has no
-- auth.uid(), and set_actor is transaction-scoped, so attribution has to happen
-- inside one function or the audit row records 'system' and the client's answer
-- belongs to nobody.
--
-- Identity comes from the session token, never from an argument. The caller
-- says which response and what the answer is; who they are is derived.
-- =============================================================================

create or replace function public.client_answer_question(
  p_session_token_hash text,
  p_program_id         uuid,
  p_response_id        uuid,
  p_answer             text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contact uuid;
  v_updated integer;
  v_answer  text := nullif(trim(coalesce(p_answer, '')), '');
begin
  -- Who, from the token. Also confirms the session is live, unrevoked, and
  -- issued for this programme.
  v_contact := public.client_session_contact(p_session_token_hash, p_program_id);

  if v_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  perform public.set_actor('client_contact', null, v_contact);

  /*
    Every condition that matters is in this one WHERE clause, so a modified
    request naming another programme's response, or an Amzai-owned one, updates
    nothing rather than being argued with.

      the response is on the programme the session is for
      the question is the client's to answer, or shared

    Status moves to submitted so the change is visible to Amzai as something to
    look at. An N/A question is left alone: somebody decided it does not apply,
    and a client typing into it should not silently reopen it.
  */
  update public.onboarding_responses r
  set response = v_answer,
      answer_source = case when v_answer is null then null else 'client_written' end,
      answered_by = null,
      answered_by_contact_id = case when v_answer is null then null else v_contact end,
      answered_at = case when v_answer is null then null else clock_timestamp() end,
      status = case
                 when r.status = 'na' then r.status
                 when v_answer is null then 'not_started'
                 else 'submitted'
               end
  where r.id = p_response_id
    and r.program_id = p_program_id
    and r.owner in ('client', 'both');

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.client_answer_question(text, uuid, uuid, text) is
  'A client answering one of their own questions. Identity is derived from the session token, never taken as an argument, and set inside this transaction so the audit row names the contact.';

/**
 * The questions a client may see, and the answers they have given.
 *
 * A view rather than a query in the route, so the column list is the mechanism
 * and no route can widen it by editing a select string. Amzai-owned questions
 * are absent entirely, as are assignee, due date and every internal column.
 */
create or replace view public.client_onboarding_questions
  with (security_barrier = true) as
  select
    r.id,
    r.program_id,
    f.section,
    f.sort_order,
    f.question,
    f.guidance,
    r.response,
    r.status,
    r.owner,
    r.is_generic
  from public.onboarding_responses r
  join public.onboarding_template_fields f on f.id = r.template_field_id
  where r.owner in ('client', 'both');

comment on view public.client_onboarding_questions is
  'What a client may see of their onboarding. Amzai-owned questions, assignees, due dates and every other internal column are absent by construction.';

revoke all on public.client_onboarding_questions from anon, authenticated;
grant select on public.client_onboarding_questions to service_role;

revoke all on function public.client_answer_question(text, uuid, uuid, text) from public, anon;
grant execute on function public.client_answer_question(text, uuid, uuid, text) to service_role;
