-- First-party usage events: page views, funnel steps and browser errors. No cookies, no IP, no third
-- party. sid is a random per-tab id from sessionStorage. Anyone can insert (bounded sizes); only the
-- service role can read.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('view', 'search', 'signin_click', 'signup', 'save', 'draft', 'checkout_click', 'error')),
  path text check (char_length(path) <= 200),
  ref text check (char_length(ref) <= 100),   -- referrer host or utm_source
  detail text check (char_length(detail) <= 500),
  sid text check (char_length(sid) <= 40),
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists events_created on public.events (created_at);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
grant insert (kind, path, ref, detail, sid, user_id) on public.events to anon, authenticated;
drop policy if exists "anyone can log events" on public.events;
-- user_id must be null or the caller's own id, so nobody can attribute events to someone else.
create policy "anyone can log events" on public.events for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Health snapshot for the daily GitHub Action (errors and traffic in the last 24h). Service role only.
create or replace function public.owner_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'errors_24h', (select count(*) from public.events where kind = 'error' and created_at > now() - interval '24 hours'),
    'top_errors', coalesce((select jsonb_agg(e) from (
        select detail, count(*) n from public.events where kind = 'error' and created_at > now() - interval '24 hours'
        group by detail order by n desc limit 5) e), '[]'::jsonb),
    'views_24h', (select count(*) from public.events where kind = 'view' and created_at > now() - interval '24 hours'),
    'signups_24h', (select count(*) from auth.users where created_at > now() - interval '24 hours')
  )
$$;
revoke execute on function public.owner_health() from public, anon, authenticated;
grant execute on function public.owner_health() to service_role;

-- Funnel for the owner portal: distinct visitors per step, last 30 days.
create or replace function public.owner_funnel() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'visitors', (select count(distinct sid) from public.events where kind = 'view' and created_at > now() - interval '30 days'),
    'searched', (select count(distinct sid) from public.events where kind = 'search' and created_at > now() - interval '30 days'),
    'clicked_signin', (select count(distinct sid) from public.events where kind = 'signin_click' and created_at > now() - interval '30 days'),
    'signed_up', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'saved', (select count(distinct user_id) from public.saved_professors where created_at > now() - interval '30 days'),
    'drafted', (select count(distinct user_id) from public.drafts where created_at > now() - interval '30 days'),
    'clicked_checkout', (select count(distinct sid) from public.events where kind = 'checkout_click' and created_at > now() - interval '30 days'),
    'paying', (select count(*) from public.profiles where plan = 'pro'),
    'top_refs', coalesce((select jsonb_agg(r) from (
        select ref, count(distinct sid) n from public.events
        where kind = 'view' and ref is not null and created_at > now() - interval '30 days'
        group by ref order by n desc limit 8) r), '[]'::jsonb),
    'errors_7d', coalesce((select jsonb_agg(e) from (
        select detail, count(*) n, max(created_at) last from public.events
        where kind = 'error' and created_at > now() - interval '7 days'
        group by detail order by n desc limit 10) e), '[]'::jsonb)
  )
$$;
revoke execute on function public.owner_funnel() from public, anon, authenticated;
grant execute on function public.owner_funnel() to service_role;
