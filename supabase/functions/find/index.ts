// POST /functions/v1/find  { query: string, country?: "US", years?: 3 }
// Finds active professors whose RECENT papers match a student's interests.
// Method: search OpenAlex for recent articles matching the query, take each paper's LAST author
// (in most STEM fields the senior author / lab head), group by person, and rank by how many
// matching recent papers they lead, weighted by recency and citations. Free; no credits charged.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } });
const MAILTO = "mailto=stemrankings@kahlus.com";

import { rankProfessors } from "./rank.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const query = String(body.query ?? "").trim().slice(0, 200);
  if (query.length < 3) return json({ error: "Describe what you want to research (a few words)." }, 400);
  const years = Math.min(Math.max(Number(body.years) || 3, 1), 6);
  const from = `${new Date().getFullYear() - years + 1}-01-01`;
  const country = body.country ? String(body.country).toUpperCase().slice(0, 2) : undefined;

  const works: any[] = [];
  // Two pages of 200 = up to 400 recent matching articles. Enough to surface the active labs.
  for (const page of [1, 2]) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}`
      + `&filter=from_publication_date:${from},type:article`
      + (country ? `,authorships.institutions.country_code:${country}` : "")
      + `&per-page=200&page=${page}&select=title,publication_year,cited_by_count,doi,authorships,primary_location&${MAILTO}`;
    const r = await fetch(url);
    if (!r.ok) break;
    const d = await r.json();
    works.push(...(d.results ?? []));
    if ((d.results ?? []).length < 200) break;
  }
  const profs = rankProfessors(works, { country }).slice(0, 40);
  return json({ query, years, country: country ?? null, matched_papers: works.length, professors: profs });
});
