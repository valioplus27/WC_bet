-- ============================================================================
-- Initial schema: profiles, matches, standings, bets, tournament_bets,
-- tournament_config.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles: one row per app user, linked 1:1 to auth.users
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per signed-up user; display name shown on leaderboards and bet breakdowns.';

-- Automatically create a profile when someone signs up via Supabase Auth.
-- The display name comes from supabase.auth.signInWithOtp({ options: { data:
-- { display_name } } }), falling back to the email's local part.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may rename themselves, but only the service role (Edge Functions /
-- SQL editor) may flip is_admin — regular updates silently keep the old value.
create function public.protect_profile_admin_flag()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and new.is_admin is distinct from old.is_admin then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

create trigger protect_profile_admin_flag
  before update on public.profiles
  for each row execute function public.protect_profile_admin_flag();


-- ----------------------------------------------------------------------------
-- matches: synced from the football-data API; admin can manually correct
-- ----------------------------------------------------------------------------
create table public.matches (
  id bigint generated always as identity primary key,
  ext_id text not null unique,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz not null,
  -- e.g. GROUP_STAGE, LAST_16, QUARTER_FINALS, SEMI_FINALS, THIRD_PLACE, FINAL
  stage text not null,
  -- e.g. 'Group A' — null for knockout-stage matches
  group_name text,
  home_score integer,
  away_score integer,
  -- Raw status string from the data source, e.g. SCHEDULED, TIMED, IN_PLAY,
  -- PAUSED, FINISHED, POSTPONED, SUSPENDED, CANCELLED. Stored verbatim
  -- (no check constraint) so an unfamiliar upstream value can't break the sync.
  status text not null default 'SCHEDULED',
  updated_at timestamptz not null default now()
);

comment on table public.matches is 'World Cup fixtures + results, synced from the football-data API.';
comment on column public.matches.ext_id is 'Stable ID from the upstream football-data API; sync upserts on this column.';
comment on column public.matches.kickoff_at is 'The lock instant for this match''s bets — enforced via RLS (see rls_policies migration), not just the UI.';

create index matches_kickoff_at_idx on public.matches (kickoff_at);
create index matches_stage_idx on public.matches (stage);


-- ----------------------------------------------------------------------------
-- standings: group-stage tables, synced from the football-data API
-- ----------------------------------------------------------------------------
create table public.standings (
  id bigint generated always as identity primary key,
  group_name text not null,
  team_name text not null,
  played integer not null default 0,
  won integer not null default 0,
  draw integer not null default 0,
  lost integer not null default 0,
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  goal_difference integer not null default 0,
  points integer not null default 0,
  position integer,
  updated_at timestamptz not null default now(),
  unique (group_name, team_name)
);

comment on table public.standings is 'Group-stage tables, replaced wholesale on each sync from the football-data API.';

create index standings_group_name_idx on public.standings (group_name);


-- ----------------------------------------------------------------------------
-- bets: one per (user, match) — exact-score predictions
-- ----------------------------------------------------------------------------
create table public.bets (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  match_id bigint not null references public.matches (id) on delete cascade,
  predicted_home integer not null check (predicted_home >= 0),
  predicted_away integer not null check (predicted_away >= 0),
  -- Set only by the recalculate_match_points trigger once the match is
  -- FINISHED — regular users cannot write this (see protect_bet_points).
  points_awarded integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

comment on table public.bets is 'Per-match exact-score predictions. Locked at matches.kickoff_at — enforced via RLS.';

create index bets_match_id_idx on public.bets (match_id);
create index bets_user_id_idx on public.bets (user_id);

create function public.protect_bet_points()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if tg_op = 'INSERT' then
      new.points_awarded := null;
    else
      new.points_awarded := old.points_awarded;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_bet_points
  before insert or update on public.bets
  for each row execute function public.protect_bet_points();


-- ----------------------------------------------------------------------------
-- tournament_bets: one per user — podium + top scorer, placed once and locked
-- ----------------------------------------------------------------------------
create table public.tournament_bets (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pick_first text not null,
  pick_second text not null,
  pick_third text not null,
  pick_top_scorer text not null,
  -- Set only by the recalculate_tournament_points trigger once official
  -- results are recorded — regular users cannot write this.
  points_awarded integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

comment on table public.tournament_bets is 'One-time podium + top-scorer picks. Editable only before tournament_config.lock_at — enforced via RLS.';

create function public.protect_tournament_bet_points()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if tg_op = 'INSERT' then
      new.points_awarded := null;
    else
      new.points_awarded := old.points_awarded;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_tournament_bet_points
  before insert or update on public.tournament_bets
  for each row execute function public.protect_tournament_bet_points();


-- ----------------------------------------------------------------------------
-- tournament_config: singleton row — lock time, official results, and the
-- configurable point values for tournament bets.
-- ----------------------------------------------------------------------------
create table public.tournament_config (
  id integer primary key default 1,
  lock_at timestamptz not null,
  actual_first text,
  actual_second text,
  actual_third text,
  actual_top_scorer text,
  -- Awarded independently for each of pick_first/second/third that exactly
  -- matches its podium position. Suggested default: 5.
  points_podium_correct_position integer not null default 5,
  -- Awarded once if pick_top_scorer matches the official top scorer. Suggested default: 3.
  points_top_scorer integer not null default 3,
  updated_at timestamptz not null default now(),
  constraint tournament_config_singleton check (id = 1)
);

comment on table public.tournament_config is 'Singleton row (id = 1): tournament-bet lock time, official results, and configurable scoring constants.';
