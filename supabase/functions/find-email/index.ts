// Supabase Edge Function: POST /functions/v1/find-email
// Body: { author_name, institution?, openalex_id?, orcid? }
// Auth: caller's Supabase JWT (verify_jwt default = on). Free; no credits charged.
// Per-user daily cap of 50 lookups via public.take_search(p_who, p_limit) with key prefix "em:".
//
// Pipeline (stop at first acceptable hit; whole result cached 30 days in openalex_cache
// keyed by the openalex id / name): OpenAlex+ROR -> ORCID -> Crossref/EuropePMC -> DuckDuckGo
// faculty page. Only accepts emails on the institution domain or a known academic domain whose
// local part plausibly matches the name. Never fabricates a high-confidence email.
import { cached, db, oaJson, OpenAlexLimited } from "../_shared/openalex.ts";
import { domainMatches, EmailHit, extractEmails, guessEmail, isAcademicDomain, nameTokens, rankEmail } from "./pipeline.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const UA = "stemrankings-email-finder/1.0 (mailto:stemrankings@kahlus.com)";
const DAILY_CAP = 50;

class QuotaHit extends Error {}

// Fetch with a timeout so one slow source can't hang the whole request.
async function get(url: string, opts: RequestInit = {}, ms = 7000): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
  } catch { return null; } finally { clearTimeout(t); }
}
// Read at most ~1.5 MB: full-text XML and some faculty "pages" (PDFs, CVs) are huge and blow the edge
// function's memory limit (WORKER_RESOURCE_LIMIT). Emails are near the top anyway.
const MAX_BYTES = 1_500_000;
async function getText(url: string, ms = 7000): Promise<string> {
  const r = await get(url, {}, ms);
  if (!r || !r.ok || !r.body) return "";
  if (/pdf|octet-stream|image|video/i.test(r.headers.get("content-type") ?? "")) { r.body.cancel(); return ""; }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let out = "", n = 0;
  try {
    while (n < MAX_BYTES) { const { done, value } = await reader.read(); if (done) break; n += value.length; out += dec.decode(value, { stream: true }); }
  } catch { /* partial is fine */ } finally { reader.cancel().catch(() => {}); }
  return out;
}
async function getJson(url: string, ms = 7000): Promise<any> {
  const r = await get(url, { headers: { Accept: "application/json" } }, ms);
  if (!r || !r.ok) return null;
  return await r.json().catch(() => null);
}

// --- Step 1: OpenAlex author -> institution ROR + homepage; ROR -> domain ---
async function instDomainFromRor(ror: string): Promise<string | null> {
  if (!ror) return null;
  const id = ror.split("/").pop();
  const d = await getJson(`https://api.ror.org/organizations/${id}`);
  if (!d) return null;
  // ROR now exposes a dedicated `domains` array; fall back to website links (v1 strings or v2 objects).
  if (Array.isArray(d.domains) && d.domains[0]) return String(d.domains[0]).toLowerCase().replace(/^www\./, "");
  const links: any[] = d.links ?? [];
  for (const l of links) {
    const href = typeof l === "string" ? l : (l && (l.type === "website" || !l.type) ? l.value : null);
    if (!href) continue;
    try { const h = new URL(href).hostname.replace(/^www\./, ""); if (h) return h; } catch { /* skip */ }
  }
  return null;
}

type Resolved = { orcid: string | null; instDomain: string | null; homepage: string | null; instName: string | null };

async function resolveAuthor(name: string, openalexId: string | null, institution: string | null, orcid: string | null): Promise<Resolved> {
  let instDomain: string | null = null, homepage: string | null = null, instName = institution;
  let oaId = openalexId && /^A\d{4,12}$/.test(openalexId) ? openalexId : null;
  try {
    let author: any = null;
    if (!oaId) {
      const a = await oaJson(`authors?search=${encodeURIComponent(name)}&per-page=5&select=id,display_name,orcid,last_known_institutions`);
      let cand = a?.results ?? [];
      if (institution) {
        const hit = cand.find((c: any) => (c.last_known_institutions ?? []).some((i: any) => i.display_name === institution));
        if (hit) cand = [hit];
      }
      if (cand[0]) { author = cand[0]; oaId = cand[0].id.split("/").pop(); }
    } else {
      // last_known_institutions + orcid are valid author fields; avoid invalid selects that blank the row.
      author = await oaJson(`authors/${oaId}?select=id,display_name,orcid,last_known_institutions`);
    }
    if (author) {
      if (!orcid && author.orcid) orcid = author.orcid;
      const inst = (author.last_known_institutions ?? [])[0];
      if (inst) { instName = inst.display_name; if (inst.ror) instDomain = await instDomainFromRor(inst.ror); }
    }
  } catch (e) { if (e instanceof OpenAlexLimited) throw e; }
  return { orcid: orcid ? orcid.split("/").pop()!.replace(/[^0-9X-]/gi, "") : null, instDomain, homepage, instName };
}

