// Unit checks for the NSF grant badge matching logic (pure functions).
// Run: deno test supabase/functions/_shared/grants.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { institutionMatches, isRecentStart } from "./grants.ts";

Deno.test("institutionMatches: same school, different wording", () => {
  assert(institutionMatches("Northwestern University", "Northwestern University"));
  assert(institutionMatches("Northwestern University", "Northwestern University, Evanston"));
  assert(institutionMatches("Stanford University", "Leland Stanford Junior University"));
});

Deno.test("institutionMatches: unrelated school rejected", () => {
  assertEquals(institutionMatches("Massachusetts Institute of Technology", "Stanford University"), false);
  assertEquals(institutionMatches("Harvard University", "Yale University"), false);
});

Deno.test("institutionMatches: empty / missing is not a match", () => {
  assertEquals(institutionMatches("", "Stanford University"), false);
  assertEquals(institutionMatches("Stanford University", null), false);
  assertEquals(institutionMatches(null, null), false);
});

Deno.test("isRecentStart: within 18 months true, older false", () => {
  const now = Date.parse("2026-11-02");
  assert(isRecentStart("09/01/2026", now));
  assert(isRecentStart("06/15/2025", now));
  assertEquals(isRecentStart("01/01/2023", now), false);
  assertEquals(isRecentStart("", now), false);
  assertEquals(isRecentStart(null, now), false);
});
