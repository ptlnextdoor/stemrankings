// The model follows these rules most of the time, not always; enforce the two that embarrass students.

// True when a draft for a high schooler calls them an undergrad (caller asks the model to rewrite).
export function misstatesStage(d: { subject: string; body: string }, profile: string) {
  return /high school/i.test(profile) && /\bundergrad(uate)?s?\b/i.test(d.subject + " " + d.body);
}

export function enforceDraftRules(d: { subject: string; body: string }, profName: string, profile: string) {
  let { subject, body } = d;
  if (/high school/i.test(profile)) {
    // Last resort only (after one rewrite): fix the common self-descriptions, never arbitrary phrases.
    const fix = (t: string) => t
      .replace(/\b(I am|I'm) an undergrad(uate)?( student)?\b/gi, "$1 a high school student")
      .replace(/\bas an undergrad(uate)?( student)?\b/gi, "as a high school student")
      .replace(/\bundergrad(uate)? (student|researcher)\b/gi, "high school $2");
    subject = fix(subject); body = fix(body);
  }
  if (!/^\s*Dear\b/i.test(body)) {
    const last = profName.trim().split(/\s+/).pop() ?? profName;
    body = `Dear Professor ${last},\n\n` + body.replace(/^\s*(Hi|Hello|Hey)\b[^\n]*\n+/i, "");
  }
  return { subject, body };
}

// Cheap gate before charging for a profile: enough real words that the model has something to work with.
// Keyboard mash ("asdfasdf") and one-liners fail; a 3-sentence bio passes.
export function looksLikeResume(text: string) {
  const words = text.match(/[A-Za-z][a-z]{1,}/g) ?? [];
  const real = words.filter((w) => /[aeiouy]/i.test(w) && !/(.)\1\1/.test(w) && !/[bcdfghjklmnpqrstvwxz]{5}/i.test(w));
  return text.trim().length >= 80 && new Set(real.map((w) => w.toLowerCase())).size >= 12;
}

// ---- Mismatch guard ----
// Cheap, dependency-free overlap between a student's profile and a professor's recent work.
// Goal: catch a draft that bridges two unrelated fields (soft-robotics student -> clinical
// microbiologist) BEFORE charging, while letting a real topic match through.
// Below we lowercase, keep content words (>=4 letters, not a stopword), and compute how many of
// the professor's distinct content words also appear in the student's profile (overlap ratio over
// the professor side, which is small and focused). A small shared-term floor backs up the ratio.

const STOP = new Set([
  "the","and","for","with","that","this","from","have","has","was","were","are","our","their","its",
  "into","using","used","use","based","study","studies","research","using","which","while","these",
  "those","such","also","than","then","they","them","there","here","will","would","could","should",
  "can","may","might","been","being","more","most","some","many","both","each","other","others",
  "between","among","within","across","over","under","about","after","before","during","through",
  "high","low","new","novel","via","per","not","but","all","any","one","two","three","well","how",
  "work","works","working","paper","papers","result","results","method","methods","approach","model",
  "models","system","systems","data","analysis","student","students","professor","interested",
  "interest","interests","school","senior","junior","year","years","skills","project","projects",
  "experience","built","build","developed","development","science","sciences","scientific",
]);

export function contentWordSet(text: string): Set<string> {
  const words = (text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [])
    .map((w) => w.replace(/-+$/,"").replace(/^-+/,""))
    // crude stemming: drop a trailing plural/gerund so "robots"~"robot", "sensing"~"sens"
    .map((w) => w.replace(/(ings|ing|ies|es|s)$/,(m) => m === "ies" ? "y" : ""))
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return new Set(words);
}

// Returns { score, shared, reason }. score is overlap over the professor's content words.
export function profileOverlap(profile: string, paperTexts: string[]): { score: number; shared: string[] } {
  const prof = contentWordSet(profile);
  const papers = contentWordSet(paperTexts.join("  "));
  if (!papers.size) return { score: 1, shared: [] }; // no paper text: don't block
  const shared: string[] = [];
  for (const w of papers) if (prof.has(w)) shared.push(w);
  return { score: shared.length / papers.size, shared };
}

// Below this overlap ratio (and with too few shared terms) a draft is flagged as a likely mismatch.
// Tuned on real examples: soft-robotics/EEG student vs Robin Patel (clinical microbiology) flags;
// same student vs Ryan L. Truby (soft robotics) passes. See rules.test.ts.
export const MISMATCH_THRESHOLD = 0.06;
export const MISMATCH_MIN_SHARED = 3;

export function isMismatch(profile: string, papers: { title?: string; abstract?: string }[]): { mismatch: boolean; score: number; shared: string[] } {
  const texts = papers.map((p) => `${p.title ?? ""} ${p.abstract ?? ""}`);
  const { score, shared } = profileOverlap(profile, texts);
  const mismatch = score < MISMATCH_THRESHOLD && shared.length < MISMATCH_MIN_SHARED;
  return { mismatch, score, shared };
}
