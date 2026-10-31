// Pure helpers for the email finder. No network, no Deno APIs -> unit-testable.

// Common free/webmail domains we must never treat as an institutional match.
const WEBMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com",
  "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
  "qq.com", "163.com", "126.com", "foxmail.com", "gmx.com", "web.de", "yandex.ru", "mail.ru",
]);

// Domains that are academic but not a specific institution match (publishers, repos, etc).
const JUNK_EMAIL_DOMAINS = new Set([
  "example.com", "domain.com", "email.com", "sentry.io", "wixpress.com",
  "elsevier.com", "wiley.com", "springer.com", "nature.com", "mdpi.com", "frontiersin.org",
  "sci-hub.se", "researchgate.net", "academia.edu", "orcid.org", "doi.org",
]);

export function isWebmail(domain: string): boolean {
  return WEBMAIL.has(domain.toLowerCase());
}

// An academic domain for our purposes: TLD/second-level that universities/labs use.
export function isAcademicDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (isWebmail(d) || JUNK_EMAIL_DOMAINS.has(d)) return false;
  return /\.edu$/.test(d) || /\.edu\.[a-z]{2}$/.test(d) ||
    /\.ac\.[a-z]{2}$/.test(d) || /\bac\.[a-z]{2}$/.test(d) ||
    /(?:^|\.)(cnrs|inria|inserm|cea|mpg|mpib-berlin|fraunhofer|csic|cnr|ethz|epfl|riken)\.[a-z]{2,3}$/.test(d) ||
    /\.gouv\.fr$/.test(d) || /\.gov$/.test(d) || /\.edu\.au$/.test(d) ||
    /\buni-[a-z]+\.de$/.test(d) || /\.uni\.[a-z]{2}$/.test(d);
}

// Normalize: strip accents, lowercase, keep letters.
export function norm(s: string): string {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Split a display name into first/last letter tokens (drops initials-only parts for matching).
export function nameTokens(name: string): { first: string; last: string; all: string[] } {
  const parts = norm(name).replace(/[^a-z\s'-]/g, " ").split(/\s+/).filter((p) => p.length > 1);
  return { first: parts[0] || "", last: parts[parts.length - 1] || "", all: parts };
}

// Deobfuscate "name [at] uni [dot] edu" / "name (at) uni dot edu" into real emails.
export function deobfuscate(text: string): string {
  return text
    .replace(/\s*[\[\(\{]?\s*(?:@|\bat\b|&#0*64;)\s*[\]\)\}]?\s*/gi, "@")
    .replace(/\s*[\[\(\{]?\s*(?:\bdot\b|\bpunkt\b|&#0*46;)\s*[\]\)\}]?\s*/gi, ".");
}

// Pull candidate emails out of HTML/text. Handles mailto: and obfuscated forms.
export function extractEmails(html: string): string[] {
  const out = new Set<string>();
  const add = (e: string) => {
    const clean = e.trim().toLowerCase().replace(/^mailto:/, "").replace(/[.,;:)>\]]+$/, "");
    if (/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) out.add(clean);
  };
  // mailto links
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) add(m[1]);
  // plain emails
  for (const m of html.matchAll(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/gi)) add(m[0]);
  // obfuscated: local [at] domain [dot] tld (also "domain dot edu")
  const deob = html
    .replace(/\s*[\[\(]?\s*(?:@|&#0*64;|\bat\b)\s*[\]\)]?\s*/gi, "@")
    .replace(/\s*[\[\(]?\s*(?:\bdot\b|&#0*46;)\s*[\]\)]?\s*/gi, ".");
  for (const m of deob.matchAll(/[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/gi)) add(m[0]);
  return [...out];
}

export function domainOf(email: string): string {
  return (email.split("@")[1] || "").toLowerCase();
}

// Registrable-ish suffix match: email domain is the institution domain or a subdomain of it.
export function domainMatches(emailDomain: string, instDomain: string): boolean {
  if (!emailDomain || !instDomain) return false;
  const e = emailDomain.toLowerCase(), i = instDomain.toLowerCase();
  return e === i || e.endsWith("." + i) || i.endsWith("." + e);
}

// Does the local part of an email plausibly contain the person's name?
export function localPartMatchesName(email: string, name: string): boolean {
  const local = norm(email.split("@")[0]).replace(/[^a-z]/g, "");
  if (!local) return false;
  const { first, last, all } = nameTokens(name);
  if (!last) return false;
  if (local.includes(last) && last.length >= 3) return true;              // "margulies..."
  if (first && local.includes(first) && first.length >= 3) return true;    // "daniel..."
  if (first && local.includes(first[0] + last)) return true;               // "dmargulies"
  if (first && local.includes(last + first[0])) return true;               // "muglerd" style
  if (local.length <= 4 && all.length >= 2 && local.includes(all[0][0]) && local.includes(last[0])) return true; // initials
  return false;
}

// Score & pick the best email for a person given institution domain.
export type EmailHit = { email: string; confidence: "high" | "medium" | "low"; source: string; page_url?: string | null };

export function rankEmail(email: string, name: string, instDomain: string | null, source: string): EmailHit | null {
  const d = domainOf(email);
  if (!d || isWebmail(d)) return null;
  const nameOk = localPartMatchesName(email, name);
  const instOk = instDomain ? domainMatches(d, instDomain) : false;
  const acad = isAcademicDomain(d);
  let confidence: "high" | "medium" | "low";
  if (instOk && nameOk) confidence = "high";
  else if (instOk) confidence = "medium";
  else if (acad && nameOk) confidence = "medium";
  else if (acad) confidence = "low";
  else return null; // non-academic, non-institution -> reject
  return { email, confidence, source };
}

// Guess first.last@domain as a last resort (always low confidence, flagged "guessed").
export function guessEmail(name: string, instDomain: string | null): EmailHit | null {
  if (!instDomain) return null;
  const { first, last } = nameTokens(name);
  if (!first || !last) return null;
  return { email: `${first}.${last}@${instDomain}`, confidence: "low", source: "guessed", page_url: null };
}
