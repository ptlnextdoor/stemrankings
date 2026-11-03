// needalab HN-polish UI checks, signed out, against a served worktree. No dependencies (drives
// Chrome over CDP like the other UI tests). Copied harness from tests/portal.test.mjs.
// Serve the worktree, then: PAGE=http://localhost:8790/ node tests/polish.test.mjs
import { spawn } from "node:child_process";
const { PAGE } = process.env;
if (!PAGE) { console.log("FAIL set PAGE=http://localhost:8790/"); process.exit(1); }
const ok = (c, m) => { console.log((c ? "ok  " : "FAIL") + " " + m); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--disable-gpu", "--remote-debugging-port=9342", "--user-data-dir=/tmp/cdp-polish-" + Date.now(), "about:blank"], { stdio: "ignore" });
let tabs; for (let i = 0; i < 40; i++) { try { tabs = await (await fetch("http://127.0.0.1:9342/json")).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let mid = 0; const pend = {}; ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
const send = (method, params = {}) => new Promise((r) => { const i = ++mid; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
const until = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await sleep(250); } return false; };
const go = async (url) => { await send("Page.navigate", { url }); await sleep(800); };
try {
  await send("Page.enable");
  // --- Home page, signed out ---
  await go(PAGE);
  await until(`!!document.querySelector('h1')`);
  ok(await ev(`document.title.toLowerCase().includes('needalab')`), "page title says needalab");
  ok(await ev(`document.querySelector('h1').textContent.trim() === 'needalab'`), "H1 is needalab");
  ok(!(await ev(`/STEMRankings/.test(document.body.innerText)`)), "no 'STEMRankings' visible on home");
  ok(await ev(`!!document.querySelector('.nl-tagline') && /\\$0\\.25/.test(document.querySelector('.nl-tagline').textContent) && /\\$1 free/.test(document.querySelector('.nl-tagline').textContent)`), "pricing line visible signed out (0.25 + $1 free)");
  ok(await ev(`!!document.querySelector('link[rel=icon]')`), "favicon link present");
  ok(await ev(`!!document.querySelector('meta[property="og:title"]') && !!document.querySelector('meta[property="og:image"]')`), "OpenGraph title + image present");

  // --- Empty / short search shows a message and focuses the box ---
  await ev(`document.getElementById('find-q').value=''; window.srFind({preventDefault(){}})`);
  ok(await until(`/research topic/i.test(document.getElementById('find-out').innerText)`), "empty search shows a message");
  ok(await ev(`document.activeElement === document.getElementById('find-q')`), "empty search focuses the box");

  // --- Stopword-only query handled client side (no server call) ---
  await ev(`document.getElementById('find-q').value='the and of for'; window.srFind({preventDefault(){}})`);
  ok(await until(`/research topic/i.test(document.getElementById('find-out').innerText)`), "stopword-only query shows the topic prompt");

  // --- Zero-result search shows clickable example chips ---
  await ev(`document.getElementById('find-q').value='zzzqqxnonsensetopicxyz'; window.srFind({preventDefault(){}})`);
  ok(await until(`document.querySelectorAll('.find-examples button').length >= 4`, 25000), "zero-result search shows example chips");

  // --- Signed-out professor panel nudge appears under the buttons ---
  // Open a panel directly via the finder's global (uses a real OpenAlex id for Ryan L. Truby).
  await ev(`window.srOpenProfessor && window.srOpenProfessor('A5058930967')`);
  ok(await until(`!!document.querySelector('#prof-panel .pp-draft')`, 20000), "professor panel opens");
  await ev(`document.querySelector('#prof-panel .pp-draft').click()`);
  ok(await until(`(() => { const n = document.querySelector('#prof-panel .pp-nudge'); return n && !n.hidden && /Sign in/.test(n.textContent); })()`), "signed-out panel nudge appears under the buttons");

  // --- 404 page renders in the site style ---
  await go(PAGE + "404.html");
  ok(await ev(`/not found/i.test(document.querySelector('h1').textContent)`), "/404.html renders with a heading");
  ok(await ev(`!!document.querySelector('a[href="/"]')`), "/404.html has a link home");
} finally {
  ws.close(); chrome.kill();
}
