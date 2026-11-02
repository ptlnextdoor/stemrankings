// Build static, Google-indexable topic pages for needalab.com.
//
// For each curated high-intent topic a student might search, call OpenAlex DIRECTLY
// for recent articles, rank the senior-author labs with the SAME logic the live finder
// uses (supabase/functions/find/rank.ts - imported, one source of truth), and write
// static HTML to topics/<slug>/index.html. Also writes topics/index.html, sitemap.xml
// and robots.txt. No client JS is needed to read the list (SEO-friendly).
//
// Usage:  node scripts/build-topics.mjs
//   OPENALEX_API_KEY  optional, raises the OpenAlex budget
// Budget: one OpenAlex call per topic (~40). Stops on HTTP 429 and reports.

import { rankProfessors } from "../supabase/functions/find/rank.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://needalab.com";
const MAILTO = "stemrankings@kahlus.com";
const YEARS = 3;
const NOW = new Date().getFullYear();
const FROM = `${NOW - YEARS + 1}-01-01`;
const TOP = 25; // labs shown per page

// Curated, high-intent topics balanced across bio, physics, CS, engineering, chem.
// `q` is the exact query students type (also used for the finder deep link + OpenAlex search).
const TOPICS = [
  // --- Biology / neuro / medicine ---
  { q: "EEG brain-computer interfaces", cat: "Neuroscience & Bioengineering" },
  { q: "CRISPR gene editing", cat: "Biology & Medicine" },
  { q: "cold plasma medicine", cat: "Biology & Medicine" },
  { q: "mRNA vaccines", cat: "Biology & Medicine" },
  { q: "phage therapy", cat: "Biology & Medicine" },
  { q: "organ-on-a-chip", cat: "Biology & Medicine" },
  { q: "cancer immunotherapy", cat: "Biology & Medicine" },
  { q: "single-cell RNA sequencing", cat: "Biology & Medicine" },
  { q: "regenerative medicine stem cells", cat: "Biology & Medicine" },
  { q: "optogenetics", cat: "Neuroscience & Bioengineering" },
  { q: "computational neuroscience", cat: "Neuroscience & Bioengineering" },
  { q: "neural prosthetics", cat: "Neuroscience & Bioengineering" },
  { q: "microbiome gut health", cat: "Biology & Medicine" },
  // --- Physics / space / energy ---
  { q: "quantum computing", cat: "Physics & Quantum" },
  { q: "quantum sensing", cat: "Physics & Quantum" },
  { q: "nuclear fusion plasma", cat: "Physics & Energy" },
  { q: "gravitational wave astronomy", cat: "Physics & Quantum" },
  { q: "exoplanet detection", cat: "Physics & Space" },
  { q: "topological materials", cat: "Physics & Quantum" },
  { q: "superconductivity", cat: "Physics & Quantum" },
  { q: "metamaterials photonics", cat: "Physics & Engineering" },
  { q: "perovskite solar cells", cat: "Physics & Energy" },
  // --- CS / AI ---
  { q: "machine learning for drug discovery", cat: "Computer Science & AI" },
  { q: "large language models", cat: "Computer Science & AI" },
  { q: "computer vision", cat: "Computer Science & AI" },
  { q: "reinforcement learning robotics", cat: "Computer Science & AI" },
  { q: "federated learning privacy", cat: "Computer Science & AI" },
  { q: "graph neural networks", cat: "Computer Science & AI" },
  { q: "quantum machine learning", cat: "Computer Science & AI" },
  { q: "natural language processing", cat: "Computer Science & AI" },
  // --- Engineering / robotics / materials ---
  { q: "soft robotics", cat: "Engineering & Robotics" },
  { q: "swarm robotics", cat: "Engineering & Robotics" },
  { q: "autonomous drones", cat: "Engineering & Robotics" },
  { q: "wearable sensors", cat: "Engineering & Robotics" },
  { q: "3D bioprinting", cat: "Engineering & Robotics" },
  { q: "additive manufacturing metals", cat: "Engineering & Materials" },
  { q: "microfluidics lab on chip", cat: "Engineering & Materials" },
  // --- Chemistry / climate / materials ---
  { q: "machine learning materials discovery", cat: "Chemistry & Materials" },
  { q: "carbon capture materials", cat: "Chemistry & Climate" },
  { q: "catalysis green chemistry", cat: "Chemistry & Climate" },
  { q: "battery solid state electrolytes", cat: "Chemistry & Energy" },
  { q: "metal organic frameworks", cat: "Chemistry & Materials" },
  { q: "climate modeling", cat: "Earth & Climate" },
];

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const title = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function oaUrl(query) {
  const key = process.env.OPENALEX_API_KEY;
  return (
    "https://api.openalex.org/works?search=" +
    encodeURIComponent(query) +
    `&filter=from_publication_date:${FROM},type:article` +
    "&per-page=200" +
    "&select=title,publication_year,cited_by_count,doi,authorships,primary_location" +
    `&mailto=${MAILTO}` +
    (key ? `&api_key=${encodeURIComponent(key)}` : "")
  );
}

