import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enforceDraftRules, misstatesStage } from "./rules.ts";

const HS = "Current stage: High school senior.";

Deno.test("adds a Dear Professor greeting and fixes self-descriptions for high schoolers", () => {
  const out = enforceDraftRules({ subject: "EEG question", body: "I am an undergrad who built X.\n\nAayushya Patel" }, "Daniel S. Margulies", HS);
  assertEquals(out.body, "Dear Professor Margulies,\n\nI am a high school student who built X.\n\nAayushya Patel");
});

Deno.test("never mangles phrases it doesn't understand", () => {
  // Regression: a blind replace once produced "high school-free question".
  const d = { subject: "Undergraduate-free question on EEG", body: "Dear Professor Lee,\n\nText." };
  assertEquals(enforceDraftRules(d, "Lee", HS).subject, "Undergraduate-free question on EEG");
  assertEquals(misstatesStage(d, HS), true); // caller asks the model to rewrite instead
});

Deno.test("leaves undergrads and existing greetings alone", () => {
  const d = { subject: "Undergrad research question", body: "Dear Professor Lee,\n\nI am an undergrad." };
  assertEquals(enforceDraftRules(d, "Wee Sun Lee", "Current stage: Undergraduate at UCLA."), d);
  assertEquals(misstatesStage(d, "Current stage: Undergraduate at UCLA."), false);
});
