// Pure helpers for the gmail edge function: AES-GCM token encryption and RFC 2822 MIME building.
// Kept separate from index.ts so they can be unit-tested with `deno test` and have no I/O.

// ---- AES-GCM encryption of the OAuth refresh token ----
// Key derived from the GMAIL_TOKEN_KEY secret via SHA-256, so any passphrase length works.
// Output: base64( iv(12 bytes) || ciphertext ). Reversible only with the same secret.
async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptToken(plain: string, secret: string): Promise<string> {
  if (!secret) throw new Error("GMAIL_TOKEN_KEY not set");
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const joined = new Uint8Array(iv.length + ct.length);
  joined.set(iv, 0);
  joined.set(ct, iv.length);
  return b64encode(joined);
}

export async function decryptToken(blob: string, secret: string): Promise<string> {
  if (!secret) throw new Error("GMAIL_TOKEN_KEY not set");
  const key = await aesKey(secret);
  const joined = b64decode(blob);
  const iv = joined.slice(0, 12);
  const ct = joined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---- Header-injection defence ----
// Strip CR/LF (and any trailing control chars) so an attacker can't inject extra headers
// (e.g. a hidden Bcc) via the subject or any address line.
export function sanitizeHeader(v: string): string {
  return String(v).replace(/[\r\n]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function isEmail(v: string): boolean {
  return EMAIL_RE.test(String(v).trim()) && String(v).trim().length <= 254;
}

// Encode a header value containing non-ASCII as RFC 2047 "encoded-word" (UTF-8, base64).
// Keeps pure-ASCII subjects as-is so they stay human-readable in the raw message.
function encodeHeaderWord(v: string): string {
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7f]*$/.test(v)) return v;
  return "=?UTF-8?B?" + b64encode(new TextEncoder().encode(v)) + "?=";
}

// base64url without padding, as the Gmail API expects for the raw message.
export function base64url(bytes: Uint8Array): string {
  return b64encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface MimeParts {
  fromName?: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
}

// Build an RFC 2822 text/plain message. All header inputs are sanitized; the body keeps its
// newlines (normalised to CRLF). Throws if from/to aren't valid emails.
export function buildMime(p: MimeParts): string {
  const fromEmail = sanitizeHeader(p.fromEmail);
  const to = sanitizeHeader(p.to);
  if (!isEmail(fromEmail)) throw new Error("invalid from address");
  if (!isEmail(to)) throw new Error("invalid recipient");
  const subject = encodeHeaderWord(sanitizeHeader(p.subject));
  const fromName = p.fromName ? sanitizeHeader(p.fromName).replace(/["<>]/g, "") : "";
  const from = fromName ? `${encodeHeaderWord(fromName)} <${fromEmail}>` : fromEmail;
  const body = String(p.body).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

// Full raw payload for gmail.googleapis.com .../messages/send.
export function buildRawMessage(p: MimeParts): string {
  return base64url(new TextEncoder().encode(buildMime(p)));
}

export const LIMITS = { subject: 200, body: 5000, perDay: 20, perProfDays: 7 };

// Cap + sanitize caller-supplied subject/body. Subject loses newlines (header), body is length-capped.
export function clampSubject(v: string): string {
  return sanitizeHeader(v).slice(0, LIMITS.subject);
}
export function clampBody(v: string): string {
  return String(v).replace(/\r\n/g, "\n").slice(0, LIMITS.body);
}
