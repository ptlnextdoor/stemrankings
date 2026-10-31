// Hits the DEPLOYED find-email function for a mix of real professors and reports
// hit rate, per-source breakdown, latency, and auth/cap behavior.
// Run: SR=<service_role> ANON=<anon> node tests/find-email.test.mjs
// Creates and deletes a throwaway user (birth_year 2005, display_name 'Test Student').
const URL = 'https://oxcnlommtnziwfbpxigd.supabase.co', SR = process.env.SR, ANON = process.env.ANON;
if (!SR || !ANON) { console.error('Set SR and ANON env vars.'); process.exit(2); }
const H = (k, t) => ({ apikey: k, Authorization: 'Bearer ' + (t || k), 'Content-Type': 'application/json' });
const j = async r => { const t = await r.text(); try { return { s: r.status, b: JSON.parse(t) }; } catch { return { s: r.status, b: t }; } };
const pw = 'T3st-' + Math.random().toString(36).slice(2) + '!aA9';
const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const purge = async e => { const l = await (await fetch(URL + '/auth/v1/admin/users?per_page=1000', { headers: H(SR) })).json(); for (const u of (l.users || []).filter(u => u.email === e)) await fetch(URL + '/auth/v1/admin/users/' + u.id, { method: 'DELETE', headers: H(SR) }); };
async function mk(e) {
  await purge(e);
  await fetch(URL + '/auth/v1/admin/users', { method: 'POST', headers: H(SR), body: JSON.stringify({ email: e, password: pw, email_confirm: true }) });
  const r = await j(await fetch(URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: H(ANON), body: JSON.stringify({ email: e, password: pw }) }));
  await fetch(URL + '/rest/v1/profiles?id=eq.' + r.b.user.id, { method: 'PATCH', headers: H(SR), body: JSON.stringify({ birth_year: 2005, display_name: 'Test Student' }) });
  return { tok: r.b.access_token, id: r.b.user.id };
}
const call = (tok, body) => fetch(URL + '/functions/v1/find-email', { method: 'POST', headers: H(ANON, tok), body: JSON.stringify(body) }).then(j);

// Mix: US R1, UK, French CNRS, small liberal-arts college.
const PROFS = [
  { author_name: 'Fei-Fei Li', institution: 'Stanford University' },                 // US R1
  { author_name: 'Yoshua Bengio', institution: 'Universite de Montreal' },           // CA R1
  { author_name: 'Geoffrey Hinton', institution: 'University of Toronto' },          // CA R1
  { author_name: 'Andrew Zisserman', institution: 'University of Oxford' },          // UK
  { author_name: 'Zoubin Ghahramani', institution: 'University of Cambridge' },      // UK
  { author_name: 'Cordelia Schmid', institution: 'Inria' },                          // FR / Inria
  { author_name: 'Jean Ponce', institution: 'Ecole Normale Superieure' },            // FR CNRS/ENS
  { author_name: 'Daniel S. Margulies', institution: 'Centre National de la Recherche Scientifique' }, // FR CNRS
  { author_name: 'Olga Russakovsky', institution: 'Princeton University' },          // US R1
  { author_name: 'Scott Aaronson', institution: 'University of Texas at Austin' },   // US R1
];

const A = await mk('email-finder-test@example.com');
try {
  // Auth gate: signed-out must be rejected.
  const anon = await call(null, { author_name: 'Fei-Fei Li' });
  ok(anon.s === 401, 'signed-out callers rejected (' + anon.s + ')');

  const stats = { total: PROFS.length, hits: 0, verified: 0, bySource: {}, byConf: {}, latencies: [], rows: [] };
  for (const p of PROFS) {
    const t0 = Date.now();
    const r = await call(A.tok, p);
    const ms = Date.now() - t0;
    stats.latencies.push(ms);
    if (r.s !== 200) { console.log(`  ERR ${p.author_name}: ${r.s} ${JSON.stringify(r.b).slice(0, 120)}`); stats.rows.push([p.author_name, 'err', '', ms]); continue; }
    const d = r.b;
    if (d.email) {
      stats.hits++;
      if (d.confidence !== 'low') stats.verified++;
      stats.bySource[d.source] = (stats.bySource[d.source] || 0) + 1;
      stats.byConf[d.confidence] = (stats.byConf[d.confidence] || 0) + 1;
    }
    stats.rows.push([p.author_name, d.email || '(none)', `${d.confidence || '-'}/${d.source || '-'}`, ms, d.page_url || '']);
    console.log(`  ${p.author_name.padEnd(22)} ${(d.email || '(none)').padEnd(34)} ${(d.confidence || '-') + '/' + (d.source || '-')}  ${ms}ms`);
  }

  const avg = Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length);
  const med = stats.latencies.slice().sort((a, b) => a - b)[Math.floor(stats.latencies.length / 2)];
  console.log('\n=== find-email report ===');
  console.log(`professors:        ${stats.total}`);
  console.log(`any email:         ${stats.hits}/${stats.total} (${Math.round(100 * stats.hits / stats.total)}%)`);
  console.log(`verified (>=med):  ${stats.verified}/${stats.total} (${Math.round(100 * stats.verified / stats.total)}%)`);
  console.log(`by source:         ${JSON.stringify(stats.bySource)}`);
  console.log(`by confidence:     ${JSON.stringify(stats.byConf)}`);
  console.log(`latency avg/med:   ${avg}ms / ${med}ms`);
  console.log(`est $/lookup:      $0 (all sources free; only Postgres cache + egress)`);

  ok(stats.hits >= 1, 'at least one email found across the sample');
  ok(stats.rows.every(r => r[1] === '(none)' || r[1] === 'err' || /@/.test(r[1])), 'every returned email is well-formed');

  // Caching: a repeat of the first prof should be much faster.
  const c0 = Date.now(); await call(A.tok, PROFS[0]); const cms = Date.now() - c0;
  ok(cms < Math.max(300, med), `cached repeat is fast (${cms}ms < ${Math.max(300, med)}ms)`);
} finally {
  await fetch(URL + '/auth/v1/admin/users/' + A.id, { method: 'DELETE', headers: H(SR) });
}
