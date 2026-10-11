-- COPPA age gate, enforced server-side.
-- 1. birth_year can be set once by the user and never changed afterwards (no retrying with a different year).
-- 2. Accounts under 13 (or with no birth year yet) cannot write saved professors, documents, or drafts.

create or replace function public.lock_birth_year() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.birth_year is not null and new.birth_year is distinct from old.birth_year
     and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'birth year cannot be changed';
  end if;
  return new;
end $$;
create trigger profiles_lock_birth_year before update on public.profiles
  for each row execute function public.lock_birth_year();

-- True when the signed-in user has declared a birth year making them at least 13 this year.
create or replace function public.is_age_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select birth_year <= extract(year from now())::int - 13
                   from public.profiles where id = auth.uid()), false)
$$;
revoke execute on function public.is_age_ok() from public, anon;
grant execute on function public.is_age_ok() to authenticated;

drop policy "own saved: insert" on public.saved_professors;
create policy "own saved: insert" on public.saved_professors
  for insert with check (auth.uid() = user_id and public.is_age_ok());
drop policy "own saved: update" on public.saved_professors;
create policy "own saved: update" on public.saved_professors
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id and public.is_age_ok());

drop policy "own docs: insert" on public.user_docs;
create policy "own docs: insert" on public.user_docs
  for insert with check (auth.uid() = user_id and public.is_age_ok());
