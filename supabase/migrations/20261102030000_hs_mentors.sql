-- Professors likely to mentor high schoolers: senior (last) authors on recent papers that had a
-- high-school-affiliated co-author, and who are not themselves at a school. Built offline by
-- scripts/build-hs-mentors.mjs from OpenAlex; the find and professor functions join against it to
-- show a "worked with high schoolers" tag and gently boost the score.
create table if not exists public.hs_mentors (
  openalex_id text primary key check (openalex_id ~ '^A[0-9]{4,12}$'),
  papers int not null default 1,
  latest_year int,
  example_title text check (char_length(example_title) <= 500),
  updated_at timestamptz not null default now()
);

alter table public.hs_mentors enable row level security;
-- Read-only public fact (like heartbeat/rankings); the server writes it via the Management API /
-- service role. No direct writes from clients.
revoke all on public.hs_mentors from anon, authenticated;
grant select on public.hs_mentors to anon, authenticated;
drop policy if exists "public read hs_mentors" on public.hs_mentors;
create policy "public read hs_mentors" on public.hs_mentors for select using (true);
