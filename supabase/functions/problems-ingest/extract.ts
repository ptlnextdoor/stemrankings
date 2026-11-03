// Pure helpers for problems-ingest: parse the arXiv feed, cut a paper's closing section out of its
// HTML, and validate the model's work packages. No network here, so it is unit tested (extract.test.ts).

export type Paper = { id: string; title: string; authors: string[]; published: string; category: string };
export type Package = {
  title: string; source: string; deliverable: string; inputs: string;
  hours_min: number; hours_max: number; skills: string[]; tier: string; value: string;
};

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function parseFeed(xml: string): Paper[] {
  return xml.split("<entry>").slice(1).flatMap((e) => {
    const id = /<id>https?:\/\/arxiv\.org\/abs\/(\d{4}\.\d{4,5})(v\d+)?<\/id>/.exec(e)?.[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1];
    if (!id || !title) return [];
    return [{
      id,
      title: unxml(title.replace(/\s+/g, " ").trim()),
      authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => unxml(m[1].trim())),
      published: (/<published>(\d{4}-\d{2}-\d{2})/.exec(e)?.[1]) ?? "",
      category: (/<arxiv:primary_category[^>]*term="([^"]+)"/.exec(e)?.[1]) ?? "",
    }];
  });
}

export function htmlToText(html: string): string {
  return unxml(
    html.replace(/<(script|style|math|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))),
  ).replace(/\s+/g, " ").trim();
}

// The part of the paper where authors say what is still undone. Prefer explicit limitation /
// future-work headings, then the conclusion or discussion. Last occurrence, so the table of
// contents does not win. null when the paper has no usable closing section.
export function closingSection(text: string, max = 3500): string | null {
  for (const k of ["Limitation", "Future Work", "Future work", "future work", "Conclusion", "Discussion"]) {
    const i = text.lastIndexOf(k);
    if (i > 0 && text.length - i > 300) return text.slice(i, i + max);
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Datasets a minor can't legally or practically get; packages that need them are dropped.
const GATED = /\b(mimic|eicu|uk biobank|credentialed|proprietary|upon request|on request|confidential|dbgap|physionet)\b/i;
const TIERS = new Set(["reproduce", "extend", "benchmark", "tooling"]);

// Keep only packages that are well formed, honest (quote really is in the paper), small enough
// for a student and buildable from open inputs. At most 2 per paper.
export function validPackages(raw: unknown, paperText: string): Package[] {
  if (!Array.isArray(raw)) return [];
  const hay = norm(paperText);
  const out: Package[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p !== "object") continue;
    const s = (k: string, n: number) => (typeof p[k] === "string" ? (p[k] as string).trim().slice(0, n) : "");
    const pkg: Package = {
      title: s("title", 200), source: s("source", 600), deliverable: s("deliverable", 600),
      inputs: s("inputs", 600), value: s("value", 300), tier: s("tier", 20).toLowerCase(),
      hours_min: Math.round(Number(p.hours_min)), hours_max: Math.round(Number(p.hours_max)),
      skills: Array.isArray(p.skills) ? (p.skills as unknown[]).filter((x) => typeof x === "string").map((x) => (x as string).slice(0, 30)).slice(0, 6) : [],
    };
    if (!pkg.title || !pkg.deliverable || !pkg.inputs || !TIERS.has(pkg.tier)) continue;
    if (!(pkg.hours_min >= 1 && pkg.hours_max >= pkg.hours_min && pkg.hours_max <= 30)) continue;
    if (p.open_data !== true || GATED.test(pkg.inputs)) continue;
    const q = norm(pkg.source);
    if (q.split(" ").length < 5 || !hay.includes(q)) continue; // quote must be verbatim, not invented
    out.push(pkg);
    if (out.length === 2) break;
  }
  return out;
}

// The model sometimes wraps JSON in prose or fences; take the outermost array.
export function parseJsonArray(t: string): unknown {
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return []; }
}
