// Pure summarizer for the professor page (no I/O), unit-tested.
export function summarize(author: any, works: any[], now = new Date().getFullYear()) {
  const id = String(author.id).split("/").pop()!;
  const recentYears = (author.counts_by_year ?? []).filter((c: any) => c.year >= now - 2);
  // OpenAlex often lists the same paper twice (journal version plus a preprint or abstract copy).
  // Keep one per normalized title, preferring the copy that has a DOI.
  const norm = (t: string) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Map<string, any>();
  for (const w of works) {
    const k = norm(w.title);
    if (!k) continue;
    const prev = seen.get(k);
    if (!prev || (!prev.doi && w.doi)) seen.set(k, w);
  }
  works = works.filter((w) => seen.get(norm(w.title)) === w);
  const papers = works.map((w) => {
    const me = (w.authorships ?? []).find((a: any) => String(a.author?.id).endsWith(id));
    return {
      title: w.title, year: w.publication_year, doi: w.doi ?? null, cited: w.cited_by_count ?? 0,
      venue: w.primary_location?.source?.display_name ?? null,
      role: me?.author_position === "last" ? "senior" : me?.author_position === "first" ? "first" : "middle",
    };
  });
  const co = new Map<string, { name: string; institution: string | null; n: number }>();
  for (const w of works) for (const a of w.authorships ?? []) {
    const aid = String(a.author?.id ?? "").split("/").pop();
    if (!aid || aid === id) continue;
    const c = co.get(aid) ?? { name: a.author.display_name, institution: a.institutions?.[0]?.display_name ?? null, n: 0 };
    c.n++; co.set(aid, c);
  }
  return {
    id, name: author.display_name,
    orcid: author.orcid ? String(author.orcid).split("/").pop() : null,
    institutions: (author.last_known_institutions ?? []).map((i: any) => i.display_name),
    topics: (author.topics ?? []).slice(0, 6).map((t: any) => t.display_name),
    h_index: author.summary_stats?.h_index ?? null,
    works_count: author.works_count, cited_by_count: author.cited_by_count,
    papers_last_2y: recentYears.reduce((s: number, c: any) => s + (c.works_count ?? 0), 0),
    // Leads (senior author) recent work: a decent proxy for "runs a lab that could take a student".
    leads_lab: papers.filter((p) => p.role === "senior" && p.year >= now - 2).length >= 2,
    papers: papers.slice(0, 8),
    collaborators: [...co.entries()].filter(([, c]) => c.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 6)
      .map(([cid, c]) => ({ id: cid, ...c })),
  };
}
