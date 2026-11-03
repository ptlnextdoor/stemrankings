import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { closingSection, htmlToText, parseFeed, parseJsonArray, validPackages } from "./extract.ts";

const FEED = `<feed><entry><id>http://arxiv.org/abs/2611.03326v1</id><published>2026-11-02T10:00:00Z</published>
<title>Six-hourly  Probabilistic
 Precipitation &amp; Forecasts</title><author><name>Thomas M. Hamill</name></author><author><name>A. B</name></author>
<arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="physics.ao-ph"/></entry>
<entry><id>http://arxiv.org/abs/bad</id><title>x</title></entry></feed>`;

Deno.test("parseFeed reads ids, titles, authors, date, category and skips junk", () => {
  const p = parseFeed(FEED);
  assertEquals(p.length, 1);
  assertEquals(p[0], { id: "2611.03326", title: "Six-hourly Probabilistic Precipitation & Forecasts", authors: ["Thomas M. Hamill", "A. B"], published: "2026-11-02", category: "physics.ao-ph" });
});

Deno.test("htmlToText strips tags, scripts and math", () => {
  assertEquals(htmlToText("<p>a<script>x()</script> <b>b</b><math>q</math>&amp;c</p>"), "a b &c");
});

const PAPER = "Intro text ".repeat(50) + "Conclusions We showed it works. In future work, we expect to explore related methods for other accumulation periods such as 12 or 24 h. " + "tail ".repeat(80);

Deno.test("closingSection takes the last heading and needs enough text after it", () => {
  assertEquals(closingSection(PAPER)?.startsWith("future work") || closingSection(PAPER)?.startsWith("Conclusion"), true);
  assertEquals(closingSection("short Conclusion end"), null);
});

const good = { title: "Extend to 12 h and 24 h", source: "In future work, we expect to explore related methods for other accumulation periods such as 12 or 24 h.", deliverable: "notebook", inputs: "NOAA NBM (public)", open_data: true, hours_min: 10, hours_max: 16, skills: ["python"], tier: "extend", value: "named next step" };

Deno.test("validPackages keeps a well formed package with a verbatim quote", () => {
  assertEquals(validPackages([good], PAPER).length, 1);
});

Deno.test("validPackages drops invented quotes, gated data, closed data, bad hours, bad tier", () => {
  assertEquals(validPackages([{ ...good, source: "We plan to build a quantum computer next year for sure." }], PAPER).length, 0);
  assertEquals(validPackages([{ ...good, inputs: "MIMIC-III ICU records" }], PAPER).length, 0);
  assertEquals(validPackages([{ ...good, open_data: false }], PAPER).length, 0);
  assertEquals(validPackages([{ ...good, hours_min: 20, hours_max: 90 }], PAPER).length, 0);
  assertEquals(validPackages([{ ...good, tier: "vibes" }], PAPER).length, 0);
  assertEquals(validPackages("nope", PAPER).length, 0);
});

Deno.test("validPackages caps at 2 per paper", () => {
  assertEquals(validPackages([good, good, good], PAPER).length, 2);
});

Deno.test("parseJsonArray tolerates prose and fences, returns [] on garbage", () => {
  assertEquals(parseJsonArray('Sure:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assertEquals(parseJsonArray("no json here"), []);
  assertEquals(parseJsonArray("[broken"), []);
});
