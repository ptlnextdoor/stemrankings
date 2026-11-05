// The needalab assistant, on Etch's agent dock (js/ui/dock.js + css/agent.css, from github.com/ptlnextdoor/etch).
// A pill with eyes at the bottom of the page. Hover melts it open into a panel; while closed, each running step buds
// off the pill as a bubble and drops back in when done. Type or say a research topic and it runs the real search:
//
//   ask -> step "Reading recent papers" (bubble) -> find edge function -> step done -> answer streams the top labs
//       -> "Show all N labs" runs the same search in the page's results list
//
// Free and signed-out friendly: it only calls the public find function, the same one the search box uses.
import { createDock } from "./dock.js";

const URL_FIND = "https://oxcnlommtnziwfbpxigd.supabase.co/functions/v1/find";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94Y25sb21tdG56aXdmYnB4aWdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDkzNTcsImV4cCI6MjEwNzEyNTM1N30._6MDpHUC41GsvD6OQJsn3AXlJBAlVqkq__46QwE_JH8";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const country = () => document.getElementById("find-country")?.value || undefined;

let dock, n = 0, busy = false;

async function run(text) {
  const q = String(text || "").replace(/^(find|show me|search( for)?|labs? (for|on|in)|i want to research)\s+/i, "").trim();
  if (q.length < 3) { dock.say("Tell me a research topic, like soft robotics or CRISPR."); return; }
  if (busy) { dock.say("Still looking. One second."); return; }
  busy = true;
  const id = "q" + ++n;
  dock.setState("working");
  dock.emote("nod");
  dock.step({ id: id + ":read", kind: "step", title: `Reading recent papers on ${q}`, status: "running" });
  const t0 = performance.now();
  try {
    const headers = { "Content-Type": "application/json", apikey: ANON };
    const tok = JSON.parse(localStorage.getItem("sb-oxcnlommtnziwfbpxigd-auth-token") || "null")?.access_token;
    if (tok) headers.Authorization = "Bearer " + tok;
    const r = await fetch(URL_FIND, { method: "POST", headers, body: JSON.stringify({ query: q, country: country(), years: 3 }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Search failed");
    dock.step({ id: id + ":read", kind: "step", title: `Read ${d.matched_papers?.toLocaleString?.() ?? "recent"} papers on ${q}`, status: "done" });
    const profs = d.professors || [];
    if (!profs.length) {
      dock.setState("confused");
      dock.say(`I couldn't find active labs for ${q}. Try the technique instead of the application.`);
      return;
    }
    dock.step({ id: id + ":rank", kind: "step", title: `Ranking ${profs.length} labs by recent work they lead`, status: "running" });
    await sleep(380);
    dock.step({ id: id + ":rank", kind: "step", title: `Ranked ${profs.length} labs`, status: "done" });
    dock.answerStart(id);
    const lines = [`**${profs.length} labs** are leading recent work on ${q}. The most active:`, ""];
    profs.slice(0, 5).forEach((p, i) => {
      const paper = p.papers?.[0]?.title;
      lines.push(`${i + 1}. **${p.name}**, ${p.institution || "unknown institution"}, active ${p.latest_year}${paper ? `. Latest: ${paper}` : ""}`);
    });
    lines.push("", "Open any of them in the list below to see their papers and draft an email.");
    // stream it a few words at a time so it reads like it's being written
    for (const chunk of lines.join("\n").match(/\S+\s*|\n/g) || []) { dock.answerAppend(id, chunk); await sleep(14); }
    dock.answerEnd(id, { seconds: (performance.now() - t0) / 1000 });
    dock.setState("success");
    // the page's own results list shows the same search, ready to save and draft
    const box = document.getElementById("find-q");
    if (box && window.srFind) { box.value = q; window.srFind({ preventDefault() {} }); }
  } catch (e) {
    dock.step({ id: id + ":read", kind: "step", title: "Search failed", detail: String(e.message || e), status: "failed" });
    dock.setState("error");
    dock.say("Something went wrong with that search. Try again in a moment.");
  } finally {
    busy = false;
    setTimeout(() => dock.setState("idle"), 2400);
  }
}

dock = createDock(document.body, { onSend: (text) => run(text) });
dock.setState("idle");
// the page's search box talks to the dock too: the pill reacts when a search starts
document.getElementById("find-form")?.addEventListener("submit", () => { dock.nudge?.(); dock.emote("nod"); });
window.nlDock = dock;
