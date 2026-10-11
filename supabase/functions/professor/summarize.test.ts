import { assertEquals } from "jsr:@std/assert@1";
import { summarize } from "./summarize.ts";
const me = "https://openalex.org/A1";
const auth = (pos: string, id = me, name = "Prof") => ({ author_position: pos, author: { id, display_name: name }, institutions: [{ display_name: "MIT" }] });
let n = 0;
const work = (year: number, myPos: string, co: [string, string][] = []) => ({ title: `paper ${year} ${myPos} ${n++}`, publication_year: year, authorships: [auth(myPos), ...co.map(([i, n]) => auth("middle", "https://openalex.org/" + i, n))] });
const author = { id: me, display_name: "Prof", counts_by_year: [{ year: 2026, works_count: 5 }, { year: 2025, works_count: 4 }, { year: 2020, works_count: 9 }], topics: [], summary_stats: { h_index: 30 } };

Deno.test("counts papers in the last two years only", () => {
  assertEquals(summarize(author, [], 2026).papers_last_2y, 9);
});
Deno.test("leads_lab needs 2+ recent senior-author papers", () => {
  assertEquals(summarize(author, [work(2026, "last"), work(2025, "last")], 2026).leads_lab, true);
  assertEquals(summarize(author, [work(2026, "last"), work(2025, "first")], 2026).leads_lab, false);
  assertEquals(summarize(author, [work(2019, "last"), work(2019, "last")], 2026).leads_lab, false);
});
Deno.test("collaborators: repeat co-authors only, excluding self, most frequent first", () => {
  const ws = [work(2026, "last", [["B", "Bo"], ["C", "Cy"]]), work(2025, "last", [["B", "Bo"]]), work(2024, "last", [["B", "Bo"], ["C", "Cy"]])];
  const s = summarize(author, ws, 2026);
  assertEquals(s.collaborators.map((c) => [c.name, c.n]), [["Bo", 3], ["Cy", 2]]);
});
Deno.test("paper role reflects author position", () => {
  const s = summarize(author, [work(2026, "first"), work(2026, "last"), work(2026, "middle")], 2026);
  assertEquals(s.papers.map((p) => p.role), ["first", "senior", "middle"]);
});
Deno.test("duplicate titles collapse to one, keeping the DOI copy", () => {
  const a = { ...work(2025, "last"), title: "Cold Plasma, Wounds!", doi: null };
  const b = { ...work(2025, "last"), title: "cold plasma wounds", doi: "https://doi.org/10.1/x" };
  const s = summarize(author, [a, b], 2026);
  assertEquals(s.papers.length, 1);
  assertEquals(s.papers[0].doi, "https://doi.org/10.1/x");
});
