-- "Send from my Gmail": store a per-user encrypted Gmail refresh token so the server can send
-- outreach emails on the user's behalf via the Gmail API. Server-only: the browser never reads
-- these rows (RLS on, all grants revoked from anon/authenticated). The gmail edge function uses
-- the service role after verifying the caller's JWT.
--
-- Ships dark behind a client feature flag; Google requires app verification for the
-- gmail.send scope before this can be used by non-test users (see GMAIL_VERIFICATION.md).

create table public.gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gmail_address text not null,
  -- AES-GCM ciphertext of the OAuth refresh token, base64; iv is prefixed inside the blob.
  -- Encrypted at rest with the GMAIL_TOKEN_KEY secret so a DB leak alone can't send mail.
  refresh_token_enc text not null,
  connected_at timestamptz not null default now()
);

alter table public.gmail_connections enable row level security;
-- No policies + revoke: only the service role (edge function) can touch this table.
revoke all on public.gmail_connections from anon, authenticated;

-- Record the Gmail message id of a successful send, for audit / dedupe. Optional but useful.
alter table public.saved_professors add column if not exists sent_message_id text;
