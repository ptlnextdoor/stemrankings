// POST /functions/v1/problems-ingest  { max?: number }   (service role only; called by a daily GitHub Action)
// Reads the newest arXiv papers in a few student-friendly categories, cuts out each paper's closing
// section (limitations / future work / conclusion), asks the model for small work packages a strong
// high schooler could do with open data, and keeps only ones whose quoted source sentence really is
// in the paper. Each paper is read once (arxiv_scanned), so daily cost is bounded by `max`.
//
//   arXiv feed -> new ids -> arxiv.org/html/<id> -> closingSection -> LLM -> validPackages -> upsert
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { closingSection, htmlToText, parseFeed, parseJsonArray, validPackages, type Paper } from "./extract.ts";

// Computational fields where a student can do real work on a laptop with public data.
const CATS = ["cs.LG", "stat.ML", "stat.AP", "q-bio.QM", "q-bio.PE", "physics.ao-ph", "eess.SP", "cs.CY", "econ.EM", "astro-ph.IM"];
const UA = { "User-Agent": "needalab/1.0 (hello@needalab.com)" };

const SYSTEM = `You scope research work packages for a strong high school student: knows Python, pandas and basic statistics, can read papers. They have NO lab, NO special hardware, NO paid compute beyond free Colab, and cannot get credentialed or request-only datasets.
From the closing section of a paper, output 0 to 2 packages that are genuinely doable in 3 to 25 hours and that the authors would value. Prefer reproducing a figure or table, extending to a new public dataset, a benchmark the authors named, or a small reusable tool. Reject anything needing a lab, hardware, proprietary or credentialed data, or months of work: output [] if nothing qualifies.
Output ONLY a JSON array. Each item:
{"title":"imperative, <=10 words","source":"the exact sentence from the text that motivates it, copied verbatim","deliverable":"concrete artifact","inputs":"data and code needed, named","open_data":true,"hours_min":8,"hours_max":12,"skills":["python","pandas"],"tier":"reproduce|extend|benchmark|tooling","value":"why the authors care, <=15 words"}`;

async function llm(user: string): Promise<string> {
  const ak = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ak) throw new Error("NO_LLM_KEY");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-5-5", max_tokens: 900, thinking: { type: "disabled" }, system: SYSTEM, messages: [{ role: "user", content: user }] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("LLM " + (d.error?.message ?? r.status));
  return d.content.map((c: { text?: string }) => c.text ?? "").join("");
}

async function newestPapers(): Promise<Paper[]> {
  const q = CATS.map((c) => "cat:" + c).join("+OR+");
  const r = await fetch(`https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=60`, { headers: UA });
  if (!r.ok) throw new Error("arXiv feed " + r.status);
  return parseFeed(await r.text());
}

Deno.serve(async (req) => {
  const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if ((req.headers.get("authorization") ?? "") !== "Bearer " + sr) return new Response("forbidden", { status: 403 });
  const { max = 15 } = await req.json().catch(() => ({}));
  const cap = Math.min(Math.max(1, Number(max) || 15), 40);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, sr);

  const papers = await newestPapers();
  const { data: seen } = await db.from("arxiv_scanned").select("arxiv_id").in("arxiv_id", papers.map((p) => p.id));
  const done = new Set((seen ?? []).map((s) => s.arxiv_id));
  const todo = papers.filter((p) => !done.has(p.id)).slice(0, cap);

  let added = 0;
  const log: string[] = [];
  for (const p of todo) {
    let n = 0, note = "";
    try {
      const h = await fetch(`https://arxiv.org/html/${p.id}`, { headers: UA });
      const text = h.ok ? htmlToText(await h.text()) : "";
      const sec = text ? closingSection(text) : null;
      if (!sec) note = h.ok ? "no closing section" : "no html " + h.status;
      else {
        const pkgs = validPackages(parseJsonArray(await llm(`Paper: ${p.title}\n\n${sec}`)), sec);
        const rows = pkgs.map((k, i) => ({
          id: `WP-${p.id}-${i + 1}`, arxiv_id: p.id, paper_title: p.title.slice(0, 500), paper_authors: p.authors.slice(0, 12),
          paper_published: p.published || null, category: p.category.slice(0, 40), title: k.title, source_quote: k.source,
          deliverable: k.deliverable, inputs: k.inputs, hours_min: k.hours_min, hours_max: k.hours_max, skills: k.skills,
          tier: k.tier, value: k.value || null,
        }));
        if (rows.length) {
          const { error } = await db.from("work_packages").upsert(rows);
          if (error) throw new Error(error.message);
        }
        n = rows.length;
        note = n ? "ok" : "nothing doable";
      }
    } catch (e) {
      note = String((e as Error).message).slice(0, 180);
      if (note === "NO_LLM_KEY" || note.startsWith("LLM")) { log.push(`${p.id}: ${note}`); break; } // don't mark as scanned
    }
    await db.from("arxiv_scanned").upsert({ arxiv_id: p.id, packages: n, note: note.slice(0, 200) });
    added += n;
    log.push(`${p.id}: ${note}${n ? ` (+${n})` : ""}`);
  }
  return new Response(JSON.stringify({ scanned: todo.length, added, log }), { headers: { "Content-Type": "application/json" } });
});
