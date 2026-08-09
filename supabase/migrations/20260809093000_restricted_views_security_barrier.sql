-- =============================================================================
-- Harden the two restricted views. Follows on from 20260809091000.
--
-- WHY, given the views already filter on the caller's role.
--
-- A view that runs with its owner's rights reads past the row level security on
-- its base table. Everything that keeps it safe therefore lives in the view
-- definition, and a view definition is only as safe as the order the planner
-- chooses to evaluate things in.
--
-- The classic attack is to supply a predicate of your own that leaks through an
-- error or a notice, and rely on the planner running it against rows before the
-- view's own filter has excluded them:
--
--   select 1 from programs_restricted
--   where 1 / (case when name like 'Secret%' then 0 else 1 end) = 1;
--
-- A division-by-zero error would prove the predicate saw a row the caller is
-- not entitled to. Today it does not, because
-- `current_user_role() = 'data_ops'` does not depend on any row, so the planner
-- turns it into a One-Time Filter that gates the scan entirely:
--
--   Result
--     One-Time Filter: (current_user_role() = 'data_ops'::text)
--     ->  Seq Scan on programs p
--           Filter: ((1 / CASE WHEN (name ~~ 'Secret%') THEN 0 ELSE 1 END) = 1)
--
-- That is a safe plan, but it is safe by accident of shape rather than by
-- instruction. Change the filter to anything row-dependent, say
-- `can_see_program(p.id)`, and the One-Time Filter disappears along with the
-- protection, silently and with no test failing.
--
-- security_barrier tells the planner it may not push a user-supplied qual below
-- the view's own. It turns today's emergent safety into a stated rule that
-- survives the next edit.
-- =============================================================================

alter view public.organisations_restricted set (security_barrier = true);
alter view public.programs_restricted set (security_barrier = true);

comment on view public.programs_restricted is
  'data_ops only. Name, type and dates. No currency, no approver, no dashboard token. security_barrier so no caller-supplied predicate can be evaluated below the role check.';

comment on view public.organisations_restricted is
  'data_ops only. security_barrier so no caller-supplied predicate can be evaluated below the role check.';
