-- Outreach tracker: each saved professor carries a pipeline status, a follow-up date and the
-- OpenAlex id (so the finder and the rankings table can both save to the same list).
alter table public.saved_professors
  add column status text not null default 'saved'
    check (status in ('saved', 'drafted', 'sent', 'replied', 'meeting', 'declined', 'no_reply')),
  add column follow_up_on date,
  add column openalex_id text check (char_length(openalex_id) <= 20),
  add column contact_email text check (char_length(contact_email) <= 254),
  add column sent_at timestamptz,
  add column updated_at timestamptz not null default now();

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  -- When marked sent, record when, and default a follow-up 10 days out if none was set.
  if new.status = 'sent' and (old.status is distinct from 'sent') then
    new.sent_at := coalesce(new.sent_at, now());
    new.follow_up_on := coalesce(new.follow_up_on, (now() + interval '10 days')::date);
  end if;
  return new;
end $$;

create trigger saved_professors_touch before update on public.saved_professors
  for each row execute function public.touch_updated_at();

-- Age gate: COPPA. Record the user's birth year; under-13 accounts are blocked from saving data.
alter table public.profiles add column birth_year int check (birth_year between 1900 and 2100);
grant update (display_name, birth_year) on public.profiles to authenticated;
