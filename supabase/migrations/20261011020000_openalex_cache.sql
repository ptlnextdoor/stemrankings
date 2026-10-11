-- Cache of OpenAlex-derived results (finder searches, professor pages, recent papers).
-- Server-only: no policies, so the browser can neither read nor write it.
create table public.openalex_cache (
  key text primary key check (char_length(key) <= 400),
  body jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.openalex_cache enable row level security;
revoke all on public.openalex_cache from anon, authenticated;
