// Shared "new grant" badge lookup (NSF awards; free, no key). Used by the professor panel (one
// lookup, cached 30 days) and the finder (top results, in parallel, cached). Kept tiny and
// best-effort: any failure returns null so search/panel never break or slow down materially.
import { cached } from "./openalex.ts";

export type GrantBadge = { agency: "NSF"; title: string; amount: number | null; start: string; award_id: string | null };

// Loosely match an award's awardeeName to the professor's institution, to avoid namesakes at other
// schools. Pure, so it can be unit-tested. Compares normalized significant tokens; a match needs the
// shorter side's distinctive words to be mostly present in the other (either direction).
const STOP = new Set(["the", "of", "and", "at", "for", "a", "university", "college", "institute", "school", "system", "inc", "corporation", "state"]);
export function institutionMatches(awardee: string | null | undefined, institution: string | null | undefined): boolean {
  const toks = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const a = new Set(toks(awardee ?? "")), b = toks(institution ?? "");
  if (!a.size || !b.length) return false;
  const bSig = b.filter((w) => !a.has(w)); // informative only; use full b for overlap
  void bSig;
  const overlap = b.filter((w) => a.has(w)).length;
  const need = Math.min(a.size, b.length);
  // Require most of the smaller institution's distinctive words to appear on both sides.
  return overlap >= Math.max(1, Math.ceil(need * 0.6));
}

// Recent = award start date within the last 18 months.
export function isRecentStart(start: string | null | undefined, now = Date.now()): boolean {
  if (!start) return false;
  // NSF returns MM/DD/YYYY.
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(start.trim());
  const t = m ? Date.parse(`${m[3]}-${m[1]}-${m[2]}`) : Date.parse(start);
  if (Number.isNaN(t)) return false;
  const ms = now - t;
  return ms <= 18 * 30 * 24 * 3600_000 && ms >= -120 * 24 * 3600_000; // allow a near-future start date
}

async function fetchJson(url: string, ms: number): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "stemrankings/1.0 (mailto:stemrankings@kahlus.com)", Accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// NSF awards for a PI name, filtered to this institution and a recent start date. Cached 30 days per
// (name|institution). Returns the most recent matching award, or null.
export async function nsfBadge(name: string, institution: string | null, timeoutMs = 6000): Promise<GrantBadge | null> {
  const nm = name.trim();
  if (nm.length < 3) return null;
  const key = `grant:nsf:v1:${nm.toLowerCase()}|${(institution ?? "*").toLowerCase()}`;
  return await cached<GrantBadge | null>(key, 24 * 30, async () => {
    const url = `https://api.nsf.gov/services/v1/awards.json?pdPIName=${encodeURIComponent(nm)}`
      + `&printFields=id,title,startDate,awardeeName,fundsObligatedAmt&rpp=15`;
    const d = await fetchJson(url, timeoutMs);
    const awards: any[] = d?.response?.award ?? [];
    const matches = awards
      .filter((a) => isRecentStart(a.startDate))
      .filter((a) => !institution || institutionMatches(a.awardeeName, institution))
      .sort((a, b) => (Date.parse(b.startDate?.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2") ?? "") || 0) - (Date.parse(a.startDate?.replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2") ?? "") || 0));
    const a = matches[0];
    if (!a) return null;
    return { agency: "NSF", title: String(a.title ?? "").slice(0, 300), amount: a.fundsObligatedAmt ? Number(a.fundsObligatedAmt) : null, start: a.startDate, award_id: a.id ?? null };
  });
}
