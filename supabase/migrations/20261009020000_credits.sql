-- Credits: a $10/month plan grants $10 of credits; actions spend them. Stored in cents.
-- Balance and ledger are written only by security-definer functions callable by the service role.

alter table public.profiles
  add column credits_cents integer not null default 0 check (credits_cents >= 0),
  add column stripe_customer_id text unique;
-- profiles already revokes UPDATE except display_name, so users cannot change these columns.

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_cents integer not null,
  reason text not null check (reason in ('signup_bonus', 'subscription', 'topup', 'draft', 'profile', 'refund', 'admin')),
  ref text unique,               -- Stripe invoice/session id; makes grants idempotent
  created_at timestamptz not null default now()
);
create index on public.credit_ledger (user_id, created_at);
alter table public.credit_ledger enable row level security;
create policy "own ledger: select" on public.credit_ledger for select using (auth.uid() = user_id);
revoke insert, update, delete on public.credit_ledger from authenticated, anon;

-- Grant credits once per ref. Returns the new balance, or null if this ref was already applied.
create function public.grant_credits(p_user uuid, p_amount integer, p_reason text, p_ref text)
returns integer language plpgsql security definer set search_path = '' as $$
declare inserted bigint; bal integer;
begin
  insert into public.credit_ledger (user_id, delta_cents, reason, ref)
  values (p_user, p_amount, p_reason, p_ref)
  on conflict (ref) do nothing
  returning id into inserted;
  if inserted is null then return null; end if;
  update public.profiles set credits_cents = credits_cents + p_amount where id = p_user
  returning credits_cents into bal;
  return bal;
end $$;

-- Atomically spend credits; raises INSUFFICIENT_CREDITS if the balance is too low.
create function public.spend_credits(p_user uuid, p_cost integer, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare bal integer;
begin
  update public.profiles set credits_cents = credits_cents - p_cost
  where id = p_user and credits_cents >= p_cost
  returning credits_cents into bal;
  if bal is null then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.credit_ledger (user_id, delta_cents, reason) values (p_user, -p_cost, p_reason);
  return bal;
end $$;

-- Functions in public are callable over the REST API by default. Lock them to the server.
revoke execute on function public.grant_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.spend_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.grant_credits(uuid, integer, text, text) to service_role;
grant execute on function public.spend_credits(uuid, integer, text) to service_role;

-- New users get $1 of credits to try it (profile build + 3 drafts).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  perform public.grant_credits(new.id, 100, 'signup_bonus', 'signup:' || new.id);
  return new;
end $$;

-- The credit ledger replaces the old per-day usage log.
drop table public.generation_log;
