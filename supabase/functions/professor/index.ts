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

import { summarize } from "./summarize.ts";
import { cached, oaJson, OpenAlexLimited } from "../_shared/openalex.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const { id } = await req.json().catch(() => ({}));
  if (!/^A\d{4,12}$/.test(String(id ?? ""))) return json({ error: "Invalid professor id" }, 400);
  try {
    const out = await cached(`prof:${id}`, 72, async () => {
      // Author lookup by id is a free "singleton" call; the works list is one cheap list call.
      const [author, works] = await Promise.all([
        oaJson(`authors/${id}?select=id,display_name,orcid,last_known_institutions,works_count,cited_by_count,summary_stats,topics,counts_by_year`),
        oaJson(`works?filter=author.id:${id},type:article&sort=publication_date:desc&per-page=25&select=title,publication_year,doi,cited_by_count,authorships,primary_location`),
      ]);
      if (!author) return null;
      return summarize(author, works?.results ?? []);
    });
    if (!out) return json({ error: "Professor not found" }, 404);
    return json(out);
  } catch (e) {
    if (e instanceof OpenAlexLimited) return json({ error: e.message, limited: true }, 503);
    return json({ error: "OpenAlex is unavailable; try again shortly." }, 502);
  }
});
