-- Google sign-in sends the user's name; prefill display_name so they only need to enter a birth year.
-- Keeps the $1 signup bonus from 20261009020000_credits.sql.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ''));
  perform public.grant_credits(new.id, 100, 'signup_bonus', 'signup:' || new.id);
  return new;
end $$;