// --- Step 2: ORCID public API ---
async function fromOrcid(orcid: string, name: string, instDomain: string | null): Promise<{ hit: EmailHit | null; homepage: string | null }> {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(orcid)) return { hit: null, homepage: null };
  const base = `https://pub.orcid.org/v3.0/${orcid}`;
  const [em, urls] = await Promise.all([getJson(`${base}/email`), getJson(`${base}/researcher-urls`)]);
  for (const e of em?.email ?? []) {
    const addr = String(e?.email ?? "").toLowerCase();
    if (addr) { const h = rankEmail(addr, name, instDomain, "orcid"); if (h) { h.confidence = "high"; return { hit: h, homepage: null }; } }
  }
  let homepage: string | null = null;
  for (const u of urls?.["researcher-url"] ?? []) {
    const val = u?.url?.value; if (val && !homepage) homepage = val;
  }
  return { hit: null, homepage };
}

// --- Step 3: corresponding-author emails from recent papers (Crossref + Europe PMC) ---
async function fromPapers(name: string, instDomain: string | null): Promise<EmailHit | null> {
  const { last } = nameTokens(name);
  // Crossref: author-filtered recent works sometimes carry an author email.
  const cr = await getJson(`https://api.crossref.org/works?query.author=${encodeURIComponent(name)}&rows=5&select=author,DOI&mailto=stemrankings@kahlus.com`);
  const dois: string[] = [];
  for (const it of cr?.message?.items ?? []) {
    for (const a of it.author ?? []) {
      const em = a?.email; // rare but authoritative
      if (Array.isArray(em)) for (const e of em) { const h = acceptPaperEmail(e, name, instDomain); if (h) return h; }
      else if (typeof em === "string") { const h = acceptPaperEmail(em, name, instDomain); if (h) return h; }
    }
    if (it.DOI) dois.push(it.DOI);
  }
  // Europe PMC: OA full text frequently lists corresponding-author emails.
  const epmc = await getJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=AUTH:%22${encodeURIComponent(name)}%22%20AND%20OPEN_ACCESS:Y&format=json&pageSize=5&resultType=core`);
  for (const r of epmc?.resultList?.result ?? []) {
    const blob = JSON.stringify(r);
    for (const e of extractEmails(blob)) { const h = acceptPaperEmail(e, name, instDomain); if (h) return h; }
    // Pull OA full text and scan it.
    const id = r?.id, src = r?.source;
    if (id && src && (src === "PMC" || r?.pmcid)) {
      const pmcid = r?.pmcid ?? id;
      const xml = await getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${src}/${id}/fullTextXML`, 6000);
      if (xml) {
        // Prefer emails near correspondence markup, but any extracted email is validated below.
        for (const e of extractEmails(xml)) { const h = acceptPaperEmail(e, name, instDomain); if (h) return h; }
      }
      void pmcid;
    }
  }
  void last;
  return null;
}
// Accept a paper-derived email only if it matches the institution domain or an academic domain with name match.
function acceptPaperEmail(email: string, name: string, instDomain: string | null): EmailHit | null {
  const h = rankEmail(email, name, instDomain, "paper");
  if (!h) return null;
  if (h.confidence === "low") return null; // papers list many addresses; require inst or name+academic
  return h;
}

