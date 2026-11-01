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
  // Coauthor/office addresses on a paper must not be attributed to the prof (was a live wrong-email bug).
  assertEquals(rankEmail("office@uchicago.edu", "Daniel Margulies", "uchicago.edu", "paper"), null);
  assertEquals(rankEmail("susobhan_ghosh@g.harvard.edu", "Finale Doshi-Velez", "harvard.edu", "paper"), null);
  assertEquals(rankEmail("margulies@othersch.edu", "Daniel Margulies", "uchicago.edu", "paper")?.confidence, "medium");
  assertEquals(rankEmail("random@othersch.edu", "Daniel Margulies", "uchicago.edu", "paper"), null);
  assertEquals(rankEmail("daniel@gmail.com", "Daniel Margulies", "uchicago.edu", "paper"), null);
});

Deno.test("guessEmail is always low and flagged", () => {
  const g = guessEmail("Daniel Margulies", "uchicago.edu");
  assertEquals(g?.email, "daniel.margulies@uchicago.edu");
  assertEquals(g?.confidence, "low");
  assertEquals(g?.source, "guessed");
  assertEquals(guessEmail("Daniel Margulies", null), null);
});

Deno.test("faculty-page emails must match the person's name", () => {
  // Real misses from the live run: a lab-news inbox and a coauthor at another school.
  assertEquals(rankEmail("news@csail.mit.edu", "Scott Aaronson", "mit.edu", "faculty-page"), null);
  assertEquals(rankEmail("weidi@sjtu.edu.cn", "Andrew Zisserman", "ox.ac.uk", "faculty-page"), null);
  assertEquals(rankEmail("olgarus@princeton.edu", "Olga Russakovsky", "princeton.edu", "faculty-page")?.confidence, "high");
  // Paper/ORCID emails are already tied to the author, so a non-matching local part is still allowed.
  assertEquals(rankEmail("zoubin@eng.cam.ac.uk", "Zoubin Ghahramani", "cam.ac.uk", "paper")?.confidence, "high");
});

Deno.test("extractEmails handles quoted at and tag-split addresses", () => {
  assert(extractEmails(`E-Mail: Cordelia.Schmid "at" inria.fr`).includes("cordelia.schmid@inria.fr"));
  assert(extractEmails(`zivbj <b>at</b> cs.cmu.edu`).includes("zivbj@cs.cmu.edu"));
});