const HEAD = (t) => `  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${t.css}css/stem-overrides.css?v=20261102p">`;

function pageHtml(topic, labs, totalPapers, totalLabs) {
  const shownNote = totalLabs > labs.length ? `${totalLabs.toLocaleString()} labs, top ${labs.length} shown` : `${labs.length} labs`;
  const t = title(topic.q);
  const url = `${SITE}/topics/${slug(topic.q)}/`;
  const pageTitle = `Top labs for ${t} that take students (${NOW}) | needalab`;
  const desc = `Find ${labs.length} active ${t} research labs publishing recent papers and taking students in ${NOW}. Ranked from OpenAlex. Draft an outreach email in one click.`;
  // JSON-LD: ItemList of Person with affiliation.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: pageTitle,
    description: desc,
    numberOfItems: labs.length,
    itemListElement: labs.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Person",
        name: p.name,
        ...(p.institution
          ? { affiliation: { "@type": "Organization", name: p.institution } }
          : {}),
        url: `https://openalex.org/authors/${p.id}`,
      },
    })),
  };
  const deepLink = (p) =>
    `${SITE}/?q=${encodeURIComponent(topic.q)}&prof=${encodeURIComponent(p.id)}`;
  const labHtml = labs
    .map(
      (p, i) => `      <li class="topic-lab">
        <div class="tl-head"><span class="tl-rank">${i + 1}</span>
          <div><b class="tl-name">${esc(p.name)}</b>
            <span class="tl-inst">${esc(p.institution || "Institution unknown")}${p.country ? " \u00b7 " + esc(p.country) : ""}</span>
            <span class="pc-active">active ${p.latest_year}</span></div></div>
        <ul class="tl-papers">${p.papers
          .slice(0, 2)
          .map(
            (x) =>
              `<li>${x.doi ? `<a href="${esc(x.doi)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)} <small>(${x.year}${x.venue ? ", " + esc(x.venue) : ""})</small></li>`
          )
          .join("")}</ul>
        <a class="btn-primary tl-cta" href="${esc(deepLink(p))}">\u2709 Draft an email to ${esc(p.name.split(" ").slice(-1)[0] ? "Prof. " + p.name.split(" ").slice(-1)[0] : p.name)}</a>
      </li>`
    )
    .join("\n");

  return `<!DOCTYPE HTML>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="needalab">
  <meta name="twitter:card" content="summary">
${HEAD({ css: "../../" })}
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <div class="container topic-page">
    <nav class="topic-nav"><a href="${SITE}/">needalab</a> &rsaquo; <a href="${SITE}/topics/">Topics</a> &rsaquo; <span>${esc(t)}</span></nav>
    <h1>Top labs for ${esc(t)} that take students (${NOW})</h1>
    <p class="topic-intro">${esc(shownNote)}: research groups leading recent, highly relevant work on ${esc(t)}, drawn from the most relevant of ${totalPapers.toLocaleString()} papers published since ${NOW - YEARS + 1} on <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a>. Each is ranked by how much recent senior-author work they lead, so you can email a lab that is active right now.</p>
    <p class="topic-cta-top"><a class="btn-primary" href="${SITE}/?q=${encodeURIComponent(topic.q)}">\u2192 Search all ${esc(t)} labs and draft outreach emails</a></p>
    <ol class="topic-labs">
${labHtml}
    </ol>
    <p class="topic-foot">Want a different angle? <a href="${SITE}/">Describe your own research interest</a> and needalab ranks the active labs for you. Browse <a href="${SITE}/topics/">all topics</a>.</p>
    <footer class="stem-footer">Data from <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a> (CC0). A research-discovery tool, not an authoritative ranking. Generated ${new Date().toISOString().slice(0, 10)}.</footer>
  </div>
  <script src="/js/track.js?v=1" defer></script>
