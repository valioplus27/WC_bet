-- ============================================================================
-- Track whether each user has ever set a password, so the app can guarantee
-- "every account gets a password" without nagging anyone who already has one:
--   • New magic-link sign-ups start with has_password = false and are walked
--     through an in-app "finish setting up your account" step (see
--     useAuth's needsPasswordSetup and <SetNewPassword mode="setup">).
--   • Existing accounts are backfilled below by reading the one place that
--     actually knows — auth.users.encrypted_password — which the client can
--     never see directly (the auth schema isn't exposed over the API).
--   • A trigger keeps it correct from here on, however a password gets set:
--     the in-app step, "forgot password", or the Supabase dashboard.
-- ============================================================================

alter table public.profiles
  add column has_password boolean not null default false;

comment on column public.profiles.has_password is
  'True once auth.users.encrypted_password is set, kept in sync by on_auth_user_password_set. Drives the "finish setting up your account" prompt for magic-link-only accounts.';

-- One-time backfill for accounts that already have a password — e.g. ones
-- created through the (now-removed) sign-up-with-password flow, or set via
-- the dashboard — so they're never wrongly told to "set up" what they have.
update public.profiles p
set has_password = true
from auth.users u
where u.id = p.id
  and u.encrypted_password is not null
  and u.encrypted_password <> '';

create function public.handle_user_password_set()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.encrypted_password is not null and new.encrypted_password <> ''
     and (old.encrypted_password is null or old.encrypted_password = '') then
    update public.profiles set has_password = true where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_password_set
  after update of encrypted_password on auth.users
  for each row execute function public.handle_user_password_set();
