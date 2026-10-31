-- CRM view: one row per user with where they are in the funnel. Owner-only (service role).
-- Export: scripts/export-users.sh writes it to users.csv.
create or replace view public.crm_users as
select
  u.id,
  u.email,
  p.display_name,
  u.created_at as signed_up_at,
  u.last_sign_in_at,
  p.birth_year,
  p.plan,
  p.credits_cents,
  (select count(*) from public.user_docs d where d.user_id = u.id) as docs,
  p.profile_summary is not null as built_profile,
  (select count(*) from public.saved_professors s where s.user_id = u.id) as saved,
  (select count(*) from public.drafts d where d.user_id = u.id) as drafts,
  (select count(*) from public.saved_professors s where s.user_id = u.id and s.status in ('sent','replied','meeting','declined','no_reply')) as sent,
  case
    when p.plan = 'pro' then '7 paying'
    when exists (select 1 from public.saved_professors s where s.user_id = u.id and s.status in ('sent','replied','meeting','declined','no_reply')) then '6 sent'
    when exists (select 1 from public.drafts d where d.user_id = u.id) then '5 drafted'
    when exists (select 1 from public.saved_professors s where s.user_id = u.id) then '4 saved'
    when p.profile_summary is not null then '3 profile'
    when p.birth_year is not null and p.display_name is not null then '2 onboarded'
    else '1 signed up'
  end as stage,
  c.contacted_at,
  c.channel,
  c.notes
from auth.users u
join public.profiles p on p.id = u.id
left join public.crm_contacts c on c.user_id = u.id;

revoke all on public.crm_users from anon, authenticated;
