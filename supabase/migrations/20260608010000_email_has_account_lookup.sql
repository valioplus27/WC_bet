-- ============================================================================
-- Lets the sign-in screen ask "does this email already have an account?"
-- before sending a magic link.
--
-- Magic links are this app's account-*creation* path (see MagicLinkPanel) —
-- once an email has an account, sending it another magic link would just be a
-- redundant way to sign in (and undermines "every account gets a password":
-- see the profiles_has_password migration). So the panel looks the email up
-- first and, if it already exists, turns it away towards password sign-in
-- (or "forgot password") instead of sending anything.
--
-- auth.users isn't exposed over the API — the auth schema is internal by
-- design — so the only way to answer "does X exist" is a SECURITY DEFINER
-- function that can see it, returning nothing but a bare boolean.
--
-- This is deliberately reachable while signed out: unlike every table in this
-- schema (see the RLS migration's "`anon` (signed-out) gets nothing"), the UI
-- needs this answer *before* a session can exist, in order to decide whether
-- to send the link at all. That's a narrow, intentional exception — not an
-- oversight — and the only thing it leaks is a yes/no on an address the
-- caller already typed in themselves.
-- ============================================================================

create function public.email_has_account(lookup_email text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(trim(lookup_email))
  );
$$;

comment on function public.email_has_account(text) is
  'Bare yes/no existence check on auth.users.email for the sign-in screen — see this migration for why it (alone) is callable while signed out.';

grant execute on function public.email_has_account(text) to anon, authenticated;
