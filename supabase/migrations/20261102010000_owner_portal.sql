-- Owner portal: feedback ("roast a feature") + one JSON snapshot for the /admin/ dashboard.
-- Both are service-role only; the portal edge function checks the owner's email before calling.

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  feature text not null check (length(feature) between 1 and 80),
  roast text not null check (length(roast) between 3 and 4000),
  page text,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- Unit costs live in the dashboard page (easy to tweak); this returns raw counts only.
create or replace function public.owner_dashboard() returns jsonb
language sql stable security definer set search_path = '' as $$
  with seg as (
    select p.id, case when p.plan = 'pro' then 'paid' else 'free' end as segment
    from public.profiles p
  ),
  spend as (  -- net AI actions per user: charges minus refunds (refunds are 10 or 25 cents)
    select l.user_id,
      count(*) filter (where l.reason in ('email', 'draft')) as drafts_charged,
      count(*) filter (where l.reason = 'profile') as profiles_charged,
      count(*) filter (where l.reason = 'refund' and l.delta_cents = 25) as draft_refunds,
      count(*) filter (where l.reason = 'refund' and l.delta_cents = 10) as profile_refunds
    from public.credit_ledger l group by l.user_id
  ),
  q as (
    select split_part(who, ':', 1) as kind, nullif(split_part(who, ':', 2), '') as k, sum(n) as n
    from public.search_quota group by 1, 2
  )
  select jsonb_build_object(
    'generated_at', now(),
    'users', coalesce((select jsonb_agg(to_jsonb(c) order by c.signed_up_at desc) from public.crm_users c), '[]'::jsonb),
    'segments', (
      select jsonb_object_agg(segment, row_to_json(x)::jsonb) from (
        select s.segment,
          count(*) as users,
          coalesce(sum(sp.drafts_charged - sp.draft_refunds), 0) as drafts,
          coalesce(sum(sp.profiles_charged - sp.profile_refunds), 0) as profiles,
          coalesce(sum((select q.n from q where q.kind = 'u' and q.k = s.id::text)), 0) as searches,
          coalesce(sum((select q.n from q where q.kind = 'oa' and q.k = s.id::text)), 0) as paper_lookups,
          coalesce(sum((select q.n from q where q.kind = 'em' and q.k = s.id::text)), 0) as email_lookups,
          coalesce(sum((select q.n from q where q.kind = 'gm' and q.k = s.id::text)), 0) as gmail_sends
        from seg s left join spend sp on sp.user_id = s.id
        group by s.segment
      ) x),
    'anon_searches', coalesce((select sum(n) from q where kind = 'ip'), 0),
    'ledger', (select jsonb_object_agg(reason, jsonb_build_object('rows', n, 'cents', c)) from (
        select reason, count(*) n, sum(delta_cents) c from public.credit_ledger group by reason) r),
    'paid_invoices', (select count(*) from public.credit_ledger where reason = 'subscription'),
    'paying_now', (select count(*) from public.profiles where plan = 'pro'),
    'credits_outstanding_cents', (select coalesce(sum(credits_cents), 0) from public.profiles),
    'daily', coalesce((select jsonb_agg(d order by d.day desc) from (
        select g.day::date as day,
          (select count(*) from auth.users u where u.created_at::date = g.day) as signups,
          (select count(*) from public.drafts dr where dr.created_at::date = g.day) as drafts,
          (select coalesce(sum(n), 0) from public.search_quota sq where sq.day = g.day and split_part(sq.who, ':', 1) in ('u', 'ip')) as searches,
          (select count(*) from public.credit_ledger l where l.reason = 'subscription' and l.created_at::date = g.day) as payments
        from generate_series((now() at time zone 'utc')::date - 13, (now() at time zone 'utc')::date, interval '1 day') g(day)
      ) d), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from (
        select id, email, feature, roast, page, created_at from public.feedback order by created_at desc limit 200) f), '[]'::jsonb)
  )
$$;
revoke execute on function public.owner_dashboard() from public, anon, authenticated;
grant execute on function public.owner_dashboard() to service_role;
