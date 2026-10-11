// Pure ranking logic for the professor finder (no I/O), so it can be unit-tested.
export type Paper = { title: string; year: number; cited: number; doi: string | null; venue: string | null };
export type Prof = {
  id: string; name: string; institution: string | null; country: string | null; orcid: string | null;
  papers: Paper[]; score: number; latest_year: number;
};

export function rankProfessors(works: any[], opts: { country?: string; now?: number } = {}): Prof[] {
  const now = opts.now ?? new Date().getFullYear();
  // Same paper can appear twice (journal + preprint/abstract). Count each title once, preferring the DOI copy.
  const norm = (t: string) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const keep = new Map<string, any>();
  for (const w of works) { const k = norm(w.title); if (!k) continue; const p = keep.get(k); if (!p || (!p.doi && w.doi)) keep.set(k, w); }
  works = works.filter((w) => keep.get(norm(w.title)) === w);
  const by = new Map<string, Prof>();
  for (const w of works) {
    const auths = w.authorships ?? [];
    if (auths.length < 2) continue; // single-author papers rarely mean a lab
    const last = auths.find((a: any) => a.author_position === "last");
    if (!last?.author?.id) continue;
    const inst = last.institutions?.[0];
    if (opts.country && inst?.country_code !== opts.country) continue;
    const id = last.author.id.split("/").pop();
    const p: Paper = {
      title: w.title, year: w.publication_year, cited: w.cited_by_count ?? 0,
      doi: w.doi ?? null, venue: w.primary_location?.source?.display_name ?? null,
    };
    // recency: this year 1.0, last year 0.8, two years 0.6...; citations add a little, capped
    const weight = Math.max(0.3, 1 - 0.2 * (now - p.year)) * (1 + Math.min(Math.log10(1 + p.cited), 2) / 4);
    const cur: Prof = by.get(id) ?? {
      id, name: last.author.display_name, institution: inst?.display_name ?? null,
      country: inst?.country_code ?? null, orcid: last.author.orcid?.split("/").pop() ?? null,
      papers: [], score: 0, latest_year: 0,
    };
    cur.papers.push(p);
    cur.score += weight;
    cur.latest_year = Math.max(cur.latest_year, p.year);
    by.set(id, cur);
  }
  return [...by.values()]
    .map((x) => ({ ...x, papers: x.papers.sort((a, b) => b.year - a.year).slice(0, 3), score: Math.round(x.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || b.latest_year - a.latest_year);
}
