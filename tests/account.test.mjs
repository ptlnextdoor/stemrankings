// Account export/delete + checkout for any 13+ age, against the live backend. No dependencies.
// SR=<service key> ANON=<anon key> node tests/account.test.mjs
const U = "https://oxcnlommtnziwfbpxigd.supabase.co", { SR, ANON } = process.env;
const H = (k, t) => ({ apikey: k, Authorization: "Bearer " + (t || k), "Content-Type": "application/json" });
const ok = (c, m) => { console.log((c ? "ok  " : "FAIL") + " " + m); if (!c) process.exitCode = 1; };
const Y = new Date().getFullYear();
const users = async () => (await (await fetch(U + "/auth/v1/admin/users?per_page=1000", { headers: H(SR) })).json()).users;
const purge = async (e) => { for (const u of (await users()).filter((u) => u.email === e)) await fetch(U + "/auth/v1/admin/users/" + u.id, { method: "DELETE", headers: H(SR) }); };
async function make(email, birth_year) {
  await purge(email);
  await fetch(U + "/auth/v1/admin/users", { method: "POST", headers: H(SR), body: JSON.stringify({ email, email_confirm: true }) });
  const l = await (await fetch(U + "/auth/v1/admin/generate_link", { method: "POST", headers: H(SR), body: JSON.stringify({ type: "magiclink", email }) })).json();
  const s = await (await fetch(U + "/auth/v1/verify", { method: "POST", headers: H(ANON), body: JSON.stringify({ type: "magiclink", token_hash: l.hashed_token }) })).json();
  await fetch(U + "/rest/v1/profiles?id=eq." + s.user.id, { method: "PATCH", headers: H(SR), body: JSON.stringify({ birth_year, display_name: "Acct Tester" }) });
  return { tok: s.access_token, id: s.user.id };
}
const fn = async (name, tok, body) => { const r = await fetch(U + "/functions/v1/" + name, { method: "POST", headers: H(ANON, tok), body: JSON.stringify(body) }); return { s: r.status, b: await r.json().catch(() => ({})) }; };
const rows = async (t, col, id) => (await (await fetch(`${U}/rest/v1/${t}?select=*&${col}=eq.${id}`, { headers: H(SR) })).json()).length;

const TEEN = "acct-teen@example.com", ADULT = "acct-adult@example.com", OTHER = "acct-other@example.com";
try {
  const teen = await make(TEEN, Y - 16), adult = await make(ADULT, Y - 20), other = await make(OTHER, Y - 20);
  await fetch(U + "/rest/v1/user_docs", { method: "POST", headers: H(ANON, teen.tok), body: JSON.stringify({ kind: "resume", content: "Junior at Lynbrook High, built an Arduino soil sensor network." }) });
  await fetch(U + "/rest/v1/saved_professors", { method: "POST", headers: H(ANON, teen.tok), body: JSON.stringify({ author_name: "Ryan L. Truby", openalex_id: "A5058930967" }) });

  // Export
  ok((await fn("account", null, { action: "export" })).s === 401, "export needs sign-in");
  const ex = await fn("account", teen.tok, { action: "export" });
  ok(ex.s === 200 && ex.b.account.email === TEEN && ex.b.documents.length === 1 && ex.b.saved_professors.length === 1 && ex.b.credit_history.length >= 1, "export returns my account, docs, saved list and credit history");
  ok(!JSON.stringify(ex.b).includes(OTHER), "export contains nobody else's data");

  // Any age 13+ can buy the plan themselves.
  const co = await fn("billing", teen.tok, { action: "checkout" });
  ok(co.s === 200 && /^https:\/\/checkout\.stripe\.com\//.test(co.b.url || ""), "16-year-old gets a Stripe checkout");
  const ad = await fn("billing", adult.tok, { action: "checkout" });
  ok(ad.s === 200 && /checkout\.stripe\.com/.test(ad.b.url || ""), "adult gets a Stripe checkout");
  // Delete
  ok((await fn("account", teen.tok, { action: "delete" })).s === 400, "delete without typing DELETE is refused");
  ok((await fn("account", other.tok, { action: "delete", confirm: "DELETE" })).s === 200 && (await rows("profiles", "id", teen.id)) === 1, "deleting one account leaves others alone");
  const del = await fn("account", teen.tok, { action: "delete", confirm: "DELETE" });
  ok(del.s === 200, "delete with DELETE succeeds");
  const left = (await rows("profiles", "id", teen.id)) + (await rows("user_docs", "user_id", teen.id)) + (await rows("saved_professors", "user_id", teen.id)) + (await rows("credit_ledger", "user_id", teen.id));
  ok(left === 0 && !(await users()).some((u) => u.id === teen.id), "account, profile, docs, saved list and ledger are all gone");
  ok((await fn("account", teen.tok, { action: "export" })).s === 401, "old session stops working after delete");
} finally {
  for (const e of [TEEN, ADULT, OTHER]) await purge(e);
}
