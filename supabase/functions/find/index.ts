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
import { cached, db, oaJson, OpenAlexLimited } from "../_shared/openalex.ts";

// New (uncached) searches per UTC day. Cached searches are free and never count.
// The site-wide OpenAlex budget is ~1,000 searches/day, so these keep one person from using it up.
const LIMIT = { anon: 10, free: 30 };

class QuotaHit extends Error {}

async function who(req: Request): Promise<{ key: string; limit: number }> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (jwt && jwt !== Deno.env.get("SUPABASE_ANON_KEY")) {
    const { data } = await db().auth.getUser(jwt);
    if (data?.user) {
      const { data: p } = await db().from("profiles").select("plan").eq("id", data.user.id).single();
      return { key: "u:" + data.user.id, limit: p?.plan === "pro" ? Infinity : LIMIT.free };
    }
  }
  // Many networks rotate outbound IPs within a block, so cap the /24 (IPv4) or /48 (IPv6), not the exact address.
  const raw = req.headers.get("cf-connecting-ip") ?? req.headers.get("sb-forwarded-for") ?? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const net = raw.includes(":") ? raw.split(":").slice(0, 3).join(":") : raw.split(".").slice(0, 3).join(".");
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sr-search:" + (net || "unknown")));
  return { key: "ip:" + [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join(""), limit: LIMIT.anon };
}

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
    // One OpenAlex call (200 most relevant recent articles) per uncached query; cached 24h.
    const result = await cached(key, 24, async () => {
      const w = await who(req);
      if (w.limit !== Infinity) {
        const { data: ok } = await db().rpc("take_search", { p_who: w.key, p_limit: w.limit });
        if (ok === false) throw new QuotaHit();
      }
      const d = await oaJson(`works?search=${encodeURIComponent(query)}`
        + `&filter=from_publication_date:${from},type:article`
        + (country ? `,authorships.institutions.country_code:${country}` : "")
        + `&per-page=200&select=title,publication_year,cited_by_count,doi,authorships,primary_location`);
      const works = d?.results ?? [];
      return { query, years, country: country ?? null, matched_papers: works.length, total_papers: d?.meta?.count ?? works.length, professors: rankProfessors(works, { country }).slice(0, 100) };
    });
    return json(result);
  } catch (e) {
    if (e instanceof QuotaHit) {
      return json({ error: "You've hit today's limit for new searches. Searches other people already ran still work, and the limit resets at midnight UTC. Sign in (free) for more, or get the plan for unlimited.", quota: true }, 429);
    }
    if (e instanceof OpenAlexLimited) return json({ error: e.message, limited: true }, 503);
    return json({ error: (e as Error).message }, 502);
  }
});
