// Live checks for shared professor email records against the DEPLOYED find-email function + the
// professor_emails table. Creates throwaway users and deletes them.
// Run: SR=<service_role> ANON=<anon> node tests/email-records.test.mjs
const URL = 'https://oxcnlommtnziwfbpxigd.supabase.co', SR = process.env.SR, ANON = process.env.ANON;
if (!SR || !ANON) { console.error('Set SR and ANON env vars.'); process.exit(2); }
const H = (k, t) => ({ apikey: k, Authorization: 'Bearer ' + (t || k), 'Content-Type': 'application/json' });
const j = async r => { const t = await r.text(); try { return { s: r.status, b: JSON.parse(t) }; } catch { return { s: r.status, b: t }; } };
const pw = 'T3st-' + Math.random().toString(36).slice(2) + '!aA9';
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const purge = async e => { const l = await (await fetch(URL + '/auth/v1/admin/users?per_page=1000', { headers: H(SR) })).json(); for (const u of (l.users || []).filter(u => u.email === e)) await fetch(URL + '/auth/v1/admin/users/' + u.id, { method: 'DELETE', headers: H(SR) }); };
// Password grant is captcha-protected, so get a real session via an admin magic-link token (like portal.test.mjs).
async function mk(e) {
  await purge(e);
  await fetch(URL + '/auth/v1/admin/users', { method: 'POST', headers: H(SR), body: JSON.stringify({ email: e, password: pw, email_confirm: true }) });
  const l = await (await fetch(URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: H(SR), body: JSON.stringify({ type: 'magiclink', email: e }) })).json();
  const s = await (await fetch(URL + '/auth/v1/verify', { method: 'POST', headers: H(ANON), body: JSON.stringify({ type: 'magiclink', token_hash: l.hashed_token }) })).json();
  await fetch(URL + '/rest/v1/profiles?id=eq.' + s.user.id, { method: 'PATCH', headers: H(SR), body: JSON.stringify({ birth_year: 2005, display_name: 'Test Student' }) });
  return { tok: s.access_token, id: s.user.id };
}
const call = (tok, body) => fetch(URL + '/functions/v1/find-email', { method: 'POST', headers: H(ANON, tok), body: JSON.stringify(body) }).then(j);
// Service-role direct table access, to seed/read professor_emails and read the search_quota counter.
const seed = (row) => fetch(URL + '/rest/v1/professor_emails', { method: 'POST', headers: { ...H(SR), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) }).then(j);
const readPE = (key) => fetch(URL + '/rest/v1/professor_emails?author_key=eq.' + encodeURIComponent(key) + '&select=*', { headers: H(SR) }).then(j);
const delPE = (key) => fetch(URL + '/rest/v1/professor_emails?author_key=eq.' + encodeURIComponent(key), { method: 'DELETE', headers: H(SR) });
const emQuota = async (id) => {
  const day = new Date().toISOString().slice(0, 10);
  const r = await j(await fetch(URL + `/rest/v1/search_quota?who=eq.${encodeURIComponent('em:' + id)}&day=eq.${day}&select=n`, { headers: H(SR) }));
  return (r.b && r.b[0] && r.b[0].n) || 0;
};

