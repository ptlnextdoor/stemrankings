-- The service-role exception in lock_birth_year read request.jwt.claim.role, a legacy setting that
-- current PostgREST no longer sets, so even the operator couldn't correct a mistyped birth year.
-- Read the role from request.jwt.claims instead. Still fails closed for users.
create or replace function public.lock_birth_year() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.birth_year is not null and new.birth_year is distinct from old.birth_year
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'birth year cannot be changed';
  end if;
  return new;
end $$;
