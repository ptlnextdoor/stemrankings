-- The draft function records email charges with reason 'email' (its action name), which the
-- original check constraint didn't allow, so every email draft failed before charging.
alter table public.credit_ledger drop constraint credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('signup_bonus', 'subscription', 'topup', 'email', 'draft', 'profile', 'refund', 'admin'));