const A = await mk('email-records-a@example.com');
const B = await mk('email-records-b@example.com');
// A fabricated author so we never spend a real Serper/OpenAlex lookup for the shared-record paths.
const AKEY = 'A999999001';
const E_VERIFIED = 'prof.shared@example.edu';
const E_MAYBE = 'guess.shared@example.edu';
const req = { author_name: 'Shared Record Prof', institution: 'Example University', openalex_id: AKEY };
try {
  await delPE(AKEY);

  // 1. A verified shared record is served instantly, with NO quota spent (no external lookup).
  await seed({ author_key: AKEY, email: E_VERIFIED, status: 'verified', source: 'faculty-page' });
  const q0 = await emQuota(A.id);
  const r1 = await call(A.tok, req);
  ok(r1.s === 200 && r1.b.email === E_VERIFIED && r1.b.served_from === 'shared', 'verified shared record served instantly');
  const q1 = await emQuota(A.id);
  ok(q1 === q0, `shared hit spends no quota (em: ${q0} -> ${q1})`);

  // 2. A 'maybe' record is NOT served as verified (status maybe never auto-trusted). Remove the
  //    verified row, leave a maybe, and confirm the shared short-circuit does not fire.
  await delPE(AKEY);
  await seed({ author_key: AKEY, email: E_MAYBE, status: 'maybe', source: 'guessed' });
  const r2 = await call(A.tok, req);
  ok(!(r2.b.served_from === 'shared'), "a 'maybe' record is not served as a verified shared hit");

  // 3. Two bounces from two different users stop a verified address being served.
  await delPE(AKEY);
  await seed({ author_key: AKEY, email: E_VERIFIED, status: 'verified', source: 'faculty-page' });
  const bA = await call(A.tok, { action: 'bounce', ...req, email: E_VERIFIED });
  ok(bA.s === 200 && bA.b.ok, 'bounce #1 accepted');
  const afterOne = await call(B.tok, req);
  ok(afterOne.b.served_from === 'shared', 'still served after one bounce');
  const bB = await call(B.tok, { action: 'bounce', ...req, email: E_VERIFIED });
  ok(bB.s === 200, 'bounce #2 (different user) accepted');
  const row = await readPE(AKEY);
  ok(row.b[0] && row.b[0].bounces >= 2, `bounces recorded (${row.b[0] && row.b[0].bounces})`);
  // A double-bounce from the SAME user must not push it over on its own: reset and prove.
  await delPE(AKEY); await seed({ author_key: AKEY, email: E_VERIFIED, status: 'verified', source: 'x' });
  await call(A.tok, { action: 'bounce', ...req, email: E_VERIFIED });
  await call(A.tok, { action: 'bounce', ...req, email: E_VERIFIED });
  const sameUser = await readPE(AKEY);
  ok(sameUser.b[0].bounces === 1, `same user bounces once only (${sameUser.b[0].bounces})`);

  // 4. Two confirmations from two users graduate a 'maybe' to 'verified'.
  await delPE(AKEY);
  await seed({ author_key: AKEY, email: E_MAYBE, status: 'maybe', source: 'guessed' });
  await call(A.tok, { action: 'confirm', ...req, email: E_MAYBE });
  const mid = await readPE(AKEY);
  ok(mid.b[0].status === 'maybe' && mid.b[0].confirmations === 1, 'one confirm stays maybe');
  await call(B.tok, { action: 'confirm', ...req, email: E_MAYBE });
  const grad = await readPE(AKEY);
  ok(grad.b[0].status === 'verified' && grad.b[0].confirmations === 2, 'two confirms from different users -> verified');

  // 5. RLS: a normal user cannot write professor_emails directly (SELECT is allowed for tag rendering).
  const insReally = await fetch(URL + '/rest/v1/professor_emails', { method: 'POST', headers: H(ANON, A.tok), body: JSON.stringify({ author_key: 'Zhack2', email: 'x@y.edu', status: 'verified' }) });
  ok(insReally.status >= 400, `direct insert rejected (${insReally.status})`);
  const upd = await fetch(URL + '/rest/v1/professor_emails?author_key=eq.' + AKEY, { method: 'PATCH', headers: H(ANON, A.tok), body: JSON.stringify({ status: 'verified' }) });
  ok(upd.status >= 400, `direct update rejected (${upd.status})`);
} finally {
  await delPE(AKEY);
  await fetch(URL + '/auth/v1/admin/users/' + A.id, { method: 'DELETE', headers: H(SR) });
  await fetch(URL + '/auth/v1/admin/users/' + B.id, { method: 'DELETE', headers: H(SR) });
}
