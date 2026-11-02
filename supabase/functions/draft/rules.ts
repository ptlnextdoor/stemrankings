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
