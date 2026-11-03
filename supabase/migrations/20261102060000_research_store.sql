-- needalab's own research data store, pulled from OpenAlex (CC0) by pipeline/ingest.py.
-- These tables are the proprietary source of truth for rankings and professor data; the
-- site CSVs in data/ are exported FROM here by pipeline/export.py. We do NOT import
-- CSRankings' data files (CC BY-NC-ND, no commercial use). Only CC0 sources land here.
--
-- All tables hold non-personal research facts (names, institutions, publication counts)
-- that are already public in OpenAlex, so public read is fine, matching hs_mentors.
-- Writes are service role / Management API only; clients can never write.
-- New tables only. This migration never alters or drops any existing table.

-- Institutions (OpenAlex I-ids)
create table if not exists public.institutions (
  id text primary key check (id ~ '^I[0-9]{4,12}$'),
  name text not null,
  country_code text check (char_length(country_code) <= 2),
  region text,
  ror text,
  homepage text,
  type text,
  updated_at timestamptz not null default now()
);

-- People / authors (OpenAlex A-ids). Keyed by author id, not display name, so
-- namesakes stay separate and renamed people stay merged.
create table if not exists public.people (
  id text primary key check (id ~ '^A[0-9]{4,12}$'),
  name text not null,
  orcid text,
  institution_id text references public.institutions(id),
  homepage text,
  dblp_pid text,
  last_seen_year int,
  works_count int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists people_institution_idx on public.people(institution_id);

-- Venues (OpenAlex S-ids). Foundation for our own ranking methodology later.
create table if not exists public.venues (
  id text primary key check (id ~ '^S[0-9]{4,12}$'),
  name text not null,
  type text,
  area_id text,
  issn_l text,
  works_2y int,
  cited_2y int,
  updated_at timestamptz not null default now()
);

-- Per person, per area, per year aggregates. adj = sum of 1/k adjusted counts
-- (CSRankings scheme), senior = count of last-author papers.
create table if not exists public.person_area_year (
  person_id text not null references public.people(id),
  area_id text not null,
  year int not null,
  papers int not null default 0,
  adj real not null default 0,
  senior int not null default 0,
  primary key (person_id, area_id, year)
);
create index if not exists pay_area_year_idx on public.person_area_year(area_id, year);

-- Area taxonomy, seeded from data/areas.json.
create table if not exists public.areas (
  id text primary key,
  title text not null,
  division text,
  subfield text
);

-- One row per ingest/export run for provenance and the weekly-refresh guard.
create table if not exists public.data_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source text,
  rows int,
  notes text
);

-- RLS: public read of research facts, writes service role only (like hs_mentors).
do $$
declare t text;
begin
  foreach t in array array['institutions','people','venues','person_area_year','areas','data_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('drop policy if exists "public read %1$s" on public.%1$s', t);
    execute format('create policy "public read %1$s" on public.%1$s for select using (true)', t);
  end loop;
end $$;
