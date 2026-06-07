-- ============================================================================
-- Row Level Security
--
-- Default-deny: RLS is enabled on every table; only the narrow policies below
-- grant access. Anything not explicitly allowed for `authenticated` is denied
-- — in particular, writes to matches/standings/tournament_config are only
-- possible for admins (explicit policy) or the service role used by Edge
-- Functions (which bypasses RLS entirely). `anon` (signed-out) gets nothing.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.standings enable row level security;
alter table public.bets enable row level security;
alter table public.tournament_bets enable row level security;
alter table public.tournament_config enable row level security;

-- Is the current user an admin? SECURITY DEFINER so the check works
-- regardless of the profiles SELECT policy, and isn't duplicated as a
-- subquery in every admin-gated policy below.
create function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

comment on function public.is_admin is 'True if the signed-in user has profiles.is_admin = true. Used to gate admin-only write policies.';


-- ----------------------------------------------------------------------------
-- profiles — display names are shared (leaderboard, bet breakdowns reveal
-- who predicted what); each user manages only their own row and cannot
-- self-promote to admin (enforced by the protect_profile_admin_flag trigger).
-- ----------------------------------------------------------------------------
create policy "profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ----------------------------------------------------------------------------
-- matches — public schedule/result data, readable by any signed-in user.
-- Writes happen via the sync Edge Function (service role ⇒ bypasses RLS) or
-- an admin's manual correction through this policy.
-- ----------------------------------------------------------------------------
create policy "matches are viewable by authenticated users"
  on public.matches for select
  to authenticated
  using (true);

create policy "admins can modify matches"
  on public.matches for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ----------------------------------------------------------------------------
-- standings — public, read-only for users; written only by the sync job
-- (service role).
-- ----------------------------------------------------------------------------
create policy "standings are viewable by authenticated users"
  on public.standings for select
  to authenticated
  using (true);


-- ----------------------------------------------------------------------------
-- bets — this is where the lock rule lives, enforced against matches.kickoff_at
-- so the server (not the UI) is the source of truth:
--   • SELECT: always see your own bets; see others' for a match only once
--     it has locked (kickoff_at <= now()) — this is what makes the
--     leaderboard's per-match breakdown "reveal after lock" work.
--   • INSERT/UPDATE: only your own bets, and only while kickoff_at is still
--     in the future. No DELETE policy ⇒ deletes are denied (edit instead).
-- ----------------------------------------------------------------------------
create policy "users can view their own bets, others' once locked"
  on public.bets for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.matches m
      where m.id = bets.match_id and m.kickoff_at <= now()
    )
  );

create policy "users can place bets before kickoff"
  on public.bets for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.matches m
      where m.id = match_id and m.kickoff_at > now()
    )
  );

create policy "users can edit their own bets before kickoff"
  on public.bets for update
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.matches m
      where m.id = bets.match_id and m.kickoff_at > now()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.matches m
      where m.id = match_id and m.kickoff_at > now()
    )
  );


-- ----------------------------------------------------------------------------
-- tournament_bets — same lock idea, gated on tournament_config.lock_at
-- (a single tournament-wide instant) instead of a per-row kickoff time.
-- ----------------------------------------------------------------------------
create policy "users can view their own tournament bet, others' once locked"
  on public.tournament_bets for select
  to authenticated
  using (
    auth.uid() = user_id
    or now() >= (select lock_at from public.tournament_config where id = 1)
  );

create policy "users can place their tournament bet before lock"
  on public.tournament_bets for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and now() < (select lock_at from public.tournament_config where id = 1)
  );

create policy "users can edit their tournament bet before lock"
  on public.tournament_bets for update
  to authenticated
  using (
    auth.uid() = user_id
    and now() < (select lock_at from public.tournament_config where id = 1)
  )
  with check (
    auth.uid() = user_id
    and now() < (select lock_at from public.tournament_config where id = 1)
  );


-- ----------------------------------------------------------------------------
-- tournament_config — readable by everyone (lock countdown + scoring
-- constants are shown in the UI); writable only by admins, who use it to
-- record official results (which fires recalculate_tournament_points).
-- ----------------------------------------------------------------------------
create policy "tournament config is viewable by authenticated users"
  on public.tournament_config for select
  to authenticated
  using (true);

create policy "admins can update tournament config"
  on public.tournament_config for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
