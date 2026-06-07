-- ============================================================================
-- Scoring: pure calculation functions, plus triggers that (re)apply them
-- whenever official results are written to `matches` or `tournament_config`
-- — whether by the sync job (service role) or an admin's manual correction.
--
-- Match-bet point values (3 / 1 / 0) are fixed by spec and live as literals
-- in calculate_match_points — change them there if the rules ever change.
-- Tournament-bet point values are configurable via tournament_config.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Per-match score betting: 3 pts exact score, 1 pt correct outcome, else 0
-- ----------------------------------------------------------------------------
create function public.calculate_match_points(
  predicted_home integer,
  predicted_away integer,
  actual_home integer,
  actual_away integer
)
returns integer
language sql
immutable
as $$
  select case
    when predicted_home = actual_home and predicted_away = actual_away then 3
    when sign(predicted_home - predicted_away) = sign(actual_home - actual_away) then 1
    else 0
  end;
$$;

comment on function public.calculate_match_points is
  'Match-bet scoring: 3 pts exact score, 1 pt correct outcome (sign of goal difference matches → same win/draw/loss result), else 0.';

-- Whenever a match is (re)marked FINISHED with a score, recompute points for
-- every bet on it. SECURITY DEFINER + owned by postgres ⇒ bypasses RLS, so it
-- can write bets.points_awarded regardless of the bets table's user policies
-- (which intentionally do not let players write their own points).
create function public.recalculate_match_points()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'FINISHED' and new.home_score is not null and new.away_score is not null then
    update public.bets
    set points_awarded = public.calculate_match_points(predicted_home, predicted_away, new.home_score, new.away_score),
        updated_at = now()
    where match_id = new.id;
  end if;
  return new;
end;
$$;

create trigger recalculate_match_points
  after update of status, home_score, away_score on public.matches
  for each row execute function public.recalculate_match_points();


-- ----------------------------------------------------------------------------
-- Tournament betting: configurable points for podium position + top scorer
-- ----------------------------------------------------------------------------
create function public.calculate_tournament_points(
  pick_first text, pick_second text, pick_third text, pick_top_scorer text,
  actual_first text, actual_second text, actual_third text, actual_top_scorer text,
  points_podium integer, points_scorer integer
)
returns integer
language sql
immutable
as $$
  select
    (case when pick_first = actual_first then points_podium else 0 end)
    + (case when pick_second = actual_second then points_podium else 0 end)
    + (case when pick_third = actual_third then points_podium else 0 end)
    + (case when pick_top_scorer = actual_top_scorer then points_scorer else 0 end);
$$;

comment on function public.calculate_tournament_points is
  'Tournament-bet scoring: points_podium for each podium country picked in its exact position (max 3x), plus points_scorer if the top-scorer pick matches. Both values come from tournament_config so they stay configurable without a code change.';

-- Whenever the admin (re)records official tournament results — i.e. all four
-- actual_* fields end up populated — recompute every tournament bet's points.
create function public.recalculate_tournament_points()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.actual_first is not null
     and new.actual_second is not null
     and new.actual_third is not null
     and new.actual_top_scorer is not null then
    update public.tournament_bets
    set points_awarded = public.calculate_tournament_points(
          pick_first, pick_second, pick_third, pick_top_scorer,
          new.actual_first, new.actual_second, new.actual_third, new.actual_top_scorer,
          new.points_podium_correct_position, new.points_top_scorer
        ),
        updated_at = now();
  end if;
  return new;
end;
$$;

create trigger recalculate_tournament_points
  after update of actual_first, actual_second, actual_third, actual_top_scorer,
                  points_podium_correct_position, points_top_scorer
  on public.tournament_config
  for each row execute function public.recalculate_tournament_points();
