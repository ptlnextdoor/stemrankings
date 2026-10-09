-- Outreach drafting: user documents, a stored profile summary, generated drafts, and a usage cap.

-- Raw text the user pasted or extracted from uploads (resume, past work, bio).
create table public.user_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('resume', 'bio', 'experience', 'other')),
  title text check (char_length(title) <= 200),
  content text not null check (char_length(content) between 1 and 60000),
  created_at timestamptz not null default now()
);

-- Condensed profile the model writes from the docs; reused for every draft.
alter table public.profiles add column profile_summary text,
                            add column profile_updated_at timestamptz;
-- Users may not write the summary directly (only the server function does).

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  author_name text not null,
  subject text not null,
  body text not null,
  papers jsonb,
  created_at timestamptz not null default now()
);

-- One row per generation, written only by the server, used for the daily cap.
create table public.generation_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
create index on public.generation_log (user_id, created_at);

alter table public.user_docs enable row level security;
alter table public.drafts enable row level security;
alter table public.generation_log enable row level security;

create policy "own docs: select" on public.user_docs for select using (auth.uid() = user_id);
create policy "own docs: insert" on public.user_docs for insert with check (auth.uid() = user_id);
create policy "own docs: delete" on public.user_docs for delete using (auth.uid() = user_id);

-- Drafts are created by the server; users can read and delete their own.
create policy "own drafts: select" on public.drafts for select using (auth.uid() = user_id);
create policy "own drafts: delete" on public.drafts for delete using (auth.uid() = user_id);
revoke insert, update on public.drafts from authenticated, anon;

create policy "own log: select" on public.generation_log for select using (auth.uid() = user_id);
revoke insert, update, delete on public.generation_log from authenticated, anon;
