// Unit check for the professor ranking logic. Run: deno test supabase/functions/find/rank.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { rankProfessors } from "./rank.ts";

const au = (id: string, name: string, pos: string, cc = "US", inst = "MIT") =>
  ({ author_position: pos, author: { id: "https://openalex.org/" + id, display_name: name, orcid: null }, institutions: [{ display_name: inst, country_code: cc }] });
const w = (title: string, year: number, cited: number, auths: any[]) => ({ title, publication_year: year, cited_by_count: cited, authorships: auths });

Deno.test("last author is credited, not first", () => {
  const r = rankProfessors([w("A", 2026, 0, [au("S1", "Student", "first"), au("P1", "Prof One", "last")])], { now: 2026 });
  assertEquals(r.map((x) => x.name), ["Prof One"]);
});

Deno.test("more matching recent papers ranks higher; recency beats old", () => {
  const works = [
    w("a", 2026, 0, [au("s", "s", "first"), au("P1", "Busy Lab", "last")]),
    w("b", 2026, 0, [au("s", "s", "first"), au("P1", "Busy Lab", "last")]),
    w("c", 2021, 0, [au("s", "s", "first"), au("P2", "Old Lab", "last")]),
    w("d", 2021, 0, [au("s", "s", "first"), au("P2", "Old Lab", "last")]),
  ];
  const r = rankProfessors(works, { now: 2026 });
  assertEquals(r[0].name, "Busy Lab");
  assertEquals(r[0].papers.length, 2);
});

Deno.test("country filter and single-author papers excluded", () => {
  const works = [
    w("x", 2026, 0, [au("s", "s", "first", "CN", "Tsinghua"), au("P3", "Abroad", "last", "CN", "Tsinghua")]),
    w("y", 2026, 0, [au("P4", "Solo", "last")]),
    w("z", 2026, 0, [au("s", "s", "first"), au("P5", "Home", "last")]),
  ];
  assertEquals(rankProfessors(works, { country: "US", now: 2026 }).map((x) => x.name), ["Home"]);
});

Deno.test("at most 3 papers returned per professor, newest first", () => {
  const works = [2022, 2026, 2024, 2025].map((y) => w("p" + y, y, 0, [au("s", "s", "first"), au("P6", "Prolific", "last")]));
  const r = rankProfessors(works, { now: 2026 });
  assertEquals(r[0].papers.map((p) => p.year), [2026, 2025, 2024]);
});

Deno.test("a paper listed twice counts once toward the score", () => {
  const a = { ...w("Same Paper", 2026, 0, [au("s", "s", "first"), au("P7", "Dup", "last")]), doi: null };
  const b = { ...w("same paper", 2026, 0, [au("s", "s", "first"), au("P7", "Dup", "last")]), doi: "https://doi.org/x" };
  const one = w("Other", 2026, 0, [au("s", "s", "first"), au("P8", "Single", "last")]);
  const r = rankProfessors([a, b, one], { now: 2026 });
  assertEquals(r.find((x) => x.name === "Dup")!.papers.length, 1);
  assertEquals(r.find((x) => x.name === "Dup")!.score, r.find((x) => x.name === "Single")!.score);
});
