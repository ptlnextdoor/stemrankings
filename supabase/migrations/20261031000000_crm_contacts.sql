-- Owner's outreach log for each user (who I messaged, how, what they said). Service role only.
create table if not exists public.crm_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  contacted_at timestamptz,
  channel text,          -- linkedin, email, text
  notes text,            -- what they said / why they dropped off
  updated_at timestamptz not null default now()
);
alter table public.crm_contacts enable row level security;
revoke all on public.crm_contacts from anon, authenticated;
