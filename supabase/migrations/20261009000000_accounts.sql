-- STEMRankings accounts schema.
-- profiles.plan is the hook for the future paid tier. Users can read it but never write it;
-- only the service role (a future Stripe webhook) may change it.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

create table public.saved_professors (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  author_name text not null check (char_length(author_name) between 1 and 200),
  institution text check (char_length(institution) <= 300),
  orcid text check (char_length(orcid) <= 50),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  primary key (user_id, author_name)
);

alter table public.profiles enable row level security;
alter table public.saved_professors enable row level security;

create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);
-- Only display_name is user-editable; plan/email are locked by the column grant below.
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

create policy "own saved: select" on public.saved_professors for select using (auth.uid() = user_id);
create policy "own saved: insert" on public.saved_professors for insert with check (auth.uid() = user_id);
create policy "own saved: update" on public.saved_professors for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own saved: delete" on public.saved_professors for delete using (auth.uid() = user_id);

-- Create a profile row for every new auth user.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tiny table the daily keep-alive job reads, so the free project never goes idle.
create table public.heartbeat (id int primary key, note text);
insert into public.heartbeat values (1, 'keep-alive');
alter table public.heartbeat enable row level security;
create policy "public read heartbeat" on public.heartbeat for select using (true);
