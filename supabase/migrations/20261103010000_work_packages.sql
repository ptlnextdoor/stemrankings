-- Open problems index: work packages mined from the limitations / future-work sections of new arXiv
-- papers by the problems-ingest edge function. Each row quotes the sentence it came from (the function
-- rejects any package whose quote is not found verbatim in the paper). Public read, server writes only.
create table if not exists public.work_packages (
  id text primary key check (id ~ '^WP-[0-9]{4}\.[0-9]{4,5}-[0-9]$'),
  arxiv_id text not null check (arxiv_id ~ '^[0-9]{4}\.[0-9]{4,5}$'),
  paper_title text not null check (char_length(paper_title) <= 500),
  paper_authors text[] not null default '{}',
  paper_published date,
  category text check (char_length(category) <= 40),
  title text not null check (char_length(title) <= 200),
  source_quote text not null check (char_length(source_quote) <= 600),
  deliverable text not null check (char_length(deliverable) <= 600),
  inputs text not null check (char_length(inputs) <= 600),
  hours_min int not null check (hours_min between 1 and 40),
  hours_max int not null check (hours_max between hours_min and 60),
  skills text[] not null default '{}',
  tier text not null check (tier in ('reproduce', 'extend', 'benchmark', 'tooling')),
  value text check (char_length(value) <= 300),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists work_packages_created_idx on public.work_packages (created_at desc);
create index if not exists work_packages_arxiv_idx on public.work_packages (arxiv_id);

-- Which papers were already read, so a run never pays to re-read one (including papers that
-- yielded nothing). Server only.
create table if not exists public.arxiv_scanned (
  arxiv_id text primary key check (arxiv_id ~ '^[0-9]{4}\.[0-9]{4,5}$'),
  packages int not null default 0,
  note text check (char_length(note) <= 200),
  scanned_at timestamptz not null default now()
);

alter table public.work_packages enable row level security;
revoke all on public.work_packages from anon, authenticated;
grant select on public.work_packages to anon, authenticated;
drop policy if exists "public read work_packages" on public.work_packages;
create policy "public read work_packages" on public.work_packages for select using (status = 'open');

alter table public.arxiv_scanned enable row level security;
revoke all on public.arxiv_scanned from anon, authenticated;
