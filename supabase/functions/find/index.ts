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

import { rankProfessors } from "./rank.ts";
import { cached, oaJson, OpenAlexLimited } from "../_shared/openalex.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const query = String(body.query ?? "").trim().slice(0, 200);
  if (query.length < 3) return json({ error: "Describe what you want to research (a few words)." }, 400);
  const years = Math.min(Math.max(Number(body.years) || 3, 1), 6);
  const from = `${new Date().getFullYear() - years + 1}-01-01`;
  const country = body.country ? String(body.country).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || undefined : undefined;
  const key = `find:${query.toLowerCase().replace(/\s+/g, " ")}|${country ?? "*"}|${years}`;
  try {
    // One search call (100 newest matching articles) per uncached query; results cached 24h.
    const result = await cached(key, 24, async () => {
      const d = await oaJson(`works?search=${encodeURIComponent(query)}`
        + `&filter=from_publication_date:${from},type:article`
        + (country ? `,authorships.institutions.country_code:${country}` : "")
        + `&per-page=100&select=title,publication_year,cited_by_count,doi,authorships,primary_location`);
      const works = d?.results ?? [];
      return { query, years, country: country ?? null, matched_papers: works.length, professors: rankProfessors(works, { country }).slice(0, 40) };
    });
    return json(result);
  } catch (e) {
    if (e instanceof OpenAlexLimited) return json({ error: e.message, limited: true }, 503);
    return json({ error: (e as Error).message }, 502);
  }
});
