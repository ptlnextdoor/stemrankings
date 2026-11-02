-- professor_emails was readable by any signed-in user, so one account could dump every address students
-- found or confirmed. Nothing in the browser reads it (find-email serves results through the service role),
-- so lock it to the server.
revoke select on public.professor_emails from authenticated;
drop policy if exists "read professor_emails" on public.professor_emails;
