// POST /functions/v1/professor  { id: "A5020214490" }  (OpenAlex author id). Free.
// Returns what a student needs before emailing: affiliation, research topics, how active they are,
// their recent first/last-author papers, and frequent recent collaborators.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } });
const MAILTO = "mailto=stemrankings@kahlus.com";

import { summarize } from "./summarize.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { id } = await req.json().catch(() => ({}));
  if (!/^A\d{4,12}$/.test(String(id ?? ""))) return json({ error: "Invalid professor id" }, 400);
  const [ar, wr] = await Promise.all([
    fetch(`https://api.openalex.org/authors/${id}?select=id,display_name,orcid,last_known_institutions,works_count,cited_by_count,summary_stats,topics,counts_by_year&${MAILTO}`),
    fetch(`https://api.openalex.org/works?filter=author.id:${id},type:article&sort=publication_date:desc&per-page=25&select=title,publication_year,doi,cited_by_count,authorships,primary_location&${MAILTO}`),
  ]);
  if (ar.status === 404) return json({ error: "Professor not found" }, 404);
  if (!ar.ok || !wr.ok) return json({ error: "OpenAlex is unavailable; try again shortly." }, 502);
  const author = await ar.json(), works = (await wr.json()).results ?? [];
  return json(summarize(author, works));
});
