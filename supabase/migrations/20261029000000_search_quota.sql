-- Daily cap on NEW (uncached) professor searches, so one person or bot can't drain the
-- site-wide OpenAlex budget. Keyed by user id, or a hash of the IP for signed-out visitors.
create table public.search_quota (
  who text not null,
  day date not null default (now() at time zone 'utc')::date,
  n integer not null default 0,
  primary key (who, day)
);
alter table public.search_quota enable row level security;
revoke all on public.search_quota from anon, authenticated;

-- Atomically count one search; returns true if still within the limit.
create function public.take_search(p_who text, p_limit integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare cur integer;
begin
  insert into public.search_quota (who, day, n) values (p_who, (now() at time zone 'utc')::date, 1)
  on conflict (who, day) do update set n = search_quota.n + 1
  returning n into cur;
  return cur <= p_limit;
end $$;
revoke execute on function public.take_search(text, integer) from public, anon, authenticated;
grant execute on function public.take_search(text, integer) to service_role;