// --- Step 4: search for the faculty page ---
// DuckDuckGo's HTML endpoint returns a 202 bot wall to server traffic, so prefer Serper (Google results,
// ~$0.30-1 per 1,000 queries, 2,500 free) when SERPER_API_KEY is set; DDG stays as a free fallback.
async function searchUrls(q: string): Promise<string[]> {
  const key = Deno.env.get("SERPER_API_KEY");
  if (key) {
    const r = await get("https://google.serper.dev/search", {
      method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" }, body: JSON.stringify({ q, num: 5 }),
    }, 8000);
    if (r?.ok) { const d = await r.json().catch(() => null); return (d?.organic ?? []).map((o: any) => o.link).filter(Boolean); }
  }
  const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, 8000);
  const urls: string[] = [];
  for (const m of html.matchAll(/uddg=([^"&]+)/g)) { try { urls.push(decodeURIComponent(m[1])); } catch { /* skip */ } }
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/g)) urls.push(m[1]);
  return urls;
}

async function searchFacultyPage(name: string, instDomain: string | null): Promise<{ hit: EmailHit | null; page_url: string | null }> {
  const q = instDomain ? `"${name}" site:${instDomain}` : `"${name}" faculty email`;
  const urls = await searchUrls(q);
  if (!urls.length) return { hit: null, page_url: null };
  const seen = new Set<string>();
  const ranked = urls.filter((u) => /^https?:\/\//.test(u)).filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; })
    .sort((a, b) => score(b) - score(a));
  function score(u: string): number {
    let s = 0; const h = (() => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    if (instDomain && domainMatches(h, instDomain)) s += 5;
    if (isAcademicDomain(h)) s += 3;
    if (/people|faculty|profile|staff|~|member|directory|bio/i.test(u)) s += 1;
    return s;
  }
  let page_url: string | null = ranked[0] ?? null;
  for (const u of ranked.slice(0, 2)) {
    const page = await getText(u, 7000);
    if (!page) continue;
    for (const e of extractEmails(page)) {
      const h = rankEmail(e, name, instDomain, "faculty-page");
      if (h && h.confidence !== "low") { h.page_url = u; return { hit: h, page_url: u }; }
    }
    if (!page_url) page_url = u;
  }
  return { hit: null, page_url };
}

async function who(req: Request): Promise<{ userId: string } | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt === Deno.env.get("SUPABASE_ANON_KEY")) return null;
  const { data } = await db().auth.getUser(jwt);
  return data?.user ? { userId: data.user.id } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const u = await who(req);
  if (!u) return json({ error: "Sign in first." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const name = String(body.author_name ?? "").trim().slice(0, 200);
  if (name.length < 2) return json({ error: "author_name required" }, 400);
  const institution = body.institution ? String(body.institution).trim().slice(0, 200) : null;
  const openalexId = body.openalex_id ? String(body.openalex_id).trim() : null;
  const orcidIn = body.orcid ? String(body.orcid).trim() : null;

  // Per-user daily cap (50). Cached lookups below are free but still counted once per uncached run.
  const { data: ok } = await db().rpc("take_search", { p_who: "em:" + u.userId, p_limit: DAILY_CAP });
  if (ok === false) return json({ error: `You've hit today's limit of ${DAILY_CAP} email look-ups. It resets at midnight UTC.`, quota: true }, 429);

  const cacheKey = `email:v3:${openalexId || orcidIn || name.toLowerCase()}|${institution ?? "*"}`;
  try {
    const result = await cached(cacheKey, 24 * 30, async () => {
      const r = await resolveAuthor(name, openalexId, institution, orcidIn);
      let best: EmailHit | null = null;
      let bestPage: string | null = r.homepage;

      // Step 2: ORCID
      if (r.orcid) {
        const o = await fromOrcid(r.orcid, name, r.instDomain);
        if (o.hit) return done(o.hit, r);
        if (o.homepage && !bestPage) bestPage = o.homepage;
      }
      // Step 3: papers (Crossref + Europe PMC)
      const paper = await fromPapers(name, r.instDomain);
      if (paper) return done(paper, r);
      // Step 4: faculty page via DuckDuckGo
      const fp = await searchFacultyPage(name, r.instDomain);
      if (fp.hit) return done(fp.hit, r);
      if (fp.page_url && !bestPage) bestPage = fp.page_url;

      // Step 5: nothing verified. Offer a guess (low) + best page url.
      best = guessEmail(name, r.instDomain);
      return {
        email: best?.email ?? null,
        confidence: best ? "low" : null,
        source: best ? "guessed" : null,
        page_url: bestPage,
        institution_domain: r.instDomain,
      };
    });
    return json(result);
  } catch (e) {
    if (e instanceof OpenAlexLimited) return json({ error: e.message, limited: true }, 503);
    if (e instanceof QuotaHit) return json({ error: "Daily limit reached.", quota: true }, 429);
    return json({ error: (e as Error).message }, 502);
  }
});

function done(hit: EmailHit, r: Resolved) {
  return {
    email: hit.email,
    confidence: hit.confidence,
    source: hit.source,
    page_url: hit.page_url ?? r.homepage ?? null,
    institution_domain: r.instDomain,
  };
}
