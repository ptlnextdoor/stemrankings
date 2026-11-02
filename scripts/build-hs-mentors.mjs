#!/usr/bin/env node
// Build (or refresh) public.hs_mentors: professors who have co-authored recent papers with a
// high-school-affiliated author, and who are not themselves at a school. These are the people most
// likely to take on a high schooler, so the finder tags and gently boosts them.
//
// Method (matches the coordinator's spike):
//   1. Find "school" institutions on OpenAlex: type:education whose name looks like a high school
//      (high school, academy, secondary school, magnet). US first; cheap non-US too.
//   2. Page through recent articles (since 2020) with at least one author at one of those schools.
//   3. For each paper, take the senior (last) author. If that author is NOT at one of the schools,
//      count them as a likely mentor. Keep papers, latest year, and one example title.
//   4. Write the result to public.hs_mentors via the Supabase Management API.
//
// No dependencies. Unauthenticated OpenAlex polite pool (mailto). Usage is modest: a few hundred
// list calls. Run: node scripts/build-hs-mentors.mjs [--max-work-pages N] [--dry]
import { execSync } from "node:child_process";

const MAILTO = "stemrankings@kahlus.com";
const OA = "https://api.openalex.org";
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const MAX_WORK_PAGES = Number((argv.find((a) => a.startsWith("--max-work-pages=")) || "").split("=")[1]) || 60;
const SINCE = "2020-01-01";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Budget extends Error {}
async function oa(path) {
  const url = `${OA}/${path}${path.includes("?") ? "&" : "?"}mailto=${MAILTO}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": `hs-mentors-builder (mailto:${MAILTO})` } });
    // 401/403/429 keyless-pool budget exhausted: back off, then give up so we write what we have.
    if (r.status === 401 || r.status === 403 || r.status === 429 || r.status >= 500) {
      if (attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Budget(`OpenAlex ${r.status} (likely keyless daily budget)`);
    }
    if (!r.ok) throw new Error(`OpenAlex ${r.status} on ${path}`);
    return await r.json();
  }
  throw new Budget("OpenAlex kept failing");
}

// --- Step 1: collect high-school institution ids -------------------------------------------------
// type:education covers universities too, so we keep only names that read like a secondary school.
const HS_NAME = /\b(high school|senior high|secondary school|preparatory|prep school|magnet school|college prep|academy)\b/i;
// "Academy" is noisy (National Academy of Sciences, military academies). Require a schoolish word
// unless it is clearly a high school.
const NOT_HS = /\b(university|universit|college of|institute of tech|national academy|academy of sciences|polytechnic|hospital|medical center|air force|naval|military|graduate)\b/i;

async function collectSchools() {
  const ids = new Set();
  const queries = [
    "institutions?filter=type:education,country_code:US&search=high school&per-page=200",
    "institutions?filter=type:education,country_code:US&search=secondary school&per-page=200",
    "institutions?filter=type:education,country_code:US&search=academy&per-page=200",
    "institutions?filter=type:education,country_code:US&search=magnet&per-page=200",
    "institutions?filter=type:education,country_code:US&search=preparatory&per-page=200",
    // Cheap non-US sweep (one page each): names in English still catch many.
    "institutions?filter=type:education&search=high school&per-page=200",
  ];
  const names = new Map();
  for (const q of queries) {
    try {
      const d = await oa(q + "&select=id,display_name,type");
      for (const it of d?.results ?? []) {
        const nm = it.display_name || "";
        if (HS_NAME.test(nm) && !NOT_HS.test(nm)) { const id = it.id.split("/").pop(); ids.add(id); names.set(id, nm); }
      }
    } catch (e) { console.error("  skip", q, String(e).slice(0, 80)); }
  }
  return { ids: [...ids], names };
}

// --- Step 2+3: page works that involve a school author; collect senior authors not at a school ---
async function collectMentors(schoolIds) {
  const schools = new Set(schoolIds);
  const mentors = new Map(); // openalex id -> { papers, latest_year, example_title }
  // OpenAlex ORs many ids per filter value; chunk the schools.
  const chunks = [];
  for (let i = 0; i < schoolIds.length; i += 50) chunks.push(schoolIds.slice(i, i + 50));
  // Spread the page budget across chunks so we sample many schools, not drain one.
  const perChunk = Math.max(2, Math.ceil(MAX_WORK_PAGES / chunks.length));
  let pagesLeft = MAX_WORK_PAGES;
  try {
    for (const chunk of chunks) {
      let cursor = "*", usedHere = 0;
      while (cursor && pagesLeft > 0 && usedHere < perChunk) {
        const d = await oa(
          `works?filter=authorships.institutions.id:${chunk.join("|")},from_publication_date:${SINCE},type:article`
          + `&per-page=200&cursor=${encodeURIComponent(cursor)}&select=title,publication_year,authorships`,
        );
        pagesLeft--; usedHere++;
        const results = d?.results ?? [];
        for (const w of results) {
          const auths = w.authorships ?? [];
          if (auths.length < 2) continue;
          const last = auths.find((a) => a.author_position === "last");
          if (!last?.author?.id) continue;
          const atSchool = (last.institutions ?? []).some((i) => schools.has(String(i.id).split("/").pop()));
          if (atSchool) continue; // the senior author is themselves at a school: not a university mentor
          const id = last.author.id.split("/").pop();
          const cur = mentors.get(id) ?? { papers: 0, latest_year: 0, example_title: w.title || null };
          cur.papers++;
          if ((w.publication_year || 0) > cur.latest_year) { cur.latest_year = w.publication_year; cur.example_title = w.title || cur.example_title; }
          mentors.set(id, cur);
        }
        cursor = d?.meta?.next_cursor || null;
        await sleep(120); // be polite to the shared keyless pool
        if (!results.length) break;
      }
      if (pagesLeft <= 0) { console.error("  hit --max-work-pages cap; stopping early"); break; }
    }
  } catch (e) {
    if (e instanceof Budget) console.error("  OpenAlex budget reached; writing what we collected:", String(e.message));
    else throw e;
  }
  return mentors;
}

// --- Step 4: write to public.hs_mentors via the Management API -----------------------------------
function mgmtToken() {
  const raw = execSync('security find-generic-password -s "Supabase CLI" -w', { encoding: "utf8" }).trim();
  const b64 = raw.replace(/^go-keyring-base64:/, "");
  return Buffer.from(b64, "base64").toString("utf8").trim();
}
async function runSql(sql) {
  const r = await fetch("https://api.supabase.com/v1/projects/oxcnlommtnziwfbpxigd/database/query", {
    method: "POST",
    headers: { Authorization: "Bearer " + mgmtToken(), "Content-Type": "application/json", "User-Agent": "supabase-cli" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Management API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}
const lit = (s) => (s == null ? "null" : "'" + String(s).replace(/'/g, "''").slice(0, 500) + "'");

async function write(mentors) {
  const rows = [...mentors.entries()].filter(([id]) => /^A\d{4,12}$/.test(id));
  if (DRY) { console.log(`DRY: would write ${rows.length} mentors`); return rows.length; }
  // Idempotent refresh: upsert, bumping counts to the latest build.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map(([id, m]) =>
      `(${lit(id)}, ${m.papers}, ${m.latest_year || "null"}, ${lit(m.example_title)}, now())`).join(",\n");
    await runSql(
      `insert into public.hs_mentors (openalex_id, papers, latest_year, example_title, updated_at) values\n${batch}\n`
      + `on conflict (openalex_id) do update set papers = excluded.papers, latest_year = excluded.latest_year, example_title = excluded.example_title, updated_at = now();`,
    );
    console.error(`  wrote ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  return rows.length;
}

const t0 = Date.now();
console.error("Collecting high-school institutions...");
const { ids, names } = await collectSchools();
console.error(`  ${ids.length} school institutions (e.g. ${[...names.values()].slice(0, 3).join("; ")})`);
if (!ids.length) { console.error("No schools found; aborting."); process.exit(1); }
console.error(`Paging recent works (<= ${MAX_WORK_PAGES} pages)...`);
const mentors = await collectMentors(ids);
console.error(`  ${mentors.size} distinct senior authors (mentors) collected`);
const n = await write(mentors);
console.log(`\nhs_mentors: ${n} mentors written in ${Math.round((Date.now() - t0) / 1000)}s`);
