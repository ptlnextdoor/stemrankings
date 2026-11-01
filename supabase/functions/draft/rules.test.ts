import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enforceDraftRules } from "./rules.ts";

Deno.test("adds a Dear Professor greeting and fixes 'undergrad' for high schoolers", () => {
  const out = enforceDraftRules(
    { subject: "Undergraduate-level EEG question", body: "I am an undergrad who built X.\n\nAayushya Patel" },
    "Daniel S. Margulies", "Current stage: High school senior.");
  assertEquals(out.subject, "high school EEG question");
  assertEquals(out.body.startsWith("Dear Professor Margulies,\n\nI am a high school student"), true);
});

Deno.test("leaves undergrads and existing greetings alone", () => {
  const d = { subject: "Undergrad research question", body: "Dear Professor Lee,\n\nI am an undergrad." };
  assertEquals(enforceDraftRules(d, "Wee Sun Lee", "Current stage: Undergraduate at UCLA."), d);
});
