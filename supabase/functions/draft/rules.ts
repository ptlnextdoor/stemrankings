// The model follows these rules most of the time, not always; enforce the two that embarrass students.
export function enforceDraftRules(d: { subject: string; body: string }, profName: string, profile: string) {
  let { subject, body } = d;
  if (/high school/i.test(profile)) {
    const fix = (t: string) => t
      .replace(/\ban undergrad(uate)?\b/gi, "a high school student")
      .replace(/\bundergraduate(-level)?\b/gi, "high school")
      .replace(/\bundergrad\b/gi, "high school student");
    subject = fix(subject); body = fix(body);
  }
  if (!/^\s*Dear\b/i.test(body)) {
    const last = profName.trim().split(/\s+/).pop() ?? profName;
    body = `Dear Professor ${last},\n\n` + body.replace(/^\s*(Hi|Hello|Hey)\b[^\n]*\n+/i, "");
  }
  return { subject, body };
}
