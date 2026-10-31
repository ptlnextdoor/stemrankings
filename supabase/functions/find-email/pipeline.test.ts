// deno test supabase/functions/find-email/pipeline.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { domainMatches, extractEmails, guessEmail, isAcademicDomain, isWebmail, localPartMatchesName, rankEmail } from "./pipeline.ts";

Deno.test("academic vs webmail domains", () => {
  assert(isAcademicDomain("uchicago.edu"));
  assert(isAcademicDomain("cs.ox.ac.uk"));
  assert(isAcademicDomain("cnrs.fr"));
  assert(!isAcademicDomain("gmail.com"));
  assert(isWebmail("gmail.com"));
  assert(!isWebmail("mit.edu"));
});

Deno.test("extractEmails handles mailto, plain, and obfuscated", () => {
  const html = `<a href="mailto:jane.doe@mit.edu">mail</a> or john [at] stanford [dot] edu or bob&#64;cam.ac.uk`;
  const got = extractEmails(html);
  assert(got.includes("jane.doe@mit.edu"));
  assert(got.includes("john@stanford.edu"));
  assert(got.includes("bob@cam.ac.uk"));
});

Deno.test("domainMatches subdomains", () => {
  assert(domainMatches("cs.uchicago.edu", "uchicago.edu"));
  assert(domainMatches("uchicago.edu", "uchicago.edu"));
  assert(!domainMatches("gmail.com", "uchicago.edu"));
});

Deno.test("localPartMatchesName", () => {
  assert(localPartMatchesName("margulies@uni.edu", "Daniel S. Margulies"));
  assert(localPartMatchesName("dmargulies@uni.edu", "Daniel Margulies"));
  assert(!localPartMatchesName("admin@uni.edu", "Daniel Margulies"));
});

Deno.test("rankEmail confidence tiers", () => {
  assertEquals(rankEmail("margulies@uchicago.edu", "Daniel Margulies", "uchicago.edu", "paper")?.confidence, "high");
  assertEquals(rankEmail("office@uchicago.edu", "Daniel Margulies", "uchicago.edu", "paper")?.confidence, "medium");
  assertEquals(rankEmail("margulies@othersch.edu", "Daniel Margulies", "uchicago.edu", "paper")?.confidence, "medium");
  assertEquals(rankEmail("random@othersch.edu", "Daniel Margulies", "uchicago.edu", "paper")?.confidence, "low");
  assertEquals(rankEmail("daniel@gmail.com", "Daniel Margulies", "uchicago.edu", "paper"), null);
});

Deno.test("guessEmail is always low and flagged", () => {
  const g = guessEmail("Daniel Margulies", "uchicago.edu");
  assertEquals(g?.email, "daniel.margulies@uchicago.edu");
  assertEquals(g?.confidence, "low");
  assertEquals(g?.source, "guessed");
  assertEquals(guessEmail("Daniel Margulies", null), null);
});
