-- ============================================================================
-- Tournament-bet refinements (additive — appended after the initial schema
-- was applied, rather than editing already-applied migrations):
--
-- 1. A country can't finish in two podium spots — guard it in the database,
--    not just the picker UI.
-- 2. Tournament-bet matching is normalized (case/whitespace-insensitive).
--    Podium picks come from a dropdown so they're already consistent, but
--    the top-scorer pick is free text — "Kylian Mbappé" vs "kylian mbappe "
--    should still count as the same answer. calculate_match_points (match
--    score betting) is untouched — that comparison is purely numeric.
-- ============================================================================

alter table public.tournament_bets
  add constraint tournament_bets_distinct_picks
  check (pick_first <> pick_second and pick_second <> pick_third and pick_first <> pick_third);

create or replace function public.calculate_tournament_points(
  pick_first text, pick_second text, pick_third text, pick_top_scorer text,
  actual_first text, actual_second text, actual_third text, actual_top_scorer text,
  points_podium integer, points_scorer integer
)
returns integer
language sql
immutable
as $$
  select
    (case when lower(trim(pick_first)) = lower(trim(actual_first)) then points_podium else 0 end)
    + (case when lower(trim(pick_second)) = lower(trim(actual_second)) then points_podium else 0 end)
    + (case when lower(trim(pick_third)) = lower(trim(actual_third)) then points_podium else 0 end)
    + (case when lower(trim(pick_top_scorer)) = lower(trim(actual_top_scorer)) then points_scorer else 0 end);
$$;

comment on function public.calculate_tournament_points is
  'Tournament-bet scoring: points_podium for each podium country picked in its exact position (max 3x), plus points_scorer if the top-scorer pick matches. Comparisons are case/whitespace-insensitive (lower+trim) so free-text entry like top scorer isn''t penalized for incidental formatting differences. Both point values come from tournament_config so they stay configurable.';