</body>
</html>
`;
}

function indexHtml(entries) {
  const url = `${SITE}/topics/`;
  const pageTitle = `Browse research labs by topic | needalab`;
  const desc = `Browse ${entries.length} research topics and find active labs taking students, ranked from OpenAlex. From CRISPR to quantum computing to soft robotics.`;
  const byCat = new Map();
  for (const e of entries) {
    if (!byCat.has(e.cat)) byCat.set(e.cat, []);
    byCat.get(e.cat).push(e);
  }
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: pageTitle,
    description: desc,
    url,
  };
  const sections = [...byCat.entries()]
    .map(
      ([cat, list]) => `      <section class="topic-cat"><h2>${esc(cat)}</h2>
        <ul class="topic-grid">${list
          .map(
            (e) =>
              `<li><a href="${SITE}/topics/${slug(e.q)}/">${esc(title(e.q))}</a> <small>${e.total > e.n ? `${e.total} labs` : `${e.n} labs`}</small></li>`
          )
          .join("")}</ul></section>`
    )
    .join("\n");
  return `<!DOCTYPE HTML>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(pageTitle)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="needalab">
${HEAD({ css: "../" })}
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <div class="container topic-page">
    <nav class="topic-nav"><a href="${SITE}/">needalab</a> &rsaquo; <span>Topics</span></nav>
    <h1>Browse research labs by topic</h1>
    <p class="topic-intro">Pick a topic to see the labs publishing the most relevant recent work and taking students, or <a href="${SITE}/">describe your own interest</a>.</p>
${sections}
    <footer class="stem-footer">Data from <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a> (CC0).</footer>
  </div>
  <script src="/js/track.js?v=1" defer></script>
</body>
</html>
`;
}

async function main() {
  const entries = [];
  let hit429 = false;
  let callCount = 0;
  for (const topic of TOPICS) {
    const s = slug(topic.q);
    process.stdout.write(`[${entries.length + 1}/${TOPICS.length}] ${topic.q} ... `);
    let d;
    try {
      callCount++;
      let r;
      for (let attempt = 0; attempt < 6; attempt++) {
        r = await fetch(oaUrl(topic.q));
        if (r.status !== 429) break;
        const wait = 15000 * (attempt + 1);
        process.stdout.write(`429, waiting ${wait / 1000}s ... `);
        await sleep(wait);
      }
      if (r.status === 429) {
        hit429 = true;
        console.log("429 RATE LIMITED after retries - skipping this topic.");
        continue;
      }
      if (!r.ok) {
        console.log(`HTTP ${r.status} - skipped.`);
        continue;
      }
      d = await r.json();
    } catch (e) {
      console.log(`fetch error: ${e.message} - skipped.`);
      continue;
    }
    const works = d?.results ?? [];
    const totalPapers = d?.meta?.count ?? works.length;
    const ranked = rankProfessors(works, { now: NOW });
    const labs = ranked.slice(0, TOP);
    if (labs.length < 5) {
      console.log(`only ${labs.length} labs - skipped.`);
      continue;
    }
    const dir = join(ROOT, "topics", s);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), pageHtml(topic, labs, totalPapers, ranked.length));
    entries.push({ ...topic, slug: s, n: labs.length, total: ranked.length });
    console.log(`${labs.length} labs, ${works.length} papers.`);
    await sleep(1000); // be polite to OpenAlex
  }

  // Directory page
  mkdirSync(join(ROOT, "topics"), { recursive: true });
  writeFileSync(join(ROOT, "topics", "index.html"), indexHtml(entries));

  // sitemap.xml (root) + robots.txt
  const urls = [
    { loc: `${SITE}/`, pri: "1.0" },
    { loc: `${SITE}/topics/`, pri: "0.8" },
    ...entries.map((e) => ({ loc: `${SITE}/topics/${e.slug}/`, pri: "0.7" })),
  ];
  const lastmod = new Date().toISOString().slice(0, 10);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${u.loc}</loc><lastmod>${lastmod}</lastmod><priority>${u.pri}</priority></url>`
      )
      .join("\n") +
    `\n</urlset>\n`;
  writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
  writeFileSync(
    join(ROOT, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`
  );

  const avg = entries.length
    ? (entries.reduce((a, e) => a + e.n, 0) / entries.length).toFixed(1)
    : 0;
  console.log(
    `\nDone. ${entries.length}/${TOPICS.length} topic pages, avg ${avg} labs/page. ` +
      `OpenAlex calls: ${callCount}. 429 hit: ${hit429}.`
  );
  if (hit429) process.exitCode = 2;
}

main();
