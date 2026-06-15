-- Per-match emoji reactions — one emoji per user per match, upsertable.
create table public.reactions (
  user_id   uuid  references auth.users  on delete cascade not null,
  match_id  int   references public.matches on delete cascade not null,
  emoji     text  not null check (emoji in ('😮','🎯','💥','🙈','🔥')),
  created_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

alter table public.reactions enable row level security;

create policy "reactions are viewable by authenticated users"
  on public.reactions for select to authenticated using (true);

create policy "users can manage their own reactions"
  on public.reactions for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.reactions;
