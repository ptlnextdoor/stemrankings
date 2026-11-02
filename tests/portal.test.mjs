// Owner portal + roast form, against the live backend. No dependencies (drives Chrome over CDP like the other UI tests).
// Serve the repo, then: SR=<service key> ANON=<anon key> PAGE=http://localhost:8765/ node tests/portal.test.mjs
import { spawn } from "node:child_process";
const U = "https://oxcnlommtnziwfbpxigd.supabase.co", { SR, ANON, PAGE } = process.env;
const H = (k, t) => ({ apikey: k, Authorization: "Bearer " + (t || k), "Content-Type": "application/json" });
const ok = (c, m) => { console.log((c ? "ok  " : "FAIL") + " " + m); if (!c) process.exitCode = 1; };
const OWNER = "aayu22809@gmail.com", STRANGER = "portal-stranger@example.com", XSS = '<img src=x onerror="window.__pwned=1">';
const call = (body, tok) => fetch(U + "/functions/v1/portal", { method: "POST", headers: tok ? H(ANON, tok) : { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const users = async () => (await (await fetch(U + "/auth/v1/admin/users?per_page=1000", { headers: H(SR) })).json()).users;
const purge = async (e) => { for (const u of (await users()).filter((u) => u.email === e)) await fetch(U + "/auth/v1/admin/users/" + u.id, { method: "DELETE", headers: H(SR) }); };
// Real session for a user via a one-time magic link token (no password needed, works for the real owner too).
async function session(email) {
  const l = await (await fetch(U + "/auth/v1/admin/generate_link", { method: "POST", headers: H(SR), body: JSON.stringify({ type: "magiclink", email }) })).json();
  return (await (await fetch(U + "/auth/v1/verify", { method: "POST", headers: H(ANON), body: JSON.stringify({ type: "magiclink", token_hash: l.hashed_token }) })).json());
}
await purge(STRANGER);
await fetch(U + "/auth/v1/admin/users", { method: "POST", headers: H(SR), body: JSON.stringify({ email: STRANGER, email_confirm: true }) });
const stranger = await session(STRANGER), owner = await session(OWNER);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--remote-debugging-port=9337", "--user-data-dir=/tmp/cdp-portal-" + Date.now(), "about:blank"], { stdio: "ignore" });
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch("http://127.0.0.1:9337/json")).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let mid = 0; const pend = {}; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++mid; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
const until = async (expr, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await sleep(250); } return false; };
const go = async (url) => { await send("Page.navigate", { url }); await sleep(600); };
const asUser = async (s) => { await ev(`localStorage.clear(); ${s ? `localStorage.setItem('sb-oxcnlommtnziwfbpxigd-auth-token', ${JSON.stringify(JSON.stringify(s))})` : ""}`); await send("Page.reload"); await sleep(600); };
try {
  ok((await call({ action: "dashboard" })).status === 404, "signed out: dashboard hidden (404)");
  ok((await call({ action: "dashboard" }, stranger.access_token)).status === 404, "non-owner: dashboard hidden (404)");
  ok((await fetch(U + "/rest/v1/feedback?select=*", { headers: H(ANON, stranger.access_token) })).status >= 400 || (await (await fetch(U + "/rest/v1/feedback?select=*", { headers: H(ANON, stranger.access_token) })).json()).length === 0, "users can't read the feedback table");
  ok((await fetch(U + "/rest/v1/rpc/owner_dashboard", { method: "POST", headers: H(ANON, stranger.access_token), body: "{}" })).status >= 400, "users can't call owner_dashboard() directly");
  ok((await call({ action: "feedback", feature: "", roast: "x" })).status === 400, "empty roast rejected");
  const r = await call({ action: "feedback", feature: "Email drafts", roast: "portal test roast " + XSS }, stranger.access_token);
  ok(r.status === 200, "signed-in roast accepted");
  const d = await (await call({ action: "dashboard" }, owner.access_token)).json();
  ok(Array.isArray(d.users) && d.users.length > 0 && d.segments && d.daily?.length === 14, "owner gets users, segments, 14 days");
  ok(d.stripe && ("gross_cents" in d.stripe || "error" in d.stripe), "owner gets Stripe money block" + (d.stripe?.error ? " (Stripe: " + d.stripe.error + ")" : ""));
  const mine = d.feedback.find((f) => f.roast.startsWith("portal test roast"));
  ok(mine && mine.email === STRANGER && mine.feature === "Email drafts", "roast shows up for owner with email + feature");

  await go(PAGE + "admin/"); await asUser(owner);
  await until(`/Balance sheet/.test(document.querySelector('main').innerText)`);
  const txt = await ev(`document.querySelector('main').innerText`);
  ok(/Balance sheet/.test(txt) && /Cost by user type/.test(txt) && /Roasts/.test(txt), "owner portal page renders all sections");
  ok(!(await ev("window.__pwned")) && txt.includes("<img src=x"), "roast with HTML renders as text, not code");
  await asUser(stranger);
  ok(await until(`/isn't the owner/.test(document.querySelector('main').innerText)`), "non-owner sees 'isn't the owner' on /admin/");
  await go(PAGE); await asUser(null);
  await until(`!!document.getElementById('roast-form')`);
  await ev(`document.getElementById('roast').open = true; document.getElementById('roast-feature').value = 'Speed'; document.getElementById('roast-text').value = 'portal test roast signed out'; document.getElementById('roast-form').requestSubmit()`);
  ok(await until(`/Thanks/.test(document.getElementById('roast-msg').textContent)`), "signed-out roast from the footer form works");
} finally {
  ws.close(); chrome.kill();
  // Remove test roasts; keep the real owner account untouched.
  await fetch(U + "/rest/v1/feedback?roast=like.portal%20test%20roast*", { method: "DELETE", headers: H(SR) });
  await purge(STRANGER);
}
