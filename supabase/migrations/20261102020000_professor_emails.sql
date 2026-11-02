-- Shared professor email records, so one student's successful find helps everyone and we don't
-- re-spend search quota (Serper/OpenAlex) on an email we already know. The server (service role)
-- owns writes; the find-email function reads/writes via service role. Users never touch this table
-- directly, but anyone signed in may READ it (the client shows "verified"/"maybe" tags).
--
-- author_key: openalex id (e.g. "A5020214490") when known, else lower(name)|lower(institution).
-- status: 'verified' (an address we actually found or that the crowd confirmed) or
--         'maybe' (a pattern guess / best match, served only as a suggestion).
create table if not exists public.professor_emails (
  author_key text not null check (char_length(author_key) between 1 and 320),
  email text not null check (char_length(email) <= 254),
  status text not null default 'maybe' check (status in ('verified', 'maybe')),
  source text check (char_length(source) <= 40),
  confirmations int not null default 0,
  bounces int not null default 0,
  -- User ids that confirmed / bounced this address, so one person can't move the count twice.
  confirmed_by uuid[] not null default '{}',
  bounced_by uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (author_key, email)
);

alter table public.professor_emails enable row level security;
-- Signed-in users may read (to render tags); nobody but the server may write.
revoke all on public.professor_emails from anon, authenticated;
grant select on public.professor_emails to authenticated;
drop policy if exists "read professor_emails" on public.professor_emails;
create policy "read professor_emails" on public.professor_emails for select to authenticated using (true);

-- Where did the user's saved email come from, so the row can show the right tag and we know whether
-- to crowd-confirm it when they later mark the professor 'replied'.
--   'verified' = served from a verified shared record / a fresh verified find
--   'maybe'    = a best-guess the user chose to "use anyway"
--   'yours'    = the user typed it in themselves
alter table public.saved_professors
  add column if not exists contact_email_status text
    check (contact_email_status is null or contact_email_status in ('verified', 'maybe', 'yours'));
grant update (contact_email_status) on public.saved_professors to authenticated;
