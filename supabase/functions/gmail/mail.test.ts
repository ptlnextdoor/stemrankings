import { assertEquals, assertNotEquals, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { base64url, buildMime, buildRawMessage, clampBody, clampSubject, decryptToken, encryptToken, isEmail, LIMITS, sanitizeHeader } from "./mail.ts";

const SECRET = "test-secret-passphrase-123";

Deno.test("encrypt/decrypt round-trips the refresh token", async () => {
  const token = "1//0gABCdef_refresh-token.value-xyz";
  const enc = await encryptToken(token, SECRET);
  assertNotEquals(enc, token); // stored ciphertext is not the plaintext
  assertEquals(await decryptToken(enc, SECRET), token);
});

Deno.test("encryption uses a fresh IV each time (different ciphertext, same plaintext)", async () => {
  const a = await encryptToken("same", SECRET);
  const b = await encryptToken("same", SECRET);
  assertNotEquals(a, b);
  assertEquals(await decryptToken(a, SECRET), "same");
  assertEquals(await decryptToken(b, SECRET), "same");
});

Deno.test("decrypting with the wrong key fails", async () => {
  const enc = await encryptToken("secret-token", SECRET);
  let threw = false;
  try { await decryptToken(enc, "wrong-key"); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("sanitizeHeader strips CR/LF and control chars (header injection)", () => {
  assertEquals(sanitizeHeader("Hello\r\nBcc: evil@x.com"), "Hello Bcc: evil@x.com");
  assertEquals(sanitizeHeader("a\nb\rc"), "a b c");
  assertEquals(sanitizeHeader("  trim me  "), "trim me");
  assertEquals(sanitizeHeader("tab\tnull\u0000x"), "tabnullx");
});

Deno.test("buildMime has no injected headers from a malicious subject", () => {
  const mime = buildMime({
    fromEmail: "me@gmail.com",
    to: "prof@uni.edu",
    subject: "Research\r\nBcc: attacker@evil.com",
    body: "Hi.",
  });
  // The injected "Bcc:" must not survive as its own header line.
  const headerBlock = mime.split("\r\n\r\n")[0];
  assertEquals(headerBlock.split("\r\n").filter((l) => /^Bcc:/i.test(l)).length, 0);
  assertStringIncludes(mime, "Subject: Research Bcc: attacker@evil.com");
});

Deno.test("buildMime rejects invalid recipient and from", () => {
  assertThrows(() => buildMime({ fromEmail: "me@gmail.com", to: "not-an-email", subject: "s", body: "b" }));
  assertThrows(() => buildMime({ fromEmail: "bad", to: "prof@uni.edu", subject: "s", body: "b" }));
});

Deno.test("buildMime includes From display name and required headers", () => {
  const mime = buildMime({ fromName: "Ada Lovelace", fromEmail: "ada@gmail.com", to: "prof@uni.edu", subject: "Hello", body: "Hi there." });
  assertStringIncludes(mime, "From: Ada Lovelace <ada@gmail.com>");
  assertStringIncludes(mime, "To: prof@uni.edu");
  assertStringIncludes(mime, "MIME-Version: 1.0");
  assertStringIncludes(mime, 'Content-Type: text/plain; charset="UTF-8"');
  assertStringIncludes(mime, "\r\n\r\nHi there.");
});

Deno.test("buildMime encodes a non-ASCII subject as RFC 2047", () => {
  const mime = buildMime({ fromEmail: "me@gmail.com", to: "prof@uni.edu", subject: "Café résumé", body: "b" });
  assertStringIncludes(mime, "Subject: =?UTF-8?B?");
});

Deno.test("buildRawMessage is URL-safe base64 with no padding", () => {
  const raw = buildRawMessage({ fromEmail: "me@gmail.com", to: "prof@uni.edu", subject: "Hi", body: "Body" });
  assertEquals(/^[A-Za-z0-9_-]+$/.test(raw), true);
  // decodes back to the MIME text
  const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
  assertStringIncludes(decoded, "To: prof@uni.edu");
});

Deno.test("base64url has no +, / or =", () => {
  const out = base64url(new Uint8Array([251, 255, 254, 253, 0, 1]));
  assertEquals(/[+/=]/.test(out), false);
});

Deno.test("isEmail validates addresses", () => {
  assertEquals(isEmail("prof@uni.edu"), true);
  assertEquals(isEmail("bad"), false);
  assertEquals(isEmail("a@b"), false);
  assertEquals(isEmail("x".repeat(260) + "@uni.edu"), false); // too long
});

Deno.test("clampSubject/clampBody enforce caps and strip subject newlines", () => {
  assertEquals(clampSubject("a\r\nb").includes("\n"), false);
  assertEquals(clampSubject("x".repeat(300)).length, LIMITS.subject);
  assertEquals(clampBody("y".repeat(6000)).length, LIMITS.body);
  assertEquals(clampBody("keeps\nnewlines"), "keeps\nnewlines");
});
